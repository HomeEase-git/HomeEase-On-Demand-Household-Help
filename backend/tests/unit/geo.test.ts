import { distanceKm, distanceMeters, isWithinRadiusKm, isWithinRadiusMeters } from '@utils/geo';

describe('geo distance utilities', () => {
  it('returns ~0 for identical coordinates', () => {
    const point = { lat: 14.5995, lng: 120.9842 }; // Manila
    expect(distanceMeters(point, point)).toBeCloseTo(0, 5);
  });

  it('computes a known great-circle distance within tolerance', () => {
    // Manila <-> Cebu City, real-world distance is ~570km
    const manila = { lat: 14.5995, lng: 120.9842 };
    const cebu = { lat: 10.3157, lng: 123.8854 };
    const km = distanceKm(manila, cebu);
    expect(km).toBeGreaterThan(550);
    expect(km).toBeLessThan(600);
  });

  it('is symmetric', () => {
    const a = { lat: 14.5995, lng: 120.9842 };
    const b = { lat: 10.3157, lng: 123.8854 };
    expect(distanceKm(a, b)).toBeCloseTo(distanceKm(b, a), 6);
  });

  it('isWithinRadiusKm is true inside and false outside the radius', () => {
    const center = { lat: 14.5995, lng: 120.9842 };
    const near = { lat: 14.6, lng: 120.99 }; // a few hundred meters away
    const far = { lat: 10.3157, lng: 123.8854 }; // ~570km away

    expect(isWithinRadiusKm(center, near, 5)).toBe(true);
    expect(isWithinRadiusKm(center, far, 5)).toBe(false);
  });

  it('isWithinRadiusMeters matches the arrival-verification geofence boundary', () => {
    const client = { lat: 14.5995, lng: 120.9842 };
    // ~0.0005 degrees latitude is roughly 55m
    const nearbyWorker = { lat: 14.5995 + 0.0005, lng: 120.9842 };
    const farWorker = { lat: 14.61, lng: 120.9842 };

    expect(isWithinRadiusMeters(client, nearbyWorker, 100)).toBe(true);
    expect(isWithinRadiusMeters(client, farWorker, 100)).toBe(false);
  });
});
