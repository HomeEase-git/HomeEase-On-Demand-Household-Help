describe('config/pricing env parsing', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  function loadWithEnv(commissionRate?: string, withholdingTaxRate?: string) {
    jest.resetModules();
    if (commissionRate === undefined) {
      delete process.env.COMMISSION_RATE;
    } else {
      process.env.COMMISSION_RATE = commissionRate;
    }
    if (withholdingTaxRate === undefined) {
      delete process.env.WITHHOLDING_TAX_RATE;
    } else {
      process.env.WITHHOLDING_TAX_RATE = withholdingTaxRate;
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@config/pricing');
  }

  it('withholds no tax, whatever the env says (workers file their own)', () => {
    expect(loadWithEnv(undefined, undefined).WITHHOLDING_TAX_RATE).toBe(0);
    expect(loadWithEnv(undefined, '0.05').WITHHOLDING_TAX_RATE).toBe(0);
  });

  it('falls back to the commission default when the env var is an empty string (not 0)', () => {
    expect(loadWithEnv('', undefined).COMMISSION_RATE).toBe(0.1);
  });

  it('uses an explicit commission override when provided', () => {
    expect(loadWithEnv('0.15', undefined).COMMISSION_RATE).toBe(0.15);
  });

  it('clamps out-of-range commission values to [0, 1]', () => {
    expect(loadWithEnv('5', undefined).COMMISSION_RATE).toBe(1);
  });
});
