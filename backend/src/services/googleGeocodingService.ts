// Google Geocoding API — significantly better Philippine address coverage
// than the free/keyless Nominatim (OpenStreetMap) fallback this app started
// with, particularly for rural barangays OSM has no record of at all
// (confirmed live: "Bangungon, Paombong, Bulacan" resolves on Google but
// returns zero results on Nominatim). Optional: every function here returns
// null when GOOGLE_MAPS_API_KEY isn't set, so callers (see geoController)
// can fall through to the existing Nominatim path with no code branching
// beyond a null check.
const GOOGLE_GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

export type GoogleGeocodeResult = {
  formattedAddress: string;
  lat: number;
  lng: number;
  // ROOFTOP = exact building match; RANGE_INTERPOLATED/GEOMETRIC_CENTER/
  // APPROXIMATE are progressively coarser — surfaced so the mobile client can
  // tell the user when a pin isn't exact, same as the existing `approximate`
  // flag on the Nominatim fallback path.
  locationType: string;
  components: {
    houseNumber?: string;
    street?: string;
    barangay?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
};

export function isGoogleGeocodingConfigured(): boolean {
  return !!process.env.GOOGLE_MAPS_API_KEY;
}

function getComponent(components: any[], type: string): string | undefined {
  return components.find((c: any) => Array.isArray(c.types) && c.types.includes(type))?.long_name;
}

function parseComponents(addressComponents: any[]): GoogleGeocodeResult['components'] {
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
    state: getComponent(addressComponents, 'administrative_area_level_1'),
    zipCode: getComponent(addressComponents, 'postal_code'),
  };
}

async function callGeocodeApi(params: Record<string, string>): Promise<GoogleGeocodeResult | null> {
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

  const result = data.results[0];
  return {
    formattedAddress: result.formatted_address,
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    locationType: result.geometry.location_type,
    components: parseComponents(result.address_components),
  };
}

export async function googleGeocodeAddress(address: string): Promise<GoogleGeocodeResult | null> {
  return callGeocodeApi({ address, region: 'ph', components: 'country:PH' });
}

export async function googleReverseGeocode(lat: number, lng: number): Promise<GoogleGeocodeResult | null> {
  return callGeocodeApi({ latlng: `${lat},${lng}` });
}
