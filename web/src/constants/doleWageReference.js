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

function buildReference(region) {
  const info = WAGE_REGIONS[region]
  const hourlyWage = Math.round((info.dailyWage / 8) * 100) / 100
  return { ...info, region, hourlyWage }
}

export function getDoleWageReference(cityInput) {
  const key = (cityInput || '').trim().toLowerCase()
  const region = CITY_TO_REGION[key]
  if (!region) return null
  return buildReference(region)
}

export function getHighestDoleWageReference() {
  return Object.keys(WAGE_REGIONS)
    .map(buildReference)
    .reduce((highest, candidate) => (candidate.hourlyWage > highest.hourlyWage ? candidate : highest))
}
