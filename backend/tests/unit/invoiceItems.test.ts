import { validateInvoiceItems, sumInvoiceItems } from '@utils/invoiceItems';

const part = (over: Record<string, unknown> = {}) => ({
  kind: 'PART',
  name: 'Outlet cover',
  price: 85,
  photoUrls: ['receipt'],
  ...over,
});

describe('validateInvoiceItems', () => {
  it('accepts no added lines', () => {
    expect(validateInvoiceItems(undefined)).toEqual({ ok: true, items: [] });
    expect(validateInvoiceItems([])).toEqual({ ok: true, items: [] });
  });

  it('rejects a non-list', () => {
    expect(validateInvoiceItems('x').ok).toBe(false);
  });

  it('accepts a part and extra work', () => {
    const r = validateInvoiceItems([part(), part({ kind: 'EXTRA_WORK', name: 'Extra outlet', price: 300 })]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.items.map((i) => i.kind)).toEqual(['PART', 'EXTRA_WORK']);
  });

  it('rejects an unknown kind', () => {
    expect(validateInvoiceItems([part({ kind: 'LABOR' })]).ok).toBe(false);
  });

  it('needs a receipt photo for a part', () => {
    const r = validateInvoiceItems([part({ photoUrls: [] })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/receipt/);
  });

  it('needs a photo of the work for extra work', () => {
    const r = validateInvoiceItems([part({ kind: 'EXTRA_WORK', photoUrls: [] })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/photo of the work/);
  });

  it.each([0, -5, 100_001, 10.005, Number.NaN])('rejects a price of %s', (price) => {
    expect(validateInvoiceItems([part({ price })]).ok).toBe(false);
  });

  it('trims names and rejects blank ones', () => {
    const r = validateInvoiceItems([part({ name: '  Wire  ' })]);
    expect(r.ok && r.items[0].name).toBe('Wire');
    expect(validateInvoiceItems([part({ name: '   ' })]).ok).toBe(false);
  });

  it('caps the number of lines', () => {
    expect(validateInvoiceItems(Array.from({ length: 21 }, () => part())).ok).toBe(false);
  });
});

describe('sumInvoiceItems', () => {
  it('adds to the centavo', () => {
    expect(sumInvoiceItems([{ price: 0.1 }, { price: 0.2 }])).toBe(0.3);
  });
});
