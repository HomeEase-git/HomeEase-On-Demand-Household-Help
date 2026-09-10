import { mimeTypeFromUrl, storagePathFromUrl } from '@utils/kycFileMeta';

describe('utils/kycFileMeta', () => {
  describe('mimeTypeFromUrl', () => {
    it('maps known image and pdf extensions', () => {
      expect(mimeTypeFromUrl('https://x.supabase.co/storage/v1/object/public/kyc/u1/abc.jpg')).toBe('image/jpeg');
      expect(mimeTypeFromUrl('https://x/abc.jpeg')).toBe('image/jpeg');
      expect(mimeTypeFromUrl('https://x/abc.PNG')).toBe('image/png');
      expect(mimeTypeFromUrl('https://x/abc.webp')).toBe('image/webp');
      expect(mimeTypeFromUrl('https://x/abc.pdf')).toBe('application/pdf');
    });

    it('ignores query strings and fragments', () => {
      expect(mimeTypeFromUrl('https://x/u1/abc.jpeg?token=eyJ&download=1')).toBe('image/jpeg');
      expect(mimeTypeFromUrl('https://x/u1/abc.pdf#page=2')).toBe('application/pdf');
    });

    it('returns null for unknown or missing extensions', () => {
      expect(mimeTypeFromUrl('https://x/u1/abc.heic')).toBeNull();
      expect(mimeTypeFromUrl('https://x/u1/abc')).toBeNull();
      expect(mimeTypeFromUrl('https://x/u1/abc.bin')).toBeNull();
      expect(mimeTypeFromUrl('')).toBeNull();
      expect(mimeTypeFromUrl(null)).toBeNull();
      expect(mimeTypeFromUrl(undefined)).toBeNull();
    });
  });

  describe('storagePathFromUrl', () => {
    it('extracts the object path from a Supabase public URL', () => {
      expect(
        storagePathFromUrl('https://x.supabase.co/storage/v1/object/public/kyc-documents/user-1/abc-123.jpeg')
      ).toBe('user-1/abc-123.jpeg');
    });

    it('handles signed URLs and decodes percent-encoding', () => {
      expect(
        storagePathFromUrl('https://x/storage/v1/object/sign/kyc-documents/user%201/abc.pdf?token=z')
      ).toBe('user 1/abc.pdf');
    });

    it('falls back to the last path segment for unrecognised URLs', () => {
      expect(storagePathFromUrl('https://cdn.example.com/whatever/abc.png')).toBe('abc.png');
      expect(storagePathFromUrl(null)).toBeNull();
    });
  });
});
