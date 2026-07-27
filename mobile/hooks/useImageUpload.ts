import { useState, useCallback } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { compressImage, validateImageSize, formatFileSize } from '../utils/imageCompressor';

export type ImageUploadState = {
  uri: string | null;
  loading: boolean;
  error: string | null;
  compressedSize?: number;
  originalSize?: number;
  compressionRatio?: number;
};

export type UseImageUploadOptions = {
  maxSizeBytes?: number; // Default: 5MB
  quality?: number; // Default: 0.7 (0-1)
  maxDimension?: number; // Default: 1200px
};

/**
 * useImageUpload
 * 
 * Hook to handle image selection with automatic compression and validation.
 * 
 * Usage:
 *   const { uri, loading, error, pickImage, clearImage } = useImageUpload();
 *   
 *   <Pressable onPress={() => pickImage('camera')}>
 *     <Text>Take Photo</Text>
 *   </Pressable>
 *   
 *   {error && <Text>{error}</Text>}
 *   {uri && <Image source={{ uri }} />}
 */
export function useImageUpload(options: UseImageUploadOptions = {}) {
  const [state, setState] = useState<ImageUploadState>({
    uri: null,
    loading: false,
    error: null,
  });

  const maxSizeBytes = options.maxSizeBytes || 5 * 1024 * 1024; // 5MB
  const quality = options.quality || 0.7;
  const maxDimension = options.maxDimension || 1200;

  /**
   * Process selected image: validate, compress, return result
   */
  const processImage = useCallback(
    async (imageUri: string) => {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        // Step 1: Validate file size before compression
        const sizeValidation = await validateImageSize(imageUri, maxSizeBytes);
        if (!sizeValidation.valid) {
          setState((prev) => ({
            ...prev,
            loading: false,
            error: sizeValidation.message || 'Image is too large',
          }));
          return null;
        }

        // Step 2: Compress image
        const compressed = await compressImage(imageUri, maxDimension, quality);

        // Step 3: Validate compressed size (should be smaller)
        const finalValidation = await validateImageSize(compressed.uri, maxSizeBytes);
        if (!finalValidation.valid) {
          setState((prev) => ({
            ...prev,
            loading: false,
            error: 'Compressed image still too large',
          }));
          return null;
        }

        // Success: update state with compressed image
        setState({
          uri: compressed.uri,
          loading: false,
          error: null,
          compressedSize: compressed.compressedSize,
          originalSize: compressed.originalSize,
          compressionRatio: compressed.compressionRatio,
        });

        console.log(
          `✓ Image compressed: ${formatFileSize(compressed.originalSize)} → ${formatFileSize(compressed.compressedSize)} (${compressed.compressionRatio}% smaller)`
        );

        return compressed.uri;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to process image';
        setState((prev) => ({
          ...prev,
          loading: false,
          error: errorMessage,
        }));
        return null;
      }
    },
    [maxSizeBytes, quality, maxDimension]
  );

  /**
   * Pick image from camera
   */
  const pickFromCamera = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        setState((prev) => ({
          ...prev,
          error: 'Camera permission required to take photos',
        }));
        return null;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 1, // Full quality before compression
      });

      if (!result.canceled && result.assets[0]?.uri) {
        return await processImage(result.assets[0].uri);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Camera error';
      setState((prev) => ({
        ...prev,
        error: errorMessage,
      }));
    }
    return null;
  }, [processImage]);

  /**
   * Pick image from gallery
   */
  const pickFromGallery = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 1, // Full quality before compression
      });

      if (!result.canceled && result.assets[0]?.uri) {
        return await processImage(result.assets[0].uri);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Gallery error';
      setState((prev) => ({
        ...prev,
        error: errorMessage,
      }));
    }
    return null;
  }, [processImage]);

  /**
   * Clear selected image
   */
  const clearImage = useCallback(() => {
    setState({
      uri: null,
      loading: false,
      error: null,
    });
  }, []);

  /**
   * Clear error message
   */
  const clearError = useCallback(() => {
    setState((prev) => ({
      ...prev,
      error: null,
    }));
  }, []);

  return {
    // State
    uri: state.uri,
    loading: state.loading,
    error: state.error,
    compressedSize: state.compressedSize,
    originalSize: state.originalSize,
    compressionRatio: state.compressionRatio,

    // Actions
    pickFromCamera,
    pickFromGallery,
    clearImage,
    clearError,

    // Combined action
    pickImage: async (source: 'camera' | 'gallery') => {
      return source === 'camera' ? pickFromCamera() : pickFromGallery();
    },
  };
}
