import { taskBasePrice } from '@services/taskPriceService';

describe('taskBasePrice', () => {
  const perUnit = { basePrice: 350, pricingModel: 'PER_UNIT', unitLabel: 'unit' };

  it('charges the admin price for a FIXED task, whatever the quantity', () => {
    expect(taskBasePrice({ basePrice: 800, pricingModel: 'FIXED' }, undefined)).toEqual({ ok: true, basePrice: 800 });
  });

  it('multiplies the admin rate by the quantity for PER_UNIT', () => {
    expect(taskBasePrice(perUnit, 3)).toEqual({ ok: true, basePrice: 1050, quantity: 3 });
  });

  it('charges a leftover TIERED task like PER_UNIT', () => {
    expect(taskBasePrice({ basePrice: 100, pricingModel: 'TIERED' }, 2.5)).toEqual({ ok: true, basePrice: 250, quantity: 2.5 });
  });

  it('asks for the quantity instead of pricing at ₱0', () => {
    expect(taskBasePrice(perUnit, undefined)).toEqual({ ok: false, message: 'Enter how many (unit) for this job' });
  });

  it.each([0, -2, 0.5, Infinity, 'two', '   ', null])(
    'never prices a per-unit job from a count of %p (no ₱0 or negative jobs)',
    (quantity) => {
      expect(taskBasePrice(perUnit, quantity).ok).toBe(false);
    }
  );

  it("enforces the job's own minimum and maximum", () => {
    const wall = { basePrice: 100, pricingModel: 'PER_UNIT', unitLabel: 'sq.m.', minQuantity: 10, maxQuantity: 1000 };
    expect(taskBasePrice(wall, 9)).toMatchObject({ ok: false, message: 'This job needs at least 10 (sq.m.)' });
    expect(taskBasePrice(wall, 1001)).toMatchObject({ ok: false, message: 'This job takes at most 1000 (sq.m.)' });
    expect(taskBasePrice(wall, 12.5)).toEqual({ ok: true, basePrice: 1250, quantity: 12.5 });
  });

  it('never lets a minimum below 1 through', () => {
    expect(taskBasePrice({ ...perUnit, minQuantity: 0 }, 0.5).ok).toBe(false);
  });

  // Custom quotes are retired: a leftover row is never priced at ₱0.
  it('charges a retired custom-quote task its flat price', () => {
    expect(taskBasePrice({ basePrice: 999, pricingModel: 'CUSTOM_QUOTE' }, undefined)).toEqual({ ok: true, basePrice: 999 });
  });
});
