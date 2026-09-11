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

export async function geocodeAddress(address: string): Promise<PlaceResult | null> {
  const normalized = address.trim();
  if (!normalized) return null;

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&countrycodes=ph&q=${encodeURIComponent(
      normalized,
    )}`,
    { headers: NOMINATIM_HEADERS },
  );

  const data = await response.json();
  const firstResult = data?.[0];
  if (!firstResult) return null;

  return {
    formatted_address: firstResult.display_name || normalized,
    geometry: {
      location: {
        lat: parseFloat(firstResult.lat),
        lng: parseFloat(firstResult.lon),
      },
    },
    components: parseAddressComponents(firstResult.address),
  };
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

/**
 * Multi-result address search for autocomplete-style UI (as opposed to
 * `geocodeAddress`, which only returns the single best match). Backed by
 * Nominatim (OpenStreetMap) rather than Google Places — this app has no
 * Google Maps/Places API key or SDK configured, and Nominatim is free/keyless
 * and already the established geocoding provider (see `geocodeAddress`/
 * `reverseGeocodeDetailed` above, used by the existing address-picker
 * screen). Swap the fetch implementation here if a Google Places key is
 * added later; callers only depend on the `PlaceResult[]` shape.
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
