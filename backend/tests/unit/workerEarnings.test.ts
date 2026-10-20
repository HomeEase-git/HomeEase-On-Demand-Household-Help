import { calculateWorkerPayout, computeWorkerEarnings } from '../../src/utils/pricing';

describe('computeWorkerEarnings', () => {
  it('itemises the worked example: 800 base + 1600 package, 10% commission, 2% withholding, 10 tip', () => {
    const e = computeWorkerEarnings({ subtotal: 2400, tip: 10, commissionRate: 0.1, withholdingTaxRate: 0.02 });
    expect(e.commissionAmount).toBe(240);
    expect(e.withholdingTaxAmount).toBe(43.2);
    expect(e.vatAmount).toBe(0);
    expect(e.workerPayout).toBe(2126.8);
    // The lines add up to what the worker receives.
    expect(e.subtotal - e.commissionAmount - e.withholdingTaxAmount + e.tip + e.vatAmount).toBeCloseTo(e.workerPayout, 2);
  });

  it('follows the commission rate it is given instead of assuming 10%', () => {
    const e = computeWorkerEarnings({ subtotal: 1000, commissionRate: 0.15, withholdingTaxRate: 0.02 });
    expect(e.commissionAmount).toBe(150);
    expect(e.withholdingTaxAmount).toBe(17); // 2% of the 850 left after commission
    expect(e.workerPayout).toBe(833);
  });

  it('passes VAT through to the worker without commissioning or taxing it', () => {
    const e = computeWorkerEarnings({
      subtotal: 1000,
      commissionRate: 0.1,
      withholdingTaxRate: 0.02,
      vatApplicable: true,
      vatRate: 0.12,
    });
    expect(e.vatAmount).toBe(120);
    expect(e.commissionAmount).toBe(100); // still 10% of the 1000, not of 1120
    expect(e.workerPayout).toBe(1000 - 100 - 18 + 120);
  });

  it('agrees with calculateWorkerPayout when there is no VAT', () => {
    const args = { subtotal: 2400, tip: 10, commissionRate: 0.1, withholdingTaxRate: 0.02 };
    expect(computeWorkerEarnings(args).workerPayout).toBe(
      calculateWorkerPayout(args.subtotal, args.tip, args.commissionRate, args.withholdingTaxRate)
    );
  });
});
