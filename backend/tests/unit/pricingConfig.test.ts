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

  it('falls back to the 2% withholding default when the env var is unset', () => {
    const { WITHHOLDING_TAX_RATE } = loadWithEnv(undefined, undefined);
    expect(WITHHOLDING_TAX_RATE).toBe(0.02);
  });

  it('falls back to the default when the env var is an empty string (not 0)', () => {
    const { WITHHOLDING_TAX_RATE, COMMISSION_RATE } = loadWithEnv('', '');
    expect(WITHHOLDING_TAX_RATE).toBe(0.02);
    expect(COMMISSION_RATE).toBe(0.1);
  });

  it('uses an explicit env override when provided', () => {
    const { WITHHOLDING_TAX_RATE } = loadWithEnv(undefined, '0.05');
    expect(WITHHOLDING_TAX_RATE).toBe(0.05);
  });

  it('clamps out-of-range values to [0, 1]', () => {
    const { WITHHOLDING_TAX_RATE } = loadWithEnv(undefined, '5');
    expect(WITHHOLDING_TAX_RATE).toBe(1);
  });
});
