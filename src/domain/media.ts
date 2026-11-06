// Product image keys, URLs and upload checks. Pure: shared by the Worker, the admin form and tests.
//
// D1 stores R2 object keys ("product-images/…" for the original catalogue, "products/<id>/<uuid>.webp" for uploads).
// mediaUrl() turns a key into a URL: the bucket's custom domain when IMAGE_BASE_URL is set, else the Worker's
// /media/<key> route. A value that starts with "/" is an old static path and is returned unchanged.

/** Keys the app writes or migrated: no "..", no leading slash, a known prefix and an image extension. */
export const IMAGE_KEY_PATTERN =
  /^(?:product-images\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+|products\/(?:\d+|new)\/[0-9a-f-]{36})\.(?:webp|jpe?g|png|avif)$/i;

export const MEDIA_ROUTE = "/media/";

export function isImageKey(value: string): boolean {
  return IMAGE_KEY_PATTERN.test(value) && !value.includes("..");
}

export function mediaUrl(base: string, key: string): string {
  if (key.startsWith("/")) return key;
  const path = key.split("/").map(encodeURIComponent).join("/");
  return base ? `${base}/${path}` : `${MEDIA_ROUTE}${path}`;
}

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const UPLOAD_TYPES = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/avif": "avif",
} as const;

export type UploadType = keyof typeof UPLOAD_TYPES;

export const UPLOAD_ACCEPT = Object.keys(UPLOAD_TYPES).join(",");

/** Year-long immutable caching is safe because every upload gets a new random key. */
export const IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * Identifies the image format from its first bytes, ignoring the browser-supplied type and file name.
 * Returns null for anything that is not WebP, JPEG, PNG or AVIF.
 */
export function sniffImageType(bytes: Uint8Array): UploadType | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)
  ) {
    return "image/png";
  }
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(8, 12))) return "image/avif";
  return null;
}

/** Content type for a stored key, from its extension (keys are validated, so the extension is trustworthy). */
export function contentTypeForKey(key: string): UploadType | null {
  const extension = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  if (extension === "jpeg" || extension === "jpg") return "image/jpeg";
  const match = Object.entries(UPLOAD_TYPES).find(([, ext]) => ext === extension);
  return (match?.[0] as UploadType | undefined) ?? null;
}
