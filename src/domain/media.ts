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

/**
 * One set of web settings for every product picture. The Bun script (scripts/r2/upload-product-images.ts, Bun.Image)
 * applies them to the original catalogue; the admin page applies them in the browser before upload, because the
 * Worker cannot run Bun.Image and decoding there would exceed the Free plan's 10 ms CPU limit.
 */
export const IMAGE_OPTIMIZATION = {
  /** Longest side in pixels. Product media renders at most about 800 CSS px wide, so 1600 covers 2x screens. */
  maxEdge: 1600,
  /** WebP quality, 0–100. */
  webpQuality: 80,
  /** JPEG fallback for browsers that cannot encode WebP from a canvas (older Safari). */
  jpegQuality: 85,
} as const;

/** Largest optimized upload the Worker accepts. A 1600 px WebP at quality 80 is normally well under 1 MB. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
/** Largest original the admin page will try to optimize (phone photos included). */
export const MAX_SOURCE_BYTES = 30 * 1024 * 1024;

export const UPLOAD_TYPES = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/avif": "avif",
} as const;

export type UploadType = keyof typeof UPLOAD_TYPES;

/** Formats the Worker stores from admin uploads: the optimizer's outputs only. */
export const OPTIMIZED_TYPES = ["image/webp", "image/jpeg"] as const satisfies readonly UploadType[];

/** What the admin file picker offers; anything the browser can decode is converted before upload. */
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

/**
 * Width and height read from a WebP or JPEG header, without decoding pixels (cheap enough for the Worker).
 * Returns null when the header cannot be read; callers treat that as a rejected upload.
 */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const type = sniffImageType(bytes);
  const u16le = (at: number) => (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
  const u24le = (at: number) => u16le(at) | ((bytes[at + 2] ?? 0) << 16);
  const u16be = (at: number) => ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);

  if (type === "image/webp" && bytes.length >= 30) {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === "VP8X") return { width: u24le(24) + 1, height: u24le(27) + 1 };
    if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    }
    if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const [b0, b1, b2, b3] = [bytes[21] ?? 0, bytes[22] ?? 0, bytes[23] ?? 0, bytes[24] ?? 0];
      return {
        width: 1 + (((b1 & 0x3f) << 8) | b0),
        height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
      };
    }
    return null;
  }

  if (type === "image/jpeg") {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1] ?? 0;
      if (marker === 0xff) {
        at += 1; // fill byte
        continue;
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        at += 2; // markers without a length
        continue;
      }
      // Start-of-frame markers carry the size; C4 (DHT), C8 (JPG) and CC (DAC) share the range but do not.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: u16be(at + 7), height: u16be(at + 5) };
      }
      at += 2 + u16be(at + 2);
    }
  }
  return null;
}

/** Content type for a stored key, from its extension (keys are validated, so the extension is trustworthy). */
export function contentTypeForKey(key: string): UploadType | null {
  const extension = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  if (extension === "jpeg" || extension === "jpg") return "image/jpeg";
  const match = Object.entries(UPLOAD_TYPES).find(([, ext]) => ext === extension);
  return (match?.[0] as UploadType | undefined) ?? null;
}
