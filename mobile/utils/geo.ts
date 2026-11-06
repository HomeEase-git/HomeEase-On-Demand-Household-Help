import * as Location from "expo-location";
import {
  geocodeAddressGoogle,
  autocompleteAddressesGoogle,
  getPlaceDetailsGoogle,
  getDirectionsGoogle,
  type GoogleGeocodeResult,
} from "../services/api";

export type LatLng = { lat: number; lng: number };

export type AddressComponents = {
  houseNumber?: string;
  street?: string;
  barangay?: string;
  city?: string;
  state?: string;
  zipCode?: string;
};

export type StructuredAddress = {
  houseNumber?: string;
  street: string;
  barangay?: string;
  city: string;
  state?: string;
  zipCode?: string;
};

export type PlaceResult = {
  formatted_address: string;
  geometry: {
    location: LatLng;
  };
  components?: AddressComponents;
  approximate?: boolean;
};

export type AddressSuggestion = {
  placeId: string;
  text: string;
  mainText: string;
  secondaryText: string;
};

export type RouteResult = {
  coordinates: LatLng[];
  distanceKm: number;
  durationMin: number;
};

const EARTH_RADIUS_KM = 6371;

const PH_BOUNDS = { minLat: 4, maxLat: 21.5, minLng: 116, maxLng: 127 };

export function isInPhilippines(p: LatLng): boolean {
  return p.lat >= PH_BOUNDS.minLat && p.lat <= PH_BOUNDS.maxLat && p.lng >= PH_BOUNDS.minLng && p.lng <= PH_BOUNDS.maxLng;
}

export function haversineDistanceKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

const PRECISE_GOOGLE_LOCATION_TYPES = new Set(["ROOFTOP", "RANGE_INTERPOLATED"]);

function toPlaceResult(result: GoogleGeocodeResult): PlaceResult {
  return {
    formatted_address: result.formattedAddress,
    geometry: { location: { lat: result.lat, lng: result.lng } },
    components: result.components,
    approximate: result.partialMatch || !PRECISE_GOOGLE_LOCATION_TYPES.has(result.locationType),
  };
}

export async function geocodeAddress(address: string): Promise<PlaceResult | null> {
  const normalized = address.trim();
  if (!normalized) return null;

  const result = await geocodeAddressGoogle(normalized);
  return result ? toPlaceResult(result) : null;
}

export function formatStructuredAddress(parts: StructuredAddress): string {
  const streetLine = [parts.houseNumber, parts.street].filter((p) => p?.trim()).join(' ');
  return [
    streetLine,
    parts.barangay ? `Barangay ${parts.barangay}` : null,
    parts.city,
    [parts.state, parts.zipCode].filter((p) => p?.trim()).join(' '),
    'Philippines',
  ]
    .filter((p) => p && p.trim())
    .join(', ');
}

export function displayAddress(address: {
  fullAddress?: string | null;
  houseNumber?: string | null;
  street?: string | null;
  barangay?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
}): string {
  if (address.fullAddress?.trim()) return address.fullAddress.trim();
  return formatStructuredAddress({
    houseNumber: address.houseNumber ?? undefined,
    street: address.street ?? '',
    barangay: address.barangay ?? undefined,
    city: address.city ?? '',
    state: address.state ?? undefined,
    zipCode: address.zipCode ?? undefined,
  }).replace(/, Philippines$/, '');
}

export function stripCountry(formattedAddress: string): string {
  return formattedAddress.replace(/,?\s*Philippines$/i, '').trim();
}

export async function geocodeAddressWithFallback(parts: StructuredAddress): Promise<PlaceResult | null> {
  const exact = await geocodeAddress(formatStructuredAddress(parts));
  if (exact) return exact;

  if (parts.barangay) {
    const withBarangayOnly = await geocodeAddress(
      formatStructuredAddress({ street: '', barangay: parts.barangay, city: parts.city, state: parts.state, zipCode: parts.zipCode }),
    );
    if (withBarangayOnly) return { ...withBarangayOnly, approximate: true };
  }

  const cityOnly = await geocodeAddress(
    formatStructuredAddress({ street: '', city: parts.city, state: parts.state, zipCode: parts.zipCode }),
  );
  if (cityOnly) return { ...cityOnly, approximate: true };

  return null;
}

export function newPlacesSessionToken(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export async function autocompleteAddresses(
  input: string,
  sessionToken: string,
  near?: LatLng,
): Promise<AddressSuggestion[]> {
  const normalized = input.trim();
  if (normalized.length < 3) return [];
  return autocompleteAddressesGoogle(normalized, sessionToken, near);
}

export async function getPlaceDetails(placeId: string, sessionToken?: string): Promise<PlaceResult | null> {
  const result = await getPlaceDetailsGoogle(placeId, sessionToken);
  return result ? toPlaceResult(result) : null;
}

const PH_REGION_NAME = /\b(region|calabarzon|mimaropa|soccsksargen|caraga|bangsamoro|barmm|cordillera|luzon|visayas|mindanao)\b/i;
const CAPITAL_REGION = /national capital region|metro manila|\bncr\b/i;

function provinceFrom(subregion?: string | null, region?: string | null): string | undefined {
  for (const candidate of [subregion, region]) {
    const value = candidate?.trim();
    if (!value) continue;
    if (CAPITAL_REGION.test(value)) return "Metro Manila";
    if (!PH_REGION_NAME.test(value)) return value;
  }
  return undefined;
}

function cleanPart(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || /^unnamed road$/i.test(trimmed)) return undefined;
  return trimmed;
}

export async function reverseGeocodeDetailed(lat: number, lng: number): Promise<PlaceResult | null> {
  let results: Location.LocationGeocodedAddress[];
  try {
    results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
  } catch (error) {
    console.warn("On-device reverse geocode failed:", error);
    return null;
  }

  const top = results[0];
  if (!top) return null;

  const components: AddressComponents = {
    houseNumber: cleanPart(top.streetNumber),
    street: cleanPart(top.street),
    barangay: cleanPart(top.district),
    city: cleanPart(top.city) ?? cleanPart(top.subregion),
    state: provinceFrom(top.subregion, top.region),
    zipCode: cleanPart(top.postalCode),
  };
  if (!components.street && !components.city) return null;

  return {
    formatted_address:
      cleanPart(top.formattedAddress) ??
      formatStructuredAddress({ ...components, street: components.street ?? "", city: components.city ?? "" }),
    geometry: { location: { lat, lng } },
    components,
  };
}

export async function fetchRoute(from: LatLng, to: LatLng): Promise<RouteResult | null> {
  return getDirectionsGoogle(from, to);
}
