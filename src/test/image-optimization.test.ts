// Checks the Bun.Image pipeline and the Worker's header reader against real encoder output.
// Test pictures are generated: a BMP is built byte by byte (Bun.Image decodes BMP), then re-encoded.
import { describe, expect, test } from "bun:test";
import { IMAGE_OPTIMIZATION, imageDimensions, sniffImageType } from "@/domain/media";
import { optimizeWithBun } from "../../scripts/r2/optimize";

/** An uncompressed 24-bit BMP with a colour gradient, so encoders have real detail to work on. */
function bmp(width: number, height: number): Uint8Array {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + rowSize * height;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set([0x42, 0x4d]);
  view.setUint32(2, size, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = 54 + y * rowSize + x * 3;
      out[at] = (x * 255) / width;
      out[at + 1] = (y * 255) / height;
      out[at + 2] = ((x + y) * 97) % 256;
    }
  }
  return out;
}

describe("imageDimensions matches Bun.Image output", () => {
  const source = bmp(321, 123);
  test.each([
    ["lossy WebP", (img: Bun.Image) => img.webp({ quality: 80 })],
    ["lossless WebP", (img: Bun.Image) => img.webp({ lossless: true })],
    ["JPEG", (img: Bun.Image) => img.jpeg({ quality: 85 })],
    ["progressive JPEG", (img: Bun.Image) => img.jpeg({ quality: 85, progressive: true })],
  ])("%s", async (_name, encode) => {
    const bytes = await encode(new Bun.Image(source)).bytes();
    expect(imageDimensions(bytes)).toEqual({ width: 321, height: 123 });
  });

  test("extended WebP header (VP8X), as browsers write for canvases with alpha", () => {
    const header = new Uint8Array(30);
    header.set(new TextEncoder().encode("RIFF"), 0);
    header.set(new TextEncoder().encode("WEBPVP8X"), 8);
    header[16] = 10; // chunk size
    header[20] = 0x10; // alpha flag
    const width = 1600 - 1;
    const height = 1067 - 1;
    header.set([width & 0xff, (width >> 8) & 0xff, width >> 16], 24);
    header.set([height & 0xff, (height >> 8) & 0xff, height >> 16], 27);
    expect(imageDimensions(header)).toEqual({ width: 1600, height: 1067 });
  });

  test("returns null for PNG and junk (the Worker only stores WebP/JPEG uploads)", async () => {
    const png = await new Bun.Image(source).png().bytes();
    expect(sniffImageType(png)).toBe("image/png");
    expect(imageDimensions(png)).toBeNull();
    expect(imageDimensions(new TextEncoder().encode("RIFF....WEBPjunk"))).toBeNull();
  });
});

describe("optimizeWithBun", () => {
  test("shrinks a large picture to the max edge, keeping the aspect ratio and the key's format", async () => {
    const original = await new Bun.Image(bmp(3200, 1600)).webp({ quality: 100 }).bytes();
    const result = await optimizeWithBun(original, "image/webp");
    expect(result.keptOriginal).toBe(false);
    expect([result.width, result.height]).toEqual([IMAGE_OPTIMIZATION.maxEdge, IMAGE_OPTIMIZATION.maxEdge / 2]);
    expect(sniffImageType(result.bytes)).toBe("image/webp");
    expect(imageDimensions(result.bytes)).toEqual({ width: 1600, height: 800 });
    expect(result.bytes.length).toBeLessThan(original.length);
  });

  test("never enlarges, and keeps a small original that the re-encode cannot beat", async () => {
    const small = await new Bun.Image(bmp(200, 100)).webp({ quality: 30 }).bytes();
    const result = await optimizeWithBun(small, "image/webp");
    expect([result.width, result.height]).toEqual([200, 100]);
    expect(result.keptOriginal).toBe(true);
    expect(result.bytes).toBe(small);
  });

  test("JPEG keys stay JPEG", async () => {
    const original = await new Bun.Image(bmp(2000, 2000)).jpeg({ quality: 100 }).bytes();
    const result = await optimizeWithBun(original, "image/jpeg");
    expect(sniffImageType(result.bytes)).toBe("image/jpeg");
    expect(imageDimensions(result.bytes)).toEqual({ width: 1600, height: 1600 });
  });
});
