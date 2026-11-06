// Browser-side picture optimization for admin uploads: the same result the Bun script gives the original catalogue
// (longest side IMAGE_OPTIMIZATION.maxEdge, WebP at webpQuality), using the browser's own decoder and canvas encoder.
// Runs before upload because the Worker cannot run Bun.Image or afford to decode images on the Free plan.
import { IMAGE_OPTIMIZATION, imageDimensions, sniffImageType } from "@/domain/media";

export interface OptimizedImage {
  file: File;
  width: number;
  height: number;
  /** Size of the picture the admin picked, for the "x MB → y KB" note. */
  originalBytes: number;
}

type Canvas = OffscreenCanvas | HTMLCanvasElement;

function createCanvas(width: number, height: number): Canvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function encode(canvas: Canvas, type: string, quality: number): Promise<Blob | null> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality }).catch(() => null);
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function baseName(name: string) {
  return (name.replace(/\.[^.]+$/, "") || "picture").slice(0, 80);
}

export async function optimizeImage(file: File): Promise<OptimizedImage> {
  // "from-image" applies EXIF rotation, so phone photos are not stored sideways.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => {
    throw new Error(`${file.name} could not be opened as a picture in this browser.`);
  });
  try {
    const scale = Math.min(1, IMAGE_OPTIMIZATION.maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const draw = (background?: string) => {
      const canvas = createCanvas(width, height);
      const context = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!context) throw new Error("This browser cannot process pictures.");
      if (background) {
        context.fillStyle = background;
        context.fillRect(0, 0, width, height);
      }
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, width, height);
      return canvas;
    };

    let blob = await encode(draw(), "image/webp", IMAGE_OPTIMIZATION.webpQuality / 100);
    let extension = "webp";
    // Browsers without a WebP encoder silently return PNG; use JPEG instead (white behind any transparency).
    if (!blob || blob.type !== "image/webp") {
      blob = await encode(draw("#ffffff"), "image/jpeg", IMAGE_OPTIMIZATION.jpegQuality / 100);
      extension = "jpg";
    }
    if (!blob) throw new Error(`${file.name} could not be converted.`);

    // An original that is already a small WebP/JPEG can beat a re-encode; keep it rather than lose quality.
    const originalBytes = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
    const originalType = sniffImageType(originalBytes);
    const originalSize = imageDimensions(originalBytes);
    const originalFits =
      (originalType === "image/webp" || originalType === "image/jpeg") &&
      originalSize !== null &&
      Math.max(originalSize.width, originalSize.height) <= IMAGE_OPTIMIZATION.maxEdge;
    if (originalFits && file.size <= blob.size) {
      return { file, width: originalSize.width, height: originalSize.height, originalBytes: file.size };
    }

    return {
      file: new File([blob], `${baseName(file.name)}.${extension}`, { type: blob.type }),
      width,
      height,
      originalBytes: file.size,
    };
  } finally {
    bitmap.close();
  }
}
