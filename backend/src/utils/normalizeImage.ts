import sharp from 'sharp';

// KYC photos come off phones at 3-12 MB / 4000px+. Anthropic downscales images
// to ~1568px on the long edge anyway, and large originals bloat the Supabase
// bucket, the AI-review request payload, and the worker's memory. Normalising on
// upload gives every downstream consumer a small, consistently-encoded JPEG.
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

/**
 * Auto-orients (honouring EXIF), downscales to fit within MAX_EDGE, and
 * re-encodes as JPEG. Throws {@link UnsupportedImageError} for input sharp can't
 * decode (e.g. HEIC, which the default prebuilt binaries don't support) so the
 * caller can return a clear 4xx instead of a 500.
 */
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
