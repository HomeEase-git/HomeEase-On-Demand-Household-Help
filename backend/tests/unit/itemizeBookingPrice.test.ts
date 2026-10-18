import { itemizeBookingPrice } from '../../src/utils/pricing';

const log = { basePrice: 1000, distanceFee: 50, tierFee: 100, rushFee: 0 };

describe('itemizeBookingPrice', () => {
  it('uses the booking-time log for an unquoted booking', () => {
    expect(itemizeBookingPrice(log, { estimatedPrice: 1150 })).toEqual({
      basePrice: 1000, distanceFee: 50, tierFee: 100, rushFee: 0, materialsCost: 0,
    });
  });

  it('after a quote, keeps the base rate and fees and adds materials as its own line', () => {
    const lines = itemizeBookingPrice(log, { estimatedPrice: 1150, laborCost: 1150, materialsCost: 300 });
    expect(lines.basePrice).toBe(1000); // not the 1150 labor figure
    expect(lines.materialsCost).toBe(300);
    // the lines add up to what the client is billed: labor (the estimate) + materials
    expect(lines.basePrice! + lines.distanceFee + lines.tierFee + lines.rushFee + lines.materialsCost).toBe(1150 + 300);
  });

  it('treats a custom-quote job\'s labor price as its base rate, with no estimate fees', () => {
    expect(itemizeBookingPrice(log, { estimatedPrice: 0, laborCost: 800, materialsCost: 200 })).toEqual({
      basePrice: 800, distanceFee: 0, tierFee: 0, rushFee: 0, materialsCost: 200,
    });
  });

  it('falls back to a collapsed view when there is no log', () => {
    expect(itemizeBookingPrice(null, { estimatedPrice: 500 }).basePrice).toBeNull();
  });
});
