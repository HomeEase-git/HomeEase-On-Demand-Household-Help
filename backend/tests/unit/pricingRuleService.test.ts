import { isPriceWithinBounds, checkDoleFloor } from '@services/pricingRuleService';
import { getDoleWageReference, getHighestDoleWageReference } from '@/constants/doleWageReference';

// checkDoleFloor takes an already-resolved DoleWageReference (or null) —
// see pricingRuleService.ts's comment — so callers resolve the city
// themselves via getDoleWageReference first.
function checkDoleFloorForCity(city: string, minPrice: number, overrideReason: string | undefined) {
  return checkDoleFloor(getDoleWageReference(city), minPrice, overrideReason);
}

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

describe('pricingRuleService — DOLE wage floor check (pure, soft guardrail)', () => {
  it('does not block a price at or above the regional hourly floor', () => {
    expect(checkDoleFloorForCity('Manila', 100, undefined)).toEqual({ blocked: false, note: null });
    expect(checkDoleFloorForCity('Malolos', 75, undefined)).toEqual({ blocked: false, note: null });
  });

  it('blocks a below-floor price with no override reason', () => {
    const result = checkDoleFloorForCity('Manila', 10, undefined);
    expect(result.blocked).toBe(true);
  });

  it('blocks a below-floor price when the override reason is blank/whitespace', () => {
    expect(checkDoleFloorForCity('Manila', 10, '')).toEqual(
      expect.objectContaining({ blocked: true })
    );
    expect(checkDoleFloorForCity('Manila', 10, '   ')).toEqual(
      expect.objectContaining({ blocked: true })
    );
  });

  it('allows a below-floor price through once a reason is given, and returns an audit note', () => {
    const result = checkDoleFloorForCity('Manila', 10, 'Promo rate for launch week');
    expect(result.blocked).toBe(false);
    expect(result.blocked === false && result.note).toEqual(expect.stringContaining('Promo rate for launch week'));
  });

  it('does not block a city with no DOLE mapping, regardless of price', () => {
    expect(checkDoleFloorForCity('Some Unmapped Town', 1, undefined)).toEqual({ blocked: false, note: null });
  });

  it('is case-insensitive and whitespace-tolerant on city name', () => {
    expect(checkDoleFloorForCity('  MANILA  ', 10, undefined).blocked).toBe(true);
  });
});

describe('pricingRuleService — checkDoleFloor with a city-agnostic reference', () => {
  it('blocks/allows using getHighestDoleWageReference the same way a city-resolved one would', () => {
    // ServiceTask.minPrice has no city, so adminServiceTaskController checks
    // against the single highest regional floor instead — same function,
    // just handed an already-resolved reference instead of a city lookup.
    const highest = getHighestDoleWageReference();
    expect(checkDoleFloor(highest, highest.hourlyWage, undefined)).toEqual({ blocked: false, note: null });
    expect(checkDoleFloor(highest, highest.hourlyWage - 1, undefined).blocked).toBe(true);
    expect(checkDoleFloor(null, 1, undefined)).toEqual({ blocked: false, note: null });
  });
});
