// Google Geocoding API — the sole geocoding/reverse-geocoding provider for
// this app (OpenStreetMap/Nominatim has been fully removed; see utils/geo.ts
// on mobile). Every function here returns null when GOOGLE_MAPS_API_KEY isn't
// set, the address/coordinate doesn't resolve, or the request fails — callers
// treat all three the same way (prompt the user to fill the address in
// manually) rather than branching on which case it was.
const GOOGLE_GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

export type GoogleGeocodeResult = {
  formattedAddress: string;
  lat: number;
  lng: number;
  // ROOFTOP = exact building match; RANGE_INTERPOLATED/GEOMETRIC_CENTER/
  // APPROXIMATE are progressively coarser — surfaced so the mobile client can
  // tell the user when a pin isn't exact.
  locationType: string;
  // True when Google couldn't match every component of the query (e.g. an
  // unrecognized barangay name) and substituted the nearest place it does
  // know. The pin can still be rooftop-precise for wherever it DID match, but
  // that place isn't necessarily the one asked for, so this should count as
  // approximate too.
  partialMatch: boolean;
  components: {
    houseNumber?: string;
    street?: string;
    barangay?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
};

type AddressComponents = GoogleGeocodeResult['components'];

export function isGoogleGeocodingConfigured(): boolean {
  return !!process.env.GOOGLE_MAPS_API_KEY;
}

function getComponent(components: any[], type: string): string | undefined {
  return components.find((c: any) => Array.isArray(c.types) && c.types.includes(type))?.long_name;
}

function parseComponents(addressComponents: any[]): AddressComponents {
  return {
    houseNumber: getComponent(addressComponents, 'street_number'),
    street: getComponent(addressComponents, 'route'),
    // PH barangays land under different Google types depending on how
    // detailed the area's mapping is — check from most to least specific.
    barangay:
      getComponent(addressComponents, 'sublocality_level_1') ||
      getComponent(addressComponents, 'sublocality') ||
      getComponent(addressComponents, 'neighborhood'),
    city:
      getComponent(addressComponents, 'locality') ||
      getComponent(addressComponents, 'administrative_area_level_3'),
    // For Philippine addresses, Google's `administrative_area_level_1` is the
    // REGION (e.g. "Central Luzon", "Calabarzon") and the actual PROVINCE
    // (e.g. "Bulacan", "Laguna") lands one level down, at
    // `administrative_area_level_2`. Using level_1 alone (the old bug here)
    // put the region's name in what's shown to users as "Province/State".
    // Metro Manila cities have no province — they sit directly under
    // level_1 ("Metro Manila"/"National Capital Region") with no level_2 at
    // all — hence the fallback.
    state:
      getComponent(addressComponents, 'administrative_area_level_2') ||
      getComponent(addressComponents, 'administrative_area_level_1'),
    zipCode: getComponent(addressComponents, 'postal_code'),
  };
}

// Reverse geocoding a bare lat/lng returns several results for whatever
// Google considers "near" that point — and, confirmed live, these are not
// all the same place with varying precision: they can be genuinely different
// establishments/addresses (even in different cities) that merely sit close
// together, each with its own complete, internally-consistent address. Taking
// `results[0]` blindly sometimes lands on an odd POI (e.g. a bar or parking
// lot) rather than the street address a user would recognize; MERGING fields
// across results would be worse, silently stitching together a house number
// from one place with a barangay/city from a different nearby one. So this
// picks exactly ONE coherent result — the first one Google typed as an
// actual street address (falling through progressively broader place types),
// and uses only that result's own components/formatted address together,
// never mixed with another result's.
const REVERSE_GEOCODE_TYPE_PREFERENCE = [
  'street_address',
  'premise',
  'subpremise',
  'route',
  'sublocality_level_1',
  'sublocality',
  'neighborhood',
  'locality',
];

function pickBestReverseResult(results: any[]): any {
  for (const type of REVERSE_GEOCODE_TYPE_PREFERENCE) {
    const match = results.find((r) => Array.isArray(r.types) && r.types.includes(type));
    if (match) return match;
  }
  return results[0];
}

async function fetchGeocodeResults(params: Record<string, string>): Promise<any[] | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const url = `${GOOGLE_GEOCODE_URL}?${new URLSearchParams({ ...params, key: apiKey }).toString()}`;
  const response = await fetch(url);
  const data: any = await response.json();

  if (data.status === 'ZERO_RESULTS') return null;
  if (data.status !== 'OK' || !data.results?.length) {
    console.error('[googleGeocoding] request failed:', data.status, data.error_message);
    return null;
  }

  return data.results;
}

function toResult(top: any, components: AddressComponents): GoogleGeocodeResult {
  return {
    formattedAddress: top.formatted_address,
    lat: top.geometry.location.lat,
    lng: top.geometry.location.lng,
    locationType: top.geometry.location_type,
    partialMatch: !!top.partial_match,
    components,
  };
}

export async function googleGeocodeAddress(address: string): Promise<GoogleGeocodeResult | null> {
  const results = await fetchGeocodeResults({ address, region: 'ph', components: 'country:PH' });
  if (!results) return null;
  return toResult(results[0], parseComponents(results[0].address_components || []));
}

export async function googleReverseGeocode(lat: number, lng: number): Promise<GoogleGeocodeResult | null> {
  const results = await fetchGeocodeResults({ latlng: `${lat},${lng}` });
  if (!results) return null;
  const best = pickBestReverseResult(results);
  return toResult(best, parseComponents(best.address_components || []));
}

export type GoogleAddressSuggestion = {
  formattedAddress: string;
  lat: number;
  lng: number;
  components: AddressComponents;
};

// Multi-result address search for autocomplete-style UI. Deliberately reuses
// the plain Geocoding API (already paid for/enabled above) rather than Places
// Autocomplete — a separate, session-billed SKU with its own pricing that
// fires on every keystroke instead of once per save/search. Geocoding returns
// multiple `results` only when the query is genuinely ambiguous, so this is a
// coarser autocomplete than a dedicated Places widget, but needs no extra
// billing setup.
export async function googleSearchAddresses(query: string, limit = 5): Promise<GoogleAddressSuggestion[]> {
  const results = await fetchGeocodeResults({ address: query, region: 'ph', components: 'country:PH' });
  if (!results) return [];

  return results.slice(0, limit).map((result: any) => ({
    formattedAddress: result.formatted_address,
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    components: parseComponents(result.address_components || []),
  }));
}
