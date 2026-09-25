import {
  decryptField,
  encryptField,
  hashTin,
  isEncryptedField,
  maskEncryptedFieldsDeep,
  maskLastFour,
} from '@utils/fieldEncryption';

describe('fieldEncryption', () => {
  it('round-trips and never stores the plaintext', () => {
    const stored = encryptField('09171234567');
    expect(isEncryptedField(stored)).toBe(true);
    expect(stored).not.toContain('09171234567');
    expect(decryptField(stored)).toBe('09171234567');
  });

  it('encrypts the same value differently each time', () => {
    expect(encryptField('123-456-789-000')).not.toBe(encryptField('123-456-789-000'));
  });

  it('does not double-encrypt', () => {
    const stored = encryptField('09171234567');
    expect(encryptField(stored)).toBe(stored);
  });

  it('reads legacy plaintext values unchanged', () => {
    expect(decryptField('09171234567')).toBe('09171234567');
  });

  it('rejects tampered ciphertext', () => {
    const stored = encryptField('09171234567');
    const tampered = stored.slice(0, -2) + (stored.endsWith('00') ? '11' : '00');
    expect(() => decryptField(tampered)).toThrow();
  });

  it('hashes TINs deterministically for the uniqueness check', () => {
    expect(hashTin('123-456-789-000')).toBe(hashTin('123-456-789-000'));
    expect(hashTin('123-456-789-000')).not.toBe(hashTin('123-456-789-001'));
  });

  it('masks to the last four characters', () => {
    expect(maskLastFour('0917 123 4567')).toBe('••••4567');
  });

  it('masks encrypted values anywhere in a response body', () => {
    const createdAt = new Date('2026-09-25T00:00:00Z');
    const body = {
      data: [{ workerProfile: { payoutAccountNumber: encryptField('09171234567'), createdAt }, name: 'Ana' }],
    };

    const masked = maskEncryptedFieldsDeep(body);

    expect(masked.data[0]!.workerProfile.payoutAccountNumber).toBe('••••4567');
    expect(masked.data[0]!.workerProfile.createdAt).toBe(createdAt);
    expect(masked.data[0]!.name).toBe('Ana');
  });

  it('returns bodies without encrypted values untouched', () => {
    const body = { data: { payoutAccountNumber: '09171234567' } };
    expect(maskEncryptedFieldsDeep(body)).toBe(body);
  });
});
