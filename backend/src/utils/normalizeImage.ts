import sharp from 'sharp';

const MAX_EDGE = 1600;
const JPEG_QUALITY = 80;

export class UnsupportedImageError extends Error {
  constructor(message = 'Image could not be decoded') {
    super(message);
    this.name = 'UnsupportedImageError';
  }
}

export interface NormalizedImage {
  buffer: Buffer;
  mimeType: 'image/jpeg';
  extension: 'jpeg';
  byteLength: number;
}

export async function normalizeImage(input: Buffer): Promise<NormalizedImage> {
  try {
    const buffer = await sharp(input)
      .rotate() // apply EXIF orientation, then strip it
      .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();

    return { buffer, mimeType: 'image/jpeg', extension: 'jpeg', byteLength: buffer.length };
  } catch (err) {
    throw new UnsupportedImageError(
      err instanceof Error ? `Image could not be processed: ${err.message}` : undefined
    );
  }
}
