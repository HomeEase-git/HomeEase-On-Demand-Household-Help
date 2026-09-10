import sharp from 'sharp';
import { normalizeImage, UnsupportedImageError } from '@utils/normalizeImage';

async function solidPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .png()
    .toBuffer();
}

describe('utils/normalizeImage', () => {
  it('downscales a large image to fit within 1600px and re-encodes as JPEG', async () => {
    const input = await solidPng(4000, 3000);
    const result = await normalizeImage(input);

    expect(result.mimeType).toBe('image/jpeg');
    expect(result.extension).toBe('jpeg');
    expect(result.byteLength).toBe(result.buffer.length);

    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1600);
    // 4000x3000 -> long edge clamped to 1600, aspect ratio kept
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(1200);
    expect(result.byteLength).toBeLessThan(input.length);
  });

  it('does not enlarge an image already under the limit', async () => {
    const input = await solidPng(500, 400);
    const result = await normalizeImage(input);

    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(500);
    expect(meta.height).toBe(400);
  });

  it('throws UnsupportedImageError for input it cannot decode', async () => {
    await expect(normalizeImage(Buffer.from('this is definitely not an image'))).rejects.toBeInstanceOf(
      UnsupportedImageError
    );
  });
});
