import { geocodeAddressGoogle, reverseGeocodeGoogle } from "../services/api";

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
  // barangay OpenStreetMap simply has no record of resolves to its
  // city/province centroid instead. Callers should surface this so the user
  // knows the pin isn't exact, rather than treating it as a normal match.
  approximate?: boolean;
};

export type RouteResult = {
  coordinates: LatLng[];
  distanceKm: number;
  durationMin: number;
};

// Nominatim (OpenStreetMap's geocoder) asks that requests identify the
// calling app via User-Agent - https://operations.osmfoundation.org/policies/nominatim/
export const NOMINATIM_HEADERS = {
  "User-Agent": "HomeEaseApp/1.0",
  Accept: "application/json",
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

function parseAddressComponents(address: Record<string, string> | undefined): AddressComponents {
  if (!address) return {};
  const houseNumber = address.house_number;
  const road = address.road;
  const street = [houseNumber, road].filter(Boolean).join(' ') || undefined;
  // PH barangays come back from Nominatim under whichever of these tags OSM
  // happened to map the area to — there's no single reliable key.
  const barangay = address.suburb || address.village || address.neighbourhood || address.quarter;
  const city =
    address.city || address.town || address.municipality || address.county;
  const state = address.state || address.region;
  const zipCode = address.postcode;
  return { houseNumber, street, barangay, city, state, zipCode };
}

// Google's geometry.location_type: ROOFTOP (exact building) and
// RANGE_INTERPOLATED (interpolated between two known points on a road) are
// both precise enough to treat as an exact match; GEOMETRIC_CENTER (center of
// a broader area — a road, a neighborhood) and APPROXIMATE are not.
const PRECISE_GOOGLE_LOCATION_TYPES = new Set(["ROOFTOP", "RANGE_INTERPOLATED"]);

async function geocodeAddressNominatim(address: string): Promise<PlaceResult | null> {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&countrycodes=ph&q=${encodeURIComponent(
      address,
    )}`,
    { headers: NOMINATIM_HEADERS },
  );

  const data = await response.json();
  const firstResult = data?.[0];
  if (!firstResult) return null;

  return {
    formatted_address: firstResult.display_name || address,
    geometry: {
      location: {
        lat: parseFloat(firstResult.lat),
        lng: parseFloat(firstResult.lon),
      },
    },
    components: parseAddressComponents(firstResult.address),
  };
}

// Tries the backend-proxied Google Geocoding API first (far better PH
// barangay coverage — see googleGeocodingService.ts), falling back to free
// Nominatim when Google isn't configured server-side, doesn't resolve the
// address either, or the request fails. geocodeAddressGoogle never throws
// (see services/api.ts), so this never needs its own try/catch around it.
export async function geocodeAddress(address: string): Promise<PlaceResult | null> {
  const normalized = address.trim();
  if (!normalized) return null;

  const viaGoogle = await geocodeAddressGoogle(normalized);
  if (viaGoogle) {
    return {
      formatted_address: viaGoogle.formattedAddress,
      geometry: { location: { lat: viaGoogle.lat, lng: viaGoogle.lng } },
      components: viaGoogle.components,
      approximate: !PRECISE_GOOGLE_LOCATION_TYPES.has(viaGoogle.locationType),
    };
  }

  return geocodeAddressNominatim(normalized);
}

// Builds one well-ordered query string (most-specific first) from the
// individual address fields instead of one free-text blob — house number and
// barangay are exactly the detail Nominatim needs to resolve a PH address
// down to the actual lot rather than just the street or city centroid.
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

// Nominatim (free, community-mapped OSM data) frequently has no record at
// all of a specific rural barangay/subdivision, even though the surrounding
// city/province resolves fine — confirmed live for at least one real PH
// address ("Bangungon, Paombong, Bulacan" geocodes to [] on its own, but
// "Paombong, Bulacan" resolves to the town centroid). Rather than a hard
// failure that blocks booking entirely, this tries the full address first
// and, if that comes back empty, progressively drops the most specific
// component (house/street, then barangay) until something resolves —
// landing on a city-level pin is still far more useful than nothing, as
// long as the caller knows to treat it as approximate (see PlaceResult.approximate).
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
 * `geocodeAddress`, which only returns the single best match). Stays on
 * Nominatim even though `geocodeAddress`/`reverseGeocodeDetailed` above now
 * try Google first — Google's equivalent is Places Autocomplete, a separate,
 * session-billed SKU with its own pricing that fires on every keystroke
 * rather than once per save, so it wasn't brought in along with the plain
 * Geocoding API. Swap the fetch implementation here if that's wanted later;
 * callers only depend on the `PlaceResult[]` shape.
 */
export async function searchAddresses(query: string, limit = 5): Promise<PlaceResult[]> {
  const normalized = query.trim();
  if (normalized.length < 3) return [];

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=${limit}&addressdetails=1&countrycodes=ph&q=${encodeURIComponent(
      normalized,
    )}`,
    { headers: NOMINATIM_HEADERS },
  );

  const data = await response.json();
  if (!Array.isArray(data)) return [];

  return data.map((result: any) => ({
    formatted_address: result.display_name || normalized,
    geometry: {
      location: {
        lat: parseFloat(result.lat),
        lng: parseFloat(result.lon),
      },
    },
    components: parseAddressComponents(result.address),
  }));
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
    { headers: NOMINATIM_HEADERS },
  );

  const data = await response.json();
  return data?.display_name ?? null;
}

export async function reverseGeocodeDetailed(lat: number, lng: number): Promise<PlaceResult | null> {
  const viaGoogle = await reverseGeocodeGoogle(lat, lng);
  if (viaGoogle) {
    return {
      formatted_address: viaGoogle.formattedAddress,
      // Keep the caller's own GPS fix rather than Google's (possibly
      // snapped-to-road) geometry — this is "what address is at this point?",
      // not "give me a new point," matching the existing Nominatim behavior below.
      geometry: { location: { lat, lng } },
      components: viaGoogle.components,
    };
  }

  const response = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`,
    { headers: NOMINATIM_HEADERS },
  );

  const data = await response.json();
  if (!data?.display_name) return null;

  return {
    formatted_address: data.display_name,
    geometry: { location: { lat, lng } },
    components: parseAddressComponents(data.address),
  };
}

export async function fetchRoute(from: LatLng, to: LatLng): Promise<RouteResult | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;

  const response = await fetch(url);
  const data = await response.json();
  const route = data?.routes?.[0];
  if (!route) return null;

  return {
    coordinates: route.geometry.coordinates.map(
      ([lng, lat]: [number, number]) => ({ lat, lng }),
    ),
    distanceKm: route.distance / 1000,
    durationMin: route.duration / 60,
  };
}
