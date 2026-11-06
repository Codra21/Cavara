// Owner-only image upload to R2. The admin page optimizes every picture in the browser first (src/lib/optimize-image.ts,
// settings in IMAGE_OPTIMIZATION); this function only accepts that output, so an unoptimized original cannot reach
// the shop even if someone calls it directly. It checks the header, never decodes pixels (Free plan CPU limit).
// The uploaded key is added to a colour in the editor and saved with the product; an upload that is never saved stays
// in the bucket unused (cheap, and safer than deleting files orders may show).
import { createServerFn } from "@tanstack/react-start";
import { setResponseStatus } from "@tanstack/react-start/server";
import {
  IMAGE_CACHE_CONTROL,
  IMAGE_OPTIMIZATION,
  imageDimensions,
  MAX_UPLOAD_BYTES,
  mediaUrl,
  OPTIMIZED_TYPES,
  sniffImageType,
  UPLOAD_TYPES,
} from "@/domain/media";
import { auditStatement } from "@/server/admin/auth.server";
import { getDb, getImageBase, getImages } from "@/server/env";
import { ownerAuthMiddleware } from "@/server/middleware/auth";

export type UploadImageResult =
  | { ok: true; key: string; url: string; width: number; height: number; bytes: number }
  | { ok: false; error: string };

export const uploadImageFn = createServerFn({ method: "POST" })
  .middleware([ownerAuthMiddleware])
  .validator((data: FormData) => {
    if (!(data instanceof FormData)) throw new Error("Expected form data");
    const file = data.get("file");
    const product = String(data.get("productId") ?? "new");
    if (!(file instanceof File)) throw new Error("Choose an image to upload");
    if (!/^(?:new|[1-9]\d{0,9})$/.test(product)) throw new Error("Unknown product");
    return { file, product };
  })
  .handler(async ({ data, context }): Promise<UploadImageResult> => {
    const { file, product } = data;
    const reject = (status: number, error: string): UploadImageResult => {
      setResponseStatus(status);
      return { ok: false, error };
    };
    if (file.size === 0) return reject(400, "That file is empty.");
    if (file.size > MAX_UPLOAD_BYTES) {
      return reject(413, `${file.name} is still over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB after optimizing.`);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniffImageType(bytes);
    if (!type || !(OPTIMIZED_TYPES as readonly string[]).includes(type)) {
      return reject(415, `${file.name} was not optimized. Upload it from the product editor.`);
    }
    const size = imageDimensions(bytes);
    if (!size || size.width < 1 || size.height < 1) return reject(415, `${file.name} could not be read as an image.`);
    if (Math.max(size.width, size.height) > IMAGE_OPTIMIZATION.maxEdge) {
      return reject(
        413,
        `${file.name} is larger than ${IMAGE_OPTIMIZATION.maxEdge} px. Upload it from the product editor.`,
      );
    }

    const key = `products/${product}/${crypto.randomUUID()}.${UPLOAD_TYPES[type]}`;
    await getImages().put(key, bytes, { httpMetadata: { contentType: type, cacheControl: IMAGE_CACHE_CONTROL } });

    await auditStatement(getDb(), context.admin, "image.uploaded", key, {
      product,
      bytes: file.size,
      type,
      width: size.width,
      height: size.height,
    }).run();
    return { ok: true, key, url: mediaUrl(getImageBase(), key), ...size, bytes: file.size };
  });
