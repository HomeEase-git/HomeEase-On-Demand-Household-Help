const parseRate = (value: string | undefined, fallback: number): number => {
  if (!value || !value.trim()) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, 0), 1);
};

export const COMMISSION_RATE = parseRate(process.env.COMMISSION_RATE, 0.1);
export const WITHHOLDING_TAX_RATE = parseRate(process.env.WITHHOLDING_TAX_RATE, 0.02);
