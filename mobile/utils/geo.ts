export type LatLng = { lat: number; lng: number };

export type AddressComponents = {
  street?: string;
  city?: string;
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
  const city =
    address.city || address.town || address.municipality || address.suburb || address.county;
  const state = address.state || address.region;
  const zipCode = address.postcode;
  return { street, city, state, zipCode };
}

export async function geocodeAddress(address: string): Promise<PlaceResult | null> {
  const normalized = address.trim();
  if (!normalized) return null;

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q=${encodeURIComponent(
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
