import type { Request, Response } from 'express';
import { validateAddAddress, validateUpdateAddress } from '../../src/middleware/validation';

type Validator = typeof validateAddAddress;

function run(validator: Validator, body: Record<string, unknown>) {
  const json = jest.fn((_body: { message?: string }) => ({}));
  const status = jest.fn(() => ({ json }));
  const next = jest.fn();
  validator({ body } as Request, { status } as unknown as Response, next);
  return {
    passed: next.mock.calls.length === 1,
    message: json.mock.calls[0]?.[0]?.message,
  };
}

const PIN = { lat: 14.8, lng: 120.79 };

describe('validateAddAddress', () => {
  it('accepts a single-line address with a map pin and no split fields', () => {
    expect(run(validateAddAddress, { label: 'Home', fullAddress: 'Blk 4 Lot 12, Paombong, Bulacan', ...PIN }).passed).toBe(true);
  });

  it('requires the pin when fullAddress is sent', () => {
    const result = run(validateAddAddress, { label: 'Home', fullAddress: 'Paombong, Bulacan' });
    expect(result.passed).toBe(false);
    expect(result.message).toMatch(/lat and lng are required/);
  });

  it('rejects a blank fullAddress', () => {
    expect(run(validateAddAddress, { label: 'Home', fullAddress: '   ', ...PIN }).passed).toBe(false);
  });

  it('rejects a pin outside the Philippines', () => {
    expect(run(validateAddAddress, { label: 'Home', fullAddress: 'Somewhere', lat: 51.5, lng: -0.12 }).passed).toBe(false);
  });

  it('still accepts the split fields from older app versions', () => {
    const legacy = { label: 'Home', street: 'Rizal St', city: 'Manila', state: 'Metro Manila', zipCode: '1000' };
    expect(run(validateAddAddress, legacy).passed).toBe(true);
  });

  it('still requires street/city/state/zipCode when fullAddress is absent', () => {
    const result = run(validateAddAddress, { label: 'Home', street: 'Rizal St', city: 'Manila' });
    expect(result.passed).toBe(false);
    expect(result.message).toMatch(/state is required/);
  });
});

describe('validateUpdateAddress', () => {
  it('accepts a fullAddress edit', () => {
    expect(run(validateUpdateAddress, { fullAddress: 'Unit 3B, Paombong, Bulacan' }).passed).toBe(true);
  });

  it('rejects an emptied fullAddress', () => {
    expect(run(validateUpdateAddress, { fullAddress: '' }).passed).toBe(false);
  });
});
