/**
 * Reference DOLE regional daily minimum wage figures, used only to catch
 * likely pricing mistakes in adminPricingRuleController (a minPrice that
 * wouldn't cover even one hour at the region's DOLE-equivalent wage). This
 * is NOT a legal wage-compliance mechanism — workers here are independent
 * contractors, not employees, so DOLE minimum wage doesn't apply to them by
 * law. It's a self-imposed sanity check an admin can override with a reason.
 *
 * Mirrors web/src/constants/doleWageReference.js — keep both in sync.
 * Source: DOLE Regional Tripartite Wages and Productivity Boards. Update
 * the two entries below whenever a new wage order is issued for a region
 * this app operates in (NCR or Region III / Central Luzon).
 */
export interface DoleWageReference {
  region: 'NCR' | 'REGION_III';
  label: string;
  dailyWage: number;
  hourlyWage: number;
  wageOrder: string;
  effectiveDate: string;
}

const WAGE_REGIONS: Record<'NCR' | 'REGION_III', Omit<DoleWageReference, 'region' | 'hourlyWage'>> = {
  NCR: {
    label: 'NCR',
    dailyWage: 755,
    wageOrder: 'NCR-27 (1st tranche)',
    effectiveDate: '2026-07-25',
  },
  REGION_III: {
    label: 'Region III / Central Luzon',
    dailyWage: 600,
    wageOrder: 'RBIII-26 (2nd tranche)',
    effectiveDate: '2026-04-16',
  },
};

// Normalized (lowercase, trimmed) city name -> wage region. Covers the
// cities this app currently prices for (see prisma/seeds/seed-catalog.ts).
const CITY_TO_REGION: Record<string, 'NCR' | 'REGION_III'> = {
  'quezon city': 'NCR',
  manila: 'NCR',
  makati: 'NCR',
  pasig: 'NCR',
  marikina: 'NCR',
  caloocan: 'NCR',
  taguig: 'NCR',
  plaridel: 'REGION_III',
  malolos: 'REGION_III',
  'san fernando': 'REGION_III',
  'angeles city': 'REGION_III',
  bulacan: 'REGION_III',
};

function buildReference(region: 'NCR' | 'REGION_III'): DoleWageReference {
  const info = WAGE_REGIONS[region];
  const hourlyWage = Math.round((info.dailyWage / 8) * 100) / 100;
  return { ...info, region, hourlyWage };
}

// Returns the DOLE wage reference for a city, or null if the city isn't
// recognized — unrecognized cities have no floor to check against.
export function getDoleWageReference(cityInput: string | undefined | null): DoleWageReference | null {
  const key = (cityInput ?? '').trim().toLowerCase();
  const region = CITY_TO_REGION[key];
  if (!region) return null;
  return buildReference(region);
}

/**
 * The highest wage floor across every region this app operates in —
 * computed rather than hardcoded to NCR so it stays correct if a future
 * wage order ever pushes another region above it. Used for city-agnostic
 * bounds like ServiceTask.minPrice/maxPrice, which (unlike PricingRule)
 * apply to a task platform-wide with no per-city variant: checking against
 * the single highest floor is the only check that can't be dodged by
 * pricing for a cheaper-labor region while a worker in the priciest one
 * ends up underpaid.
 */
export function getHighestDoleWageReference(): DoleWageReference {
  const [first, ...rest] = Object.keys(WAGE_REGIONS) as Array<'NCR' | 'REGION_III'>;
  return rest.reduce(
    (highest, region) => {
      const candidate = buildReference(region);
      return candidate.hourlyWage > highest.hourlyWage ? candidate : highest;
    },
    buildReference(first)
  );
}
