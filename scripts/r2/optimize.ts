// Bun.Image optimization for images uploaded from this machine (https://bun.com/docs/runtime/image).
// Same settings as the admin page's browser optimizer (IMAGE_OPTIMIZATION in src/domain/media.ts).
// Bun-only: never import from app code, which runs on Cloudflare Workers.
import { IMAGE_OPTIMIZATION, type UploadType } from "../../src/domain/media";

export interface OptimizeResult {
  bytes: Uint8Array;
  width: number;
  height: number;
  /** True when the re-encode was not smaller and the original bytes were kept. */
  keptOriginal: boolean;
}

/**
 * Resizes to fit IMAGE_OPTIMIZATION.maxEdge (never enlarging) and re-encodes as `type`, which must match the key's
 * extension so stored keys keep working. Returns the original when re-encoding would not make it smaller.
 */
export async function optimizeWithBun(original: Uint8Array, type: UploadType): Promise<OptimizeResult> {
  const { width: sourceWidth, height: sourceHeight } = await new Bun.Image(original).metadata();
  const fits = Math.max(sourceWidth, sourceHeight) <= IMAGE_OPTIMIZATION.maxEdge;

  const image = new Bun.Image(original, { maxPixels: 60_000_000 }).resize(
    IMAGE_OPTIMIZATION.maxEdge,
    IMAGE_OPTIMIZATION.maxEdge,
    { fit: "inside", withoutEnlargement: true },
  );
  const encoded =
    type === "image/webp"
      ? image.webp({ quality: IMAGE_OPTIMIZATION.webpQuality })
      : type === "image/jpeg"
        ? image.jpeg({ quality: IMAGE_OPTIMIZATION.jpegQuality, progressive: true })
        : image.png({ compressionLevel: 9 });
  const bytes = await encoded.bytes();

  // A small original can beat the re-encode; keep it unless it is too large in pixels.
  if (fits && bytes.length >= original.length) {
    return { bytes: original, width: sourceWidth, height: sourceHeight, keptOriginal: true };
  }
  return { bytes, width: image.width, height: image.height, keptOriginal: false };
}
