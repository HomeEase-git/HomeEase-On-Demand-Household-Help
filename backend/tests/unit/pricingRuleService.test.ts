import { isPriceWithinBounds } from '@services/pricingRuleService';

describe('pricingRuleService — boundary check (pure)', () => {
  const bounds = { minPrice: 500, maxPrice: 2000 };

  it('accepts a price within bounds', () => {
    expect(isPriceWithinBounds(1000, bounds)).toBe(true);
  });

  it('accepts prices exactly at the boundaries (inclusive)', () => {
    expect(isPriceWithinBounds(500, bounds)).toBe(true);
    expect(isPriceWithinBounds(2000, bounds)).toBe(true);
  });

  it('rejects a price just below the minimum', () => {
    expect(isPriceWithinBounds(499.99, bounds)).toBe(false);
  });

  it('rejects a price just above the maximum', () => {
    expect(isPriceWithinBounds(2000.01, bounds)).toBe(false);
  });

  it('rejects prices far outside the range in either direction', () => {
    expect(isPriceWithinBounds(0, bounds)).toBe(false);
    expect(isPriceWithinBounds(1_000_000, bounds)).toBe(false);
  });

  it('handles a degenerate min === max range as a single accepted point', () => {
    const pinned = { minPrice: 750, maxPrice: 750 };
    expect(isPriceWithinBounds(750, pinned)).toBe(true);
    expect(isPriceWithinBounds(749, pinned)).toBe(false);
    expect(isPriceWithinBounds(751, pinned)).toBe(false);
  });
});
