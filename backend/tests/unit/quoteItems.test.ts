import { validateQuoteItems, sumQuoteItems } from '@utils/quoteItems';

const item = (over: Record<string, unknown> = {}) => ({
  name: 'Faucet',
  price: 350,
  receiptUrls: ['r'],
  proofOfUseUrls: ['u'],
  ...over,
});

describe('validateQuoteItems', () => {
  it('accepts an empty list', () => {
    expect(validateQuoteItems([])).toEqual({ ok: true, items: [] });
  });

  it('rejects a non-array', () => {
    expect(validateQuoteItems('x').ok).toBe(false);
  });

  it('requires a receipt photo', () => {
    const r = validateQuoteItems([item({ receiptUrls: [] })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/receipt/i);
  });

  it('requires an in-use photo', () => {
    const r = validateQuoteItems([item({ proofOfUseUrls: [] })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/in use/i);
  });

  it.each([0, -1, NaN, '5'])('rejects price %p', (price) => {
    expect(validateQuoteItems([item({ price })]).ok).toBe(false);
  });

  it('rejects a price above the fat-finger cap', () => {
    expect(validateQuoteItems([item({ price: 500_001 })]).ok).toBe(false);
    expect(validateQuoteItems([item({ price: 500_000 })]).ok).toBe(true);
  });

  it('rejects a blank name', () => {
    expect(validateQuoteItems([item({ name: '  ' })]).ok).toBe(false);
  });

  it('rejects more than 20 items', () => {
    expect(validateQuoteItems(Array.from({ length: 21 }, () => item())).ok).toBe(false);
  });

  it('rejects more than 5 photos per list', () => {
    expect(validateQuoteItems([item({ receiptUrls: Array(6).fill('r') })]).ok).toBe(false);
  });

  it('trims the name', () => {
    const r = validateQuoteItems([item({ name: '  Faucet ' })]);
    expect(r.ok && r.items[0].name).toBe('Faucet');
  });
});

describe('sumQuoteItems', () => {
  it('sums to the centavo', () => {
    expect(sumQuoteItems([{ price: 0.1 }, { price: 0.2 }])).toBe(0.3);
  });
  it('is 0 for no items', () => {
    expect(sumQuoteItems([])).toBe(0);
  });
});
