import { taskBasePrice } from '@services/taskPriceService';

describe('taskBasePrice', () => {
  const qty = { label: 'How many units?' };

  it('charges the admin price for a FIXED task, whatever the answers', () => {
    expect(taskBasePrice({ basePrice: 800, pricingModel: 'FIXED' }, {})).toEqual({ ok: true, basePrice: 800 });
  });

  it('multiplies the admin rate by the quantity answer for PER_UNIT', () => {
    expect(
      taskBasePrice({ basePrice: 350, pricingModel: 'PER_UNIT', quantityScopeField: qty }, { 'How many units?': '3' })
    ).toEqual({ ok: true, basePrice: 1050 });
  });

  it('charges a leftover TIERED task like PER_UNIT', () => {
    expect(
      taskBasePrice({ basePrice: 100, pricingModel: 'TIERED', quantityScopeField: qty }, { 'How many units?': 2.5 })
    ).toEqual({ ok: true, basePrice: 250 });
  });

  it('reports the missing quantity question instead of pricing at ₱0', () => {
    expect(taskBasePrice({ basePrice: 350, pricingModel: 'PER_UNIT', quantityScopeField: qty }, {})).toEqual({
      ok: false,
      missingLabel: 'How many units?',
    });
  });

  it('has no upfront price for a custom-quote task', () => {
    expect(taskBasePrice({ basePrice: 999, pricingModel: 'CUSTOM_QUOTE' }, {})).toEqual({ ok: true, basePrice: 0 });
  });
});
