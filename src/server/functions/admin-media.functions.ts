// Owner-only image upload to R2. The uploaded key is added to a colour in the editor and saved with the product;
// an upload that is never saved stays in the bucket unused (cheap, and safer than deleting files orders may show).
import { createServerFn } from "@tanstack/react-start";
import { setResponseStatus } from "@tanstack/react-start/server";
import { IMAGE_CACHE_CONTROL, MAX_UPLOAD_BYTES, mediaUrl, sniffImageType, UPLOAD_TYPES } from "@/domain/media";
import { auditStatement } from "@/server/admin/auth.server";
import { getDb, getImageBase, getImages } from "@/server/env";
import { ownerAuthMiddleware } from "@/server/middleware/auth";

export type UploadImageResult = { ok: true; key: string; url: string } | { ok: false; error: string };

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
    if (file.size === 0) return { ok: false, error: "That file is empty." };
    if (file.size > MAX_UPLOAD_BYTES) {
      setResponseStatus(413);
      return { ok: false, error: `${file.name} is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniffImageType(bytes);
    if (!type) return { ok: false, error: `${file.name} is not a WebP, JPEG, PNG or AVIF image.` };

    const key = `products/${product}/${crypto.randomUUID()}.${UPLOAD_TYPES[type]}`;
    await getImages().put(key, bytes, { httpMetadata: { contentType: type, cacheControl: IMAGE_CACHE_CONTROL } });

    const db = getDb();
    await auditStatement(db, context.admin, "image.uploaded", key, {
      product,
      bytes: file.size,
      type,
    }).run();
    return { ok: true, key, url: mediaUrl(getImageBase(), key) };
  });
