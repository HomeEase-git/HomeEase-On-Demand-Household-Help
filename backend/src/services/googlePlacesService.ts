const PLACES_BASE_URL = 'https://places.googleapis.com/v1';

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
  locationType: string;
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
    barangay:
      getComponent(addressComponents, 'sublocality_level_1') ||
      getComponent(addressComponents, 'sublocality') ||
      getComponent(addressComponents, 'neighborhood'),
    city:
      getComponent(addressComponents, 'locality') ||
      getComponent(addressComponents, 'administrative_area_level_3'),
    state:
      getComponent(addressComponents, 'administrative_area_level_2') ||
      getComponent(addressComponents, 'administrative_area_level_1'),
    zipCode: getComponent(addressComponents, 'postal_code'),
  };
}

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

export async function googlePlaceDetails(placeId: string, sessionToken?: string): Promise<GooglePlaceResult | null> {
  const params = new URLSearchParams({ languageCode: 'en', regionCode: 'ph' });
  if (sessionToken) params.set('sessionToken', sessionToken);

  const data = await placesRequest(`/places/${encodeURIComponent(placeId)}?${params.toString()}`, {
    method: 'GET',
    fieldMask: PLACE_FIELDS.join(','),
  });
  return data ? toResult(data) : null;
}
