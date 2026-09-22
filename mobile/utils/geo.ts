import { geocodeAddressGoogle, reverseGeocodeGoogle, searchAddressesGoogle, getDirectionsGoogle } from "../services/api";

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

// Google Geocoding API (proxied through the backend, which holds the API
// key) is the only geocoding provider in this app — OpenStreetMap/Nominatim
// has been fully removed. Returns null whenever Google isn't configured
// server-side, the address genuinely doesn't resolve, or the request fails;
// geocodeAddressGoogle never throws, so this never needs its own try/catch.
export async function geocodeAddress(address: string): Promise<PlaceResult | null> {
  const normalized = address.trim();
  if (!normalized) return null;

  const result = await geocodeAddressGoogle(normalized);
  if (!result) return null;

  return {
    formatted_address: result.formattedAddress,
    geometry: { location: { lat: result.lat, lng: result.lng } },
    components: result.components,
    approximate: result.partialMatch || !PRECISE_GOOGLE_LOCATION_TYPES.has(result.locationType),
  };
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

/**
 * Multi-result address search for autocomplete-style UI (as opposed to
 * `geocodeAddress`, which only returns the single best match). Backed by the
 * same backend-proxied Google Geocoding API as everything else here.
 */
export async function searchAddresses(query: string, limit = 5): Promise<PlaceResult[]> {
  const normalized = query.trim();
  if (normalized.length < 3) return [];

  const results = await searchAddressesGoogle(normalized, limit);
  return results.map((result) => ({
    formatted_address: result.formattedAddress,
    geometry: { location: { lat: result.lat, lng: result.lng } },
    components: result.components,
  }));
}

export async function reverseGeocodeDetailed(lat: number, lng: number): Promise<PlaceResult | null> {
  const result = await reverseGeocodeGoogle(lat, lng);
  if (!result) return null;

  return {
    formatted_address: result.formattedAddress,
    // Keep the caller's own GPS fix rather than Google's (possibly
    // snapped-to-road) geometry — this is "what address is at this point?",
    // not "give me a new point."
    geometry: { location: { lat, lng } },
    components: result.components,
  };
}

export async function fetchRoute(from: LatLng, to: LatLng): Promise<RouteResult | null> {
  return getDirectionsGoogle(from, to);
}
