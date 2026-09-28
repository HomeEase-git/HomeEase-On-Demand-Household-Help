import {
  bookingStartInstant,
  bookingStartTime,
  checkBookingStart,
  isOutsideBookedWindow,
  isValidStartTime,
  phTodayStart,
  startInstant,
} from '@services/workerAvailabilityService';
import { computeJobPricing } from '@utils/pricing';
import { computeWorkerTier } from '@utils/workerTier';

// 2026-09-27 10:30 in the Philippines (UTC+8).
const NOW = new Date('2026-09-27T02:30:00Z');

describe('start times', () => {
  it('accepts any minute from 7:00 to 18:00 only', () => {
    expect(isValidStartTime('07:00')).toBe(true);
    expect(isValidStartTime('09:30')).toBe(true);
    expect(isValidStartTime('17:59')).toBe(true);
    expect(isValidStartTime('18:00')).toBe(true);
    expect(isValidStartTime('06:59')).toBe(false);
    expect(isValidStartTime('18:01')).toBe(false);
    expect(isValidStartTime('19:00')).toBe(false);
    expect(isValidStartTime('09:60')).toBe(false);
    expect(isValidStartTime('9:00')).toBe(false);
  });

  it('converts a PH date + time to the right instant', () => {
    expect(startInstant(new Date('2026-09-28T00:00:00Z'), '09:00').toISOString()).toBe('2026-09-28T01:00:00.000Z');
  });

  it('falls back to the old slot start for bookings made before exact times', () => {
    expect(bookingStartTime({ scheduledTime: null, timeSlot: 'AFTERNOON' })).toBe('12:00');
    expect(bookingStartInstant({ scheduledDate: new Date('2026-09-28T00:00:00Z'), timeSlot: 'MORNING' }).toISOString()).toBe(
      '2026-09-28T00:00:00.000Z'
    );
  });

  it("uses the PH calendar for today, not UTC's", () => {
    // 23:30 UTC on the 26th is already the 27th in the Philippines.
    expect(phTodayStart(new Date('2026-09-26T23:30:00Z')).toISOString()).toBe('2026-09-27T00:00:00.000Z');
  });
});

describe('checkBookingStart', () => {
  it('flags a same-day booking as rush', () => {
    expect(checkBookingStart('2026-09-27', '15:00', 2, NOW)).toEqual({ ok: true, isRush: true });
    expect(checkBookingStart('2026-09-28', '08:00', 2, NOW)).toEqual({ ok: true, isRush: false });
  });

  it('needs the lead time for a same-day booking', () => {
    // 10:30 now + 2h = 12:30, so noon is too soon.
    expect(checkBookingStart('2026-09-27', '12:00', 2, NOW)).toMatchObject({ ok: false });
    expect(checkBookingStart('2026-09-27', '13:00', 2, NOW)).toMatchObject({ ok: true });
    expect(checkBookingStart('2026-09-27', '12:29', 2, NOW)).toMatchObject({ ok: false });
    expect(checkBookingStart('2026-09-27', '12:30', 2, NOW)).toMatchObject({ ok: true });
  });

  it('rejects past dates and dates too far ahead', () => {
    expect(checkBookingStart('2026-09-26', '10:00', 2, NOW)).toMatchObject({ ok: false });
    expect(checkBookingStart('2026-12-31', '10:00', 2, NOW)).toMatchObject({ ok: false });
  });
});

describe('arrival window flag', () => {
  const start = new Date('2026-09-28T01:00:00Z'); // 9:00 PH

  it('does not flag an on-time arrival', () => {
    expect(isOutsideBookedWindow(start, new Date('2026-09-28T00:45:00Z'), 60)).toBe(false);
  });

  it('flags very early, late, or wrong-day arrivals', () => {
    expect(isOutsideBookedWindow(start, new Date('2026-09-27T22:30:00Z'), 60)).toBe(true);
    expect(isOutsideBookedWindow(start, new Date('2026-09-28T02:30:00Z'), 60)).toBe(true);
    expect(isOutsideBookedWindow(start, new Date('2026-09-29T01:00:00Z'), 60)).toBe(true);
  });
});

describe('rush fee', () => {
  it('adds the rush rate on the service price only', () => {
    const pricing = computeJobPricing({ basePrice: 1000, tierMultiplier: 1.15, rushFeeRate: 0.25, distanceKm: 7, freeDistanceKm: 5, perKmFee: 10 });
    expect(pricing.rushFee).toBe(250);
    expect(pricing.tierFee).toBe(150);
    expect(pricing.distanceFee).toBe(20);
    expect(pricing.estimatedPrice).toBe(1420);
  });

  it('is zero when not a rush booking', () => {
    expect(computeJobPricing({ basePrice: 1000, tierMultiplier: 1 }).rushFee).toBe(0);
  });
});

describe('expertise tier', () => {
  const settings = {
    tierProMinRating: 4.5,
    tierProMinJobs: 20,
    tierProMinYears: 2,
    tierProMultiplier: 1.15,
    tierExpertMinRating: 4.8,
    tierExpertMinJobs: 50,
    tierExpertMinYears: 5,
    tierExpertMultiplier: 1.3,
  };

  it('needs years of experience as well as rating and jobs', () => {
    expect(computeWorkerTier({ rating: 4.9, completedJobs: 60, yearsExperience: 6 }, settings)).toBe('EXPERT');
    expect(computeWorkerTier({ rating: 4.9, completedJobs: 60, yearsExperience: 3 }, settings)).toBe('PRO');
    expect(computeWorkerTier({ rating: 4.9, completedJobs: 60, yearsExperience: 1 }, settings)).toBe('STANDARD');
    expect(computeWorkerTier({ rating: 4.9, completedJobs: 60, yearsExperience: null }, settings)).toBe('STANDARD');
  });
});
