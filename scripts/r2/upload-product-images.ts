// One-off: optimizes public/product-images/** with Bun.Image (scripts/r2/optimize.ts) and uploads the results to an
// R2 bucket under the same keys ("product-images/…"). The originals on disk are not changed.
// Run before applying migrations/0005_images_to_r2.sql to that environment's D1, or images break.
//
//   bun scripts/r2/upload-product-images.ts dev                → cavara-images-dev
//   bun scripts/r2/upload-product-images.ts production         → cavara-images-prod
//   bun scripts/r2/upload-product-images.ts dev --dry-run      → report sizes only, upload nothing
//
// Re-running is safe: the same input gives byte-identical output (Bun's WebP/JPEG codecs are statically linked).
// Files whose names are not valid image keys (see IMAGE_KEY_PATTERN) are skipped and listed; the catalogue
// references none of them.
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { contentTypeForKey, IMAGE_CACHE_CONTROL, isImageKey } from "../../src/domain/media";
import { optimizeWithBun } from "./optimize";

const BUCKETS = { dev: "cavara-images-dev", production: "cavara-images-prod" } as const;
const target = process.argv[2] as keyof typeof BUCKETS | undefined;
const dryRun = process.argv.includes("--dry-run");
if (!target || !(target in BUCKETS)) {
  console.error("Usage: bun scripts/r2/upload-product-images.ts <dev|production> [--dry-run]");
  process.exit(1);
}
const bucket = BUCKETS[target];
/** Cavara/, where wrangler.jsonc lives. */
const appRoot = join(import.meta.dir, "../..");
const root = join(appRoot, "public");
const source = join(root, "product-images");
const work = mkdtempSync(join(tmpdir(), "cavara-images-"));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`;
const files = walk(source).map((path) => ({ path, key: relative(root, path).split(sep).join("/") }));
const skipped = files.filter((file) => !isImageKey(file.key) || !contentTypeForKey(file.key));
const uploads = files.filter((file) => !skipped.includes(file));

console.log(
  `${dryRun ? "Dry run for" : "Uploading"} ${uploads.length} files to ${bucket} (skipping ${skipped.length}).`,
);
let failed = 0;
let before = 0;
let after = 0;
try {
  for (const [index, file] of uploads.entries()) {
    const type = contentTypeForKey(file.key)!;
    const original = await Bun.file(file.path).bytes();
    let optimized;
    try {
      optimized = await optimizeWithBun(original, type);
    } catch (error) {
      failed += 1;
      console.error(`FAILED to optimize ${file.key}: ${error instanceof Error ? error.message : error}`);
      continue;
    }
    before += original.length;
    after += optimized.bytes.length;
    const line = `${index + 1}/${uploads.length} ${file.key} ${kb(original.length)} → ${kb(optimized.bytes.length)} ${optimized.width}×${optimized.height}${optimized.keptOriginal ? " (original kept)" : ""}`;
    if (dryRun) {
      console.log(line);
      continue;
    }

    const temp = join(work, file.key);
    await Bun.write(temp, optimized.bytes, { createPath: true });
    const args = [
      "wrangler",
      "r2",
      "object",
      "put",
      `${bucket}/${file.key}`,
      "--file",
      temp,
      "--remote",
      "--content-type",
      type,
      "--cache-control",
      IMAGE_CACHE_CONTROL,
    ];
    if (target === "production") args.push("--env", "production");
    const run = Bun.spawnSync(["bunx", ...args], { stdout: "pipe", stderr: "pipe", cwd: appRoot });
    if (run.exitCode === 0) {
      console.log(line);
    } else {
      failed += 1;
      console.error(`FAILED ${file.key}\n${run.stderr.toString().trim()}`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
for (const file of skipped) console.log(`skipped (not a valid key): ${file.key}`);
console.log(`Total ${(before / 1048576).toFixed(2)} MB → ${(after / 1048576).toFixed(2)} MB.`);
console.log(
  failed ? `${failed} files failed; re-run to retry.` : dryRun ? "Dry run finished." : "All uploads finished.",
);
process.exit(failed ? 1 : 0);
