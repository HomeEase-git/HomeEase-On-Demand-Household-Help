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
  // Set when the result came from a broadened fallback query (see
  // geocodeAddressWithFallback) rather than the exact address — e.g. a rural
  // barangay Google has no exact-street record of resolves to its
  // city/province centroid instead. Callers should surface this so the user
  // knows the pin isn't exact, rather than treating it as a normal match.
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

// Google's geometry.location_type: ROOFTOP (exact building) and
// RANGE_INTERPOLATED (interpolated between two known points on a road) are
// both precise enough to treat as an exact match; GEOMETRIC_CENTER (center of
// a broader area — a road, a neighborhood) and APPROXIMATE are not.
const PRECISE_GOOGLE_LOCATION_TYPES = new Set(["ROOFTOP", "RANGE_INTERPOLATED"]);

function toPlaceResult(result: GoogleGeocodeResult): PlaceResult {
  return {
    formatted_address: result.formattedAddress,
    geometry: { location: { lat: result.lat, lng: result.lng } },
    components: result.components,
    approximate: result.partialMatch || !PRECISE_GOOGLE_LOCATION_TYPES.has(result.locationType),
  };
}

// Free-text address → coordinates via Google Places Text Search (New),
// proxied through the backend, which holds the API key. Returns null whenever
// Google isn't configured server-side, the address genuinely doesn't resolve,
// or the request fails; geocodeAddressGoogle never throws, so this never
// needs its own try/catch.
export async function geocodeAddress(address: string): Promise<PlaceResult | null> {
  const normalized = address.trim();
  if (!normalized) return null;

  const result = await geocodeAddressGoogle(normalized);
  return result ? toPlaceResult(result) : null;
}

// Builds one well-ordered query string (most-specific first) from the
// individual address fields instead of one free-text blob — house number and
// barangay are exactly the detail Google needs to resolve a PH address down
// to the actual lot rather than just the street or city centroid.
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

// Even Google occasionally has no exact match for a specific rural barangay/
// subdivision, even though the surrounding city/province resolves fine.
// Rather than a hard failure that blocks booking entirely, this tries the
// full address first and, if that comes back empty, progressively drops the
// most specific component (house/street, then barangay) until something
// resolves — landing on a city-level pin is still far more useful than
// nothing, as long as the caller knows to treat it as approximate (see
// PlaceResult.approximate).
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

// Places Autocomplete bills a whole "session" (every keystroke plus the one
// Place Details call that ends it) as a single lookup, as long as all of those
// calls share one token. Start a token when the user starts typing, pass it
// to both autocompleteAddresses and getPlaceDetails, then throw it away. The
// token only needs to be unique, not secret, so Math.random is fine here
// (Hermes has no crypto.randomUUID).
export function newPlacesSessionToken(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * As-you-type address suggestions (Places Autocomplete (New)). These carry
 * no coordinates — resolve the one the user picks with getPlaceDetails,
 * using the same session token.
 */
export async function autocompleteAddresses(
  input: string,
  sessionToken: string,
  near?: LatLng,
): Promise<AddressSuggestion[]> {
  const normalized = input.trim();
  if (normalized.length < 3) return [];
  return autocompleteAddressesGoogle(normalized, sessionToken, near);
}

/** Resolves a picked suggestion to coordinates + address parts; ends the session. */
export async function getPlaceDetails(placeId: string, sessionToken?: string): Promise<PlaceResult | null> {
  const result = await getPlaceDetailsGoogle(placeId, sessionToken);
  return result ? toPlaceResult(result) : null;
}

// Android's native geocoder reports the PH region (e.g. "Central Luzon",
// "Calabarzon") in `region` and usually the province in `subregion` — but not
// always. A region name must never land in the Province field (same bug the
// server-side parser guards against), so it's dropped and the user fills the
// province in. The capital region is the one exception: it has no province,
// so "Metro Manila" is the right value there.
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

/**
 * "What address is at this GPS fix?" — answered on-device by Android's
 * native geocoder (expo-location), with no Google API call or backend round
 * trip. Returns null when the device has no geocoder (no Play services) or
 * finds nothing, in which case the caller asks the user to fill the fields in.
 */
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
    // Keep the caller's own GPS fix — this is "what address is at this
    // point?", not "give me a new point."
    geometry: { location: { lat, lng } },
    components,
  };
}

export async function fetchRoute(from: LatLng, to: LatLng): Promise<RouteResult | null> {
  return getDirectionsGoogle(from, to);
}
