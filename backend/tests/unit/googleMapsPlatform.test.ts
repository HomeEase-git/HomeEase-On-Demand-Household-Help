import { googleDrivingDistancesKm, resolveDrivingDistancesKm } from '@services/googleDistanceService';
import { googleDirections } from '@services/googleDirectionsService';
import {
  googleAutocomplete,
  googleGeocodeAddress,
  googlePlaceDetails,
  googleSearchAddresses,
} from '@services/googlePlacesService';

// Every Google call is a plain global fetch — stub it per test and assert on
// both the request we send (endpoint, headers, body) and how the response is
// mapped, without touching the network.
const fetchMock = jest.fn();
const originalFetch = global.fetch;
const originalKey = process.env.GOOGLE_MAPS_API_KEY;

function respond(body: unknown, ok = true, status = 200) {
  fetchMock.mockResolvedValueOnce({ ok, status, json: async () => body });
}

function lastRequest() {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return { url: url as string, init: init as RequestInit, body: init?.body ? JSON.parse(init.body as string) : undefined };
}

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore();
});

afterAll(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY = originalKey;
});

const manila = { lat: 14.5995, lng: 120.9842 };
const quezonCity = { lat: 14.676, lng: 121.0437 };
const makati = { lat: 14.5547, lng: 121.0244 };

describe('Routes API — computeRouteMatrix (googleDistanceService)', () => {
  it('sends a TRAFFIC_UNAWARE DRIVE matrix request with the key and field mask headers', async () => {
    respond([{ destinationIndex: 0, distanceMeters: 12345, condition: 'ROUTE_EXISTS' }]);

    await googleDrivingDistancesKm(manila, [quezonCity]);

    const { url, init, body } = lastRequest();
    expect(url).toBe('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('test-key');
    expect((init.headers as Record<string, string>)['X-Goog-FieldMask']).toContain('distanceMeters');
    expect(body.travelMode).toBe('DRIVE');
    expect(body.routingPreference).toBe('TRAFFIC_UNAWARE');
    expect(body.origins[0].waypoint.location.latLng).toEqual({ latitude: manila.lat, longitude: manila.lng });
  });

  it('maps elements by destinationIndex (unordered, index 0 omitted per proto3 JSON)', async () => {
    respond([
      { destinationIndex: 1, distanceMeters: 8000, condition: 'ROUTE_EXISTS' },
      { distanceMeters: 15000, condition: 'ROUTE_EXISTS' },
    ]);

    expect(await googleDrivingDistancesKm(manila, [quezonCity, makati])).toEqual([15, 8]);
  });

  it('returns null for unroutable pairs, and resolve* falls back to straight-line for them', async () => {
    respond([
      { destinationIndex: 0, condition: 'ROUTE_NOT_FOUND' },
      { destinationIndex: 1, distanceMeters: 8000, condition: 'ROUTE_EXISTS' },
    ]);

    const resolved = await resolveDrivingDistancesKm(manila, [quezonCity, makati]);
    expect(resolved[1]).toBe(8);
    expect(resolved[0]).toBeGreaterThan(5); // haversine Manila→QC ≈ 9.6km
    expect(resolved[0]).toBeLessThan(15);
  });

  it('returns all-null on an API error response', async () => {
    respond({ error: { code: 403, message: 'Routes API has not been used in project' } }, false, 403);
    expect(await googleDrivingDistancesKm(manila, [quezonCity, makati])).toEqual([null, null]);
  });

  it('never calls Google when the key is missing', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    expect(await googleDrivingDistancesKm(manila, [quezonCity])).toEqual([null]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Routes API — computeRoutes (googleDirectionsService)', () => {
  it('decodes the polyline and converts distance/duration', async () => {
    // Google's documented sample polyline: (38.5,-120.2) (40.7,-120.95) (43.252,-126.453)
    respond({
      routes: [{ distanceMeters: 5400, duration: '900s', polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' } }],
    });

    const result = await googleDirections(manila, quezonCity);

    expect(lastRequest().url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    expect(result?.distanceKm).toBeCloseTo(5.4);
    expect(result?.durationMin).toBeCloseTo(15);
    expect(result?.coordinates).toHaveLength(3);
    expect(result?.coordinates[0].lat).toBeCloseTo(38.5);
    expect(result?.coordinates[2].lng).toBeCloseTo(-126.453);
  });

  it('returns null when no route comes back', async () => {
    respond({});
    expect(await googleDirections(manila, quezonCity)).toBeNull();
  });
});

const bulacanPlace = {
  formattedAddress: '12 Rizal St, Malolos, Bulacan, Philippines',
  location: { latitude: 14.8433, longitude: 120.8114 },
  types: ['street_address'],
  addressComponents: [
    { longText: '12', types: ['street_number'] },
    { longText: 'Rizal Street', types: ['route'] },
    { longText: 'Santo Rosario', types: ['sublocality_level_1', 'sublocality', 'political'] },
    { longText: 'Malolos', types: ['locality', 'political'] },
    { longText: 'Bulacan', types: ['administrative_area_level_2', 'political'] },
    { longText: 'Central Luzon', types: ['administrative_area_level_1', 'political'] },
    { longText: '3000', types: ['postal_code'] },
  ],
};

describe('Places API (New) — googlePlacesService', () => {
  it('Text Search: restricts to PH and parses components (province = level_2, not the region)', async () => {
    respond({ places: [bulacanPlace] });

    const result = await googleGeocodeAddress('12 Rizal St, Malolos');

    const { url, init, body } = lastRequest();
    expect(url).toBe('https://places.googleapis.com/v1/places:searchText');
    expect((init.headers as Record<string, string>)['X-Goog-FieldMask']).toBe(
      'places.formattedAddress,places.location,places.addressComponents,places.types',
    );
    expect(body.textQuery).toBe('12 Rizal St, Malolos');
    expect(body.locationRestriction.rectangle).toBeDefined();
    expect(body.pageSize).toBe(1);
    expect(result).toEqual({
      formattedAddress: bulacanPlace.formattedAddress,
      lat: 14.8433,
      lng: 120.8114,
      locationType: 'ROOFTOP',
      partialMatch: false,
      components: {
        houseNumber: '12',
        street: 'Rizal Street',
        barangay: 'Santo Rosario',
        city: 'Malolos',
        state: 'Bulacan',
        zipCode: '3000',
      },
    });
  });

  it('falls back to level_1 for Metro Manila (no province level)', async () => {
    respond({
      places: [{
        ...bulacanPlace,
        addressComponents: [
          { longText: 'Makati', types: ['locality', 'political'] },
          { longText: 'Metro Manila', types: ['administrative_area_level_1', 'political'] },
        ],
      }],
    });
    expect((await googleGeocodeAddress('Makati'))?.components.state).toBe('Metro Manila');
  });

  it('labels area/road results as approximate and establishments as exact', async () => {
    respond({
      places: [
        { ...bulacanPlace, types: ['locality', 'political'] },
        { ...bulacanPlace, types: ['route'] },
        { ...bulacanPlace, types: ['shopping_mall', 'point_of_interest', 'establishment'] },
        { ...bulacanPlace, types: ['premise'] },
      ],
    });
    const results = await googleSearchAddresses('Malolos', 4);
    expect(results.map((r) => r.locationType)).toEqual(['APPROXIMATE', 'GEOMETRIC_CENTER', 'ROOFTOP', 'ROOFTOP']);
  });

  it('Text Search returns [] on no results and on API errors', async () => {
    respond({});
    expect(await googleSearchAddresses('zzzz')).toEqual([]);
    respond({ error: { message: 'PERMISSION_DENIED' } }, false, 403);
    expect(await googleSearchAddresses('zzzz')).toEqual([]);
  });

  it('Autocomplete: sends the session token + PH region + optional location bias', async () => {
    respond({
      suggestions: [
        {
          placePrediction: {
            placeId: 'ChIJabc',
            text: { text: 'SM City Marilao, Marilao, Bulacan' },
            structuredFormat: { mainText: { text: 'SM City Marilao' }, secondaryText: { text: 'Marilao, Bulacan' } },
          },
        },
        { queryPrediction: { text: { text: 'sm near me' } } },
      ],
    });

    const results = await googleAutocomplete('SM Mari', 'session-123', manila);

    const { url, body } = lastRequest();
    expect(url).toBe('https://places.googleapis.com/v1/places:autocomplete');
    expect(body).toMatchObject({ input: 'SM Mari', sessionToken: 'session-123', includedRegionCodes: ['ph'] });
    expect(body.locationBias.circle.center).toEqual({ latitude: manila.lat, longitude: manila.lng });
    expect(results).toEqual([
      { placeId: 'ChIJabc', text: 'SM City Marilao, Marilao, Bulacan', mainText: 'SM City Marilao', secondaryText: 'Marilao, Bulacan' },
    ]);
  });

  it('Autocomplete omits locationBias when no location is given', async () => {
    respond({ suggestions: [] });
    await googleAutocomplete('Malolos', 'session-123');
    expect(lastRequest().body.locationBias).toBeUndefined();
  });

  it('Place Details: GETs the place with the session token and parses it', async () => {
    respond(bulacanPlace);

    const result = await googlePlaceDetails('ChIJabc', 'session-123');

    const { url, init } = lastRequest();
    expect(url).toMatch(/^https:\/\/places\.googleapis\.com\/v1\/places\/ChIJabc\?/);
    expect(url).toContain('sessionToken=session-123');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['X-Goog-FieldMask']).toBe('formattedAddress,location,addressComponents,types');
    expect(result?.components.state).toBe('Bulacan');
  });

  it('Place Details returns null when the place has no location', async () => {
    respond({ formattedAddress: 'Somewhere' });
    expect(await googlePlaceDetails('ChIJabc')).toBeNull();
  });
});
