// Reference-only DOLE regional daily minimum wage figures, shown next to a
// city's pricing rule so admins have a fairness benchmark when setting a
// price floor. Purely informational — nothing here is read by the booking
// or pricing engine, and it enforces nothing.
//
// Source: DOLE Regional Tripartite Wages and Productivity Boards.
// Update the two entries below whenever a new wage order is issued for a
// region this app operates in (NCR or Region III / Central Luzon).
const WAGE_REGIONS = {
  NCR: {
    label: 'NCR',
    dailyWage: 755,
    wageOrder: 'NCR-27 (1st tranche)',
    effectiveDate: '2026-07-25',
    note: 'Rises to ₱780/day on 2027-01-20 under the 2nd tranche.',
  },
  REGION_III: {
    label: 'Region III / Central Luzon',
    dailyWage: 600,
    wageOrder: 'RBIII-26 (2nd tranche)',
    effectiveDate: '2026-04-16',
  },
}

// Normalized (lowercase, trimmed) city name -> wage region key. Covers the
// cities this app currently prices for (see prisma/seeds/seed-catalog.ts).
const CITY_TO_REGION = {
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
}

// Returns the DOLE wage reference for a city, or null if the city isn't in
// CITY_TO_REGION (free-text city names won't always match).
export function getDoleWageReference(cityInput) {
  const key = (cityInput || '').trim().toLowerCase()
  const region = CITY_TO_REGION[key]
  if (!region) return null

  const info = WAGE_REGIONS[region]
  const hourlyWage = Math.round((info.dailyWage / 8) * 100) / 100
  return { ...info, region, hourlyWage }
}
