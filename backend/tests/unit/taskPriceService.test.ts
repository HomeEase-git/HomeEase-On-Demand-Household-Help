import { storedWorkerPrice } from '@services/taskPriceService';

describe('storedWorkerPrice', () => {
  const row = (price: number | null, unitPrice: number | null, isActive = true) => ({ price, unitPrice, isActive });

  it('reads the flat price for FIXED and the rate for PER_UNIT', () => {
    expect(storedWorkerPrice('FIXED', row(800, 150))).toBe(800);
    expect(storedWorkerPrice('PER_UNIT', row(800, 150))).toBe(150);
  });

  it("treats a price stored for the other model as not priced, never ₱0", () => {
    expect(storedWorkerPrice('PER_UNIT', row(800, null))).toBeNull();
    expect(storedWorkerPrice('FIXED', row(null, 150))).toBeNull();
  });

  it('treats a missing or inactive row as not priced', () => {
    expect(storedWorkerPrice('FIXED', null)).toBeNull();
    expect(storedWorkerPrice('FIXED', row(800, null, false))).toBeNull();
  });
});
