import { isValidTin, normalizeTin, maskTin } from '@utils/taxId';

describe('utils/taxId', () => {
  describe('isValidTin', () => {
    it('accepts a 9-digit TIN, dashed or plain', () => {
      expect(isValidTin('123-456-789')).toBe(true);
      expect(isValidTin('123456789')).toBe(true);
    });

    it('accepts a 12-digit TIN with a branch code, dashed or plain', () => {
      expect(isValidTin('123-456-789-000')).toBe(true);
      expect(isValidTin('123456789000')).toBe(true);
    });

    it('rejects the wrong digit count', () => {
      expect(isValidTin('123-456-78')).toBe(false);
      expect(isValidTin('123-456-789-0')).toBe(false);
    });

    it('rejects non-numeric input', () => {
      expect(isValidTin('abc-def-ghi')).toBe(false);
      expect(isValidTin('')).toBe(false);
    });

    it('tolerates surrounding whitespace', () => {
      expect(isValidTin('  123-456-789  ')).toBe(true);
    });
  });

  describe('normalizeTin', () => {
    it('formats a 9-digit TIN as 000-000-000', () => {
      expect(normalizeTin('123456789')).toBe('123-456-789');
    });

    it('formats a 12-digit TIN as 000-000-000-000', () => {
      expect(normalizeTin('123456789000')).toBe('123-456-789-000');
    });

    it('re-normalizes an already-dashed input', () => {
      expect(normalizeTin('123-456-789')).toBe('123-456-789');
    });
  });

  describe('maskTin', () => {
    it('shows only the last 3 digits', () => {
      expect(maskTin('123-456-789')).toBe('•••-•••-789');
    });
  });
});
