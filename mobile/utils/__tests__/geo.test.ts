import * as Location from 'expo-location';
import * as api from '../../services/api';
import { autocompleteAddresses, getPlaceDetails, newPlacesSessionToken, reverseGeocodeDetailed } from '../geo';

jest.mock('expo-location', () => ({ reverseGeocodeAsync: jest.fn() }));
jest.mock('../../services/api', () => ({
  geocodeAddressGoogle: jest.fn(),
  autocompleteAddressesGoogle: jest.fn(),
  getPlaceDetailsGoogle: jest.fn(),
  getDirectionsGoogle: jest.fn(),
}));

const reverseGeocodeAsync = Location.reverseGeocodeAsync as jest.Mock;

function androidAddress(overrides: Partial<Location.LocationGeocodedAddress>): Location.LocationGeocodedAddress {
  return {
    city: null,
    district: null,
    streetNumber: null,
    street: null,
    region: null,
    subregion: null,
    country: 'Philippines',
    postalCode: null,
    name: null,
    isoCountryCode: 'PH',
    timezone: null,
    formattedAddress: null,
    ...overrides,
  };
}

describe('reverseGeocodeDetailed (on-device)', () => {
  beforeEach(() => reverseGeocodeAsync.mockReset());

  test('maps Android geocoder fields and keeps the GPS fix as the pin', async () => {
    reverseGeocodeAsync.mockResolvedValue([
      androidAddress({
        streetNumber: '12',
        street: 'Rizal Street',
        district: 'Santo Rosario',
        city: 'Malolos',
        subregion: 'Bulacan',
        region: 'Central Luzon',
        postalCode: '3000',
        formattedAddress: '12 Rizal Street, Malolos, Bulacan',
      }),
    ]);

    const result = await reverseGeocodeDetailed(14.84, 120.81);

    expect(result).toEqual({
      formatted_address: '12 Rizal Street, Malolos, Bulacan',
      geometry: { location: { lat: 14.84, lng: 120.81 } },
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

  test('never puts a region name in the province field', async () => {
    reverseGeocodeAsync.mockResolvedValue([androidAddress({ street: 'Rizal St', city: 'Calamba', region: 'Calabarzon' })]);
    expect((await reverseGeocodeDetailed(14.2, 121.1))?.components?.state).toBeUndefined();

    reverseGeocodeAsync.mockResolvedValue([androidAddress({ street: 'Rizal St', city: 'Cebu City', region: 'Central Visayas' })]);
    expect((await reverseGeocodeDetailed(10.3, 123.9))?.components?.state).toBeUndefined();
  });

  test('uses "Metro Manila" for the capital region', async () => {
    reverseGeocodeAsync.mockResolvedValue([
      androidAddress({ street: 'Ayala Ave', city: 'Makati', region: 'National Capital Region' }),
    ]);
    expect((await reverseGeocodeDetailed(14.55, 121.02))?.components?.state).toBe('Metro Manila');
  });

  test('drops "Unnamed Road" and builds an address when the device gives none', async () => {
    reverseGeocodeAsync.mockResolvedValue([
      androidAddress({ street: 'Unnamed Road', city: 'Malolos', subregion: 'Bulacan' }),
    ]);
    const result = await reverseGeocodeDetailed(14.84, 120.81);
    expect(result?.components?.street).toBeUndefined();
    expect(result?.formatted_address).toBe('Malolos, Bulacan, Philippines');
  });

  test('returns null when the device geocoder fails or finds nothing usable', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    reverseGeocodeAsync.mockRejectedValue(new Error('Service not Available'));
    expect(await reverseGeocodeDetailed(0, 0)).toBeNull();
    warn.mockRestore();

    reverseGeocodeAsync.mockResolvedValue([]);
    expect(await reverseGeocodeDetailed(0, 0)).toBeNull();

    reverseGeocodeAsync.mockResolvedValue([androidAddress({ region: 'Central Luzon' })]);
    expect(await reverseGeocodeDetailed(0, 0)).toBeNull();
  });
});

describe('Places autocomplete helpers', () => {
  test('session tokens are unique UUIDv4s within the 36-char limit', () => {
    const a = newPlacesSessionToken();
    const b = newPlacesSessionToken();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });

  test('autocomplete skips the network under 3 characters', async () => {
    expect(await autocompleteAddresses('SM', 'tok')).toEqual([]);
    expect(api.autocompleteAddressesGoogle).not.toHaveBeenCalled();
  });

  test('place details flags area results as approximate', async () => {
    (api.getPlaceDetailsGoogle as jest.Mock).mockResolvedValue({
      formattedAddress: 'Malolos, Bulacan',
      lat: 14.84,
      lng: 120.81,
      locationType: 'APPROXIMATE',
      partialMatch: false,
      components: { city: 'Malolos', state: 'Bulacan' },
    });

    const result = await getPlaceDetails('ChIJabc', 'tok');

    expect(api.getPlaceDetailsGoogle).toHaveBeenCalledWith('ChIJabc', 'tok');
    expect(result?.approximate).toBe(true);
    expect(result?.geometry.location).toEqual({ lat: 14.84, lng: 120.81 });
  });
});
