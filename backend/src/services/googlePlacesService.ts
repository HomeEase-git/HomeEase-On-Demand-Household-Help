// Google Places API (New) — the only server-side address provider for this
// app. Replaces the Geocoding API entirely:
//   - address autocomplete  → Autocomplete (New) + Place Details (New), billed
//     per session (sessionToken) instead of per keystroke
//   - free-text address → coordinates → Text Search (New)
//   - GPS fix → address (reverse geocode) happens ON DEVICE via Android's
//     native geocoder (expo-location), so there's no server equivalent here.
// Every function here returns null/[] when GOOGLE_MAPS_API_KEY isn't set, the
// query doesn't resolve, or the request fails — callers treat all three the
// same way (prompt the user to fill the address in manually) rather than
// branching on which case it was.
const PLACES_BASE_URL = 'https://places.googleapis.com/v1';

// Text Search (New) only takes a rectangle for a hard restriction (no
// country filter), so this is the Philippines' bounding box. Autocomplete
// uses includedRegionCodes instead.
const PH_BOUNDS = {
  rectangle: {
    low: { latitude: 4.2, longitude: 116.1 },
    high: { latitude: 21.3, longitude: 127.0 },
  },
};

const PLACE_FIELDS = ['formattedAddress', 'location', 'addressComponents', 'types'];

export type GooglePlaceResult = {
  formattedAddress: string;
  lat: number;
  lng: number;
  // Kept in the Geocoding API's vocabulary (ROOFTOP/GEOMETRIC_CENTER/
  // APPROXIMATE) so app builds that predate the Places migration still read
  // it correctly — see precisionFromTypes for how it's derived.
  locationType: string;
  // Places has no partial-match flag; always false. Kept for the same
  // backward-compatibility reason as locationType.
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

export type GoogleAutocompleteSuggestion = {
  placeId: string;
  text: string;
  mainText: string;
  secondaryText: string;
};

type AddressComponents = GooglePlaceResult['components'];

export function isGooglePlacesConfigured(): boolean {
  return !!process.env.GOOGLE_MAPS_API_KEY;
}

function getComponent(components: any[], type: string): string | undefined {
  return components.find((c: any) => Array.isArray(c.types) && c.types.includes(type))?.longText;
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
    // `administrative_area_level_2`. Using level_1 alone put the region's
    // name in what's shown to users as "Province/State". Metro Manila cities
    // have no province — they sit directly under level_1 ("Metro Manila"/
    // "National Capital Region") with no level_2 at all — hence the fallback.
    state:
      getComponent(addressComponents, 'administrative_area_level_2') ||
      getComponent(addressComponents, 'administrative_area_level_1'),
    zipCode: getComponent(addressComponents, 'postal_code'),
  };
}

// A place whose own type is an AREA (city, barangay, province, postcode) has
// its location at that area's center — approximate for a service address. A
// road is a line, so its point is only its midpoint. Anything else (street
// address, building, establishment) is an actual spot.
const AREA_TYPES = new Set([
  'country',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'locality',
  'sublocality',
  'sublocality_level_1',
  'neighborhood',
  'colloquial_area',
  'postal_code',
  'political',
]);

function precisionFromTypes(types: unknown): string {
  const list: string[] = Array.isArray(types) ? types : [];
  if (list.includes('street_address') || list.includes('premise') || list.includes('subpremise')) return 'ROOFTOP';
  if (list.includes('route')) return 'GEOMETRIC_CENTER';
  if (list.length === 0 || list.every((t) => AREA_TYPES.has(t))) return 'APPROXIMATE';
  return 'ROOFTOP';
}

function toResult(place: any): GooglePlaceResult | null {
  const lat = place?.location?.latitude;
  const lng = place?.location?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return {
    formattedAddress: place.formattedAddress ?? '',
    lat,
    lng,
    locationType: precisionFromTypes(place.types),
    partialMatch: false,
    components: parseComponents(place.addressComponents || []),
  };
}

async function placesRequest(path: string, init: { method: 'GET' | 'POST'; fieldMask: string; body?: unknown }): Promise<any | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const response = await fetch(`${PLACES_BASE_URL}${path}`, {
    method: init.method,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': init.fieldMask,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data: any = await response.json();

  if (!response.ok) {
    console.error(`[googlePlaces] ${path} failed:`, response.status, data?.error?.message);
    return null;
  }
  return data;
}

/** Free-text address → up to `limit` candidate places (Text Search (New)). */
export async function googleSearchAddresses(query: string, limit = 5): Promise<GooglePlaceResult[]> {
  const data = await placesRequest('/places:searchText', {
    method: 'POST',
    fieldMask: PLACE_FIELDS.map((f) => `places.${f}`).join(','),
    body: {
      textQuery: query,
      languageCode: 'en',
      regionCode: 'PH',
      locationRestriction: PH_BOUNDS,
      pageSize: Math.min(Math.max(limit, 1), 20),
    },
  });
  const places: any[] = data?.places ?? [];
  return places.map(toResult).filter((r): r is GooglePlaceResult => r !== null);
}

/** Free-text address → single best match, or null. */
export async function googleGeocodeAddress(address: string): Promise<GooglePlaceResult | null> {
  const [best] = await googleSearchAddresses(address, 1);
  return best ?? null;
}

/**
 * Autocomplete (New). `sessionToken` groups this call with the keystrokes
 * before it and the Place Details call that ends the session, so the whole
 * session is billed once. `near` (the user's rough location, when known)
 * biases — never restricts — results toward nearby places.
 */
export async function googleAutocomplete(
  input: string,
  sessionToken: string,
  near?: { lat: number; lng: number },
): Promise<GoogleAutocompleteSuggestion[]> {
  const data = await placesRequest('/places:autocomplete', {
    method: 'POST',
    fieldMask: 'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat',
    body: {
      input,
      sessionToken,
      includedRegionCodes: ['ph'],
      languageCode: 'en',
      regionCode: 'ph',
      ...(near && {
        locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 50000 } },
      }),
    },
  });
  const suggestions: any[] = data?.suggestions ?? [];
  return suggestions
    .map((s) => s.placePrediction)
    .filter((p) => p?.placeId)
    .map((p) => ({
      placeId: p.placeId,
      text: p.text?.text ?? '',
      mainText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
      secondaryText: p.structuredFormat?.secondaryText?.text ?? '',
    }));
}

/** Place Details (New) — ends the autocomplete session started with `sessionToken`. */
export async function googlePlaceDetails(placeId: string, sessionToken?: string): Promise<GooglePlaceResult | null> {
  const params = new URLSearchParams({ languageCode: 'en', regionCode: 'ph' });
  if (sessionToken) params.set('sessionToken', sessionToken);

  const data = await placesRequest(`/places/${encodeURIComponent(placeId)}?${params.toString()}`, {
    method: 'GET',
    fieldMask: PLACE_FIELDS.join(','),
  });
  return data ? toResult(data) : null;
}
