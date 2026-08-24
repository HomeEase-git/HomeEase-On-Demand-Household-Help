import * as ImageManipulator from 'expo-image-manipulator';
import { File } from 'expo-file-system';

export type CompressionResult = {
  uri: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
};

/**
 * Compresses an image by resizing and reducing quality.
 * 
 * Targets:
 * - Max width/height: 1200px (maintains quality for most use cases)
 * - Quality: 0.7 (70% quality for good balance of size/quality)
 * - Format: JPEG for lossy compression
 * 
 * @param uri - Image URI (file:// or content://)
 * @param maxDimension - Maximum width or height (default 1200)
 * @param quality - Compression quality 0-1 (default 0.7)
 * @returns Compressed image URI and size info
 */
export async function compressImage(
  uri: string,
  maxDimension: number = 1200,
  quality: number = 0.7
): Promise<CompressionResult> {
  try {
    // Get original file size
    const originalSize = await getFileSizeFromUri(uri);

    // Manipulate image: resize and compress
    const manipulatedImage = await ImageManipulator.manipulateAsync(uri, [
      {
        resize: {
          width: maxDimension,
          height: maxDimension,
        },
      },
    ], {
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG,
    });

    // Get compressed file size
    const compressedSize = await getFileSizeFromUri(manipulatedImage.uri);

    return {
      uri: manipulatedImage.uri,
      originalSize,
      compressedSize,
      compressionRatio: Number(((1 - compressedSize / originalSize) * 100).toFixed(2)),
    };
  } catch (error) {
    console.error('Image compression failed:', error);
    throw new Error('Failed to compress image. Please try again.');
  }
}

/**
 * Validates image file size.
 * 
 * @param uri - Image URI
 * @param maxSizeBytes - Maximum allowed size (default 5MB)
 * @returns true if file is within size limit
 */
export async function validateImageSize(
  uri: string,
  maxSizeBytes: number = 5 * 1024 * 1024, // 5MB default
  fileSizeOverride?: number
): Promise<{ valid: boolean; message?: string; fileSize?: number }> {
  try {
    const fileSize = fileSizeOverride ?? await getFileSizeFromUri(uri);
    const isValid = fileSize <= maxSizeBytes;

    if (!isValid) {
      const maxSizeMB = (maxSizeBytes / 1024 / 1024).toFixed(1);
      const fileSizeMB = (fileSize / 1024 / 1024).toFixed(1);
      return {
        valid: false,
        message: `Image is too large (${fileSizeMB}MB). Maximum allowed: ${maxSizeMB}MB`,
        fileSize,
      };
    }

    return { valid: true, fileSize };
  } catch (error) {
    console.error('Image size validation failed:', error);
    return {
      valid: false,
      message: 'Unable to validate image size. Please try again.',
    };
  }
}

/**
 * Get file size in bytes from URI.
 *
 * Uses expo-file-system's File class to read the actual file size.
 *
 * @param uri - File URI
 * @returns File size in bytes (0 if the file doesn't exist or can't be read)
 */
async function getFileSizeFromUri(uri: string): Promise<number> {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) {
    throw new Error('Invalid image URI');
  }

  return new File(uri).size;
}

/**
 * Format bytes to human-readable size.
 * 
 * @param bytes - Size in bytes
 * @returns Formatted string (e.g., "2.5 MB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Number((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
