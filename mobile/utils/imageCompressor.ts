import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'react-native';
import { File } from 'expo-file-system';

export type CompressionResult = {
  uri: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
};

export async function compressImage(
  uri: string,
  maxDimension: number = 1600,
  quality: number = 0.7,
  size?: { width?: number; height?: number }
): Promise<CompressionResult> {
  try {
    // Get original file size
    const originalSize = await getFileSizeFromUri(uri);

    const resize = await resizeAction(uri, maxDimension, size);
    const manipulatedImage = await ImageManipulator.manipulateAsync(uri, resize ? [resize] : [], {
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

async function resizeAction(
  uri: string,
  maxDimension: number,
  size?: { width?: number; height?: number }
): Promise<ImageManipulator.Action | null> {
  let width = size?.width ?? 0;
  let height = size?.height ?? 0;
  if (!width || !height) {
    try {
      ({ width, height } = await new Promise<{ width: number; height: number }>((resolve, reject) =>
        Image.getSize(uri, (w, h) => resolve({ width: w, height: h }), reject)
      ));
    } catch {
      return { resize: { width: maxDimension } };
    }
  }
  if (Math.max(width, height) <= maxDimension) return null;
  return width >= height ? { resize: { width: maxDimension } } : { resize: { height: maxDimension } };
}

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

async function getFileSizeFromUri(uri: string): Promise<number> {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) {
    throw new Error('Invalid image URI');
  }

  return new File(uri).size;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Number((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
