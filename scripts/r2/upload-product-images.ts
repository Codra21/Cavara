// One-off: copies public/product-images/** into an R2 bucket under the same keys ("product-images/…").
// Run before applying migrations/0005_images_to_r2.sql to that environment's D1, or images break.
//
//   bun scripts/r2/upload-product-images.ts dev          → cavara-images-dev
//   bun scripts/r2/upload-product-images.ts production   → cavara-images-prod
//
// Re-running is safe: objects are overwritten with identical content. Files whose names are not valid image keys
// (see IMAGE_KEY_PATTERN) are skipped and listed; none of them is referenced by the catalogue.
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { contentTypeForKey, IMAGE_CACHE_CONTROL, isImageKey } from "../../src/domain/media";

const BUCKETS = { dev: "cavara-images-dev", production: "cavara-images-prod" } as const;
const target = process.argv[2] as keyof typeof BUCKETS | undefined;
if (!target || !(target in BUCKETS)) {
  console.error("Usage: bun scripts/r2/upload-product-images.ts <dev|production>");
  process.exit(1);
}
const bucket = BUCKETS[target];
const root = join(import.meta.dir, "../../public");
const source = join(root, "product-images");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(source).map((path) => ({ path, key: relative(root, path).split(sep).join("/") }));
const skipped = files.filter((file) => !isImageKey(file.key) || !contentTypeForKey(file.key));
const uploads = files.filter((file) => !skipped.includes(file));

console.log(`Uploading ${uploads.length} files to ${bucket} (skipping ${skipped.length}).`);
let failed = 0;
for (const [index, file] of uploads.entries()) {
  const args = [
    "wrangler",
    "r2",
    "object",
    "put",
    `${bucket}/${file.key}`,
    "--file",
    file.path,
    "--remote",
    "--content-type",
    contentTypeForKey(file.key)!,
    "--cache-control",
    IMAGE_CACHE_CONTROL,
  ];
  if (target === "production") args.push("--env", "production");
  const run = Bun.spawnSync(["bunx", ...args], { stdout: "pipe", stderr: "pipe" });
  if (run.exitCode === 0) {
    console.log(`${index + 1}/${uploads.length} ${file.key}`);
  } else {
    failed += 1;
    console.error(`FAILED ${file.key}\n${run.stderr.toString().trim()}`);
  }
}
for (const file of skipped) console.log(`skipped (not a valid key): ${file.key}`);
console.log(failed ? `${failed} uploads failed; re-run to retry.` : "All uploads finished.");
process.exit(failed ? 1 : 0);
