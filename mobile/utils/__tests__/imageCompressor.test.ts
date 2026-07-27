import * as imageCompressor from '../imageCompressor';

// Mock expo-image-manipulator
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(() =>
    Promise.resolve({ uri: 'file:///compressed-image.jpg' })
  ),
  SaveFormat: { JPEG: 'jpeg' },
}));

describe('Image Compression', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Format File Size', () => {
    it('should format bytes correctly', () => {
      expect(imageCompressor.formatFileSize(0)).toBe('0 B');
      expect(imageCompressor.formatFileSize(1024)).toBe('1 KB');
      expect(imageCompressor.formatFileSize(1024 * 1024)).toBe('1 MB');
      expect(imageCompressor.formatFileSize(1024 * 1024 * 1024)).toBe('1 GB');
    });

    it('should handle partial sizes', () => {
      const size = 2.5 * 1024 * 1024; // 2.5 MB
      expect(imageCompressor.formatFileSize(size)).toContain('MB');
    });

    it('should handle very large sizes', () => {
      const size = 5 * 1024 * 1024 * 1024; // 5 GB
      expect(imageCompressor.formatFileSize(size)).toContain('GB');
    });
  });

  describe('Validate Image Size', () => {
    it('should return valid for small files', async () => {
      const result = await imageCompressor.validateImageSize(
        'file:///image.jpg',
        5 * 1024 * 1024
      );
      expect(result.valid).toBe(true);
    });

    it('should return error message for oversized files', async () => {
      const result = await imageCompressor.validateImageSize(
        'file:///large-image.jpg',
        1 * 1024 * 1024, // 1MB limit
        10 * 1024 * 1024 // 10MB file
      );
      expect(result.valid).toBe(false);
      expect(result.message).toContain('too large');
      expect(result.fileSize).toBe(10 * 1024 * 1024);
    });

    it('should handle errors gracefully', async () => {
      const result = await imageCompressor.validateImageSize('invalid-uri');
      expect(result.valid).toBe(false);
    });
  });

  describe('Compress Image', () => {
    it('should compress image successfully', async () => {
      const result = await imageCompressor.compressImage(
        'file:///original-image.jpg'
      );

      expect(result).toHaveProperty('uri');
      expect(result.uri).toBe('file:///compressed-image.jpg');
      expect(result).toHaveProperty('compressionRatio');
    });

    it('should use default compression settings', async () => {
      const { manipulateAsync } = require('expo-image-manipulator');

      await imageCompressor.compressImage('file:///image.jpg');

      expect(manipulateAsync).toHaveBeenCalled();
      const callArgs = manipulateAsync.mock.calls[0];
      expect(callArgs[0]).toBe('file:///image.jpg');
    });

    it('should accept custom compression parameters', async () => {
      const { manipulateAsync } = require('expo-image-manipulator');

      await imageCompressor.compressImage(
        'file:///image.jpg',
        800, // maxDimension
        0.5 // quality
      );

      expect(manipulateAsync).toHaveBeenCalled();
    });

    it('should handle compression errors', async () => {
      const { manipulateAsync } = require('expo-image-manipulator');
      manipulateAsync.mockRejectedValueOnce(new Error('Compression failed'));

      await expect(
        imageCompressor.compressImage('file:///image.jpg')
      ).rejects.toThrow('Failed to compress image');
    });
  });
});
