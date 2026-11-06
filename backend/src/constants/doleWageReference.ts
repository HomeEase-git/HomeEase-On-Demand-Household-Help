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

export function getDoleWageReference(cityInput: string | undefined | null): DoleWageReference | null {
  const key = (cityInput ?? '').trim().toLowerCase();
  const region = CITY_TO_REGION[key];
  if (!region) return null;
  return buildReference(region);
}

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
