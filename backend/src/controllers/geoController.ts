import { Request, Response } from 'express';
import { errorResponse } from '@utils/errorResponse';
import {
  googleAutocomplete,
  googleGeocodeAddress,
  googlePlaceDetails,
  googleSearchAddresses,
  isGooglePlacesConfigured,
} from '@services/googlePlacesService';
import { googleDirections, isGoogleDirectionsConfigured } from '@services/googleDirectionsService';

// All endpoints below respond 200 with a "not configured"/"not found"/empty
// result rather than a 4xx/5xx for "we don't have an answer" — the mobile
// client treats all of those the same way (surface a manual-entry fallback in
// the UI), so there's no reason to make it distinguish HTTP status codes for
// what's the same outcome from its perspective. Backed by Places API (New)
// and Routes API; GOOGLE_MAPS_API_KEY must be set for any of them to work.

// Places session tokens must be URL/filename-safe base64, max 36 chars
// (a UUIDv4 fits). Place IDs use the same alphabet, just longer.
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,36}$/;
const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;

/**
 * POST /api/geo/geocode
 * body: { address: string }
 */
export const geocodeAddress = async (req: Request, res: Response) => {
  const { address } = req.body as { address?: string };
  if (!address || typeof address !== 'string' || !address.trim()) {
    return res.status(400).json(errorResponse(400, 'address is required and must be a non-empty string'));
  }

  if (!isGooglePlacesConfigured()) {
    return res.status(200).json({ success: true, message: 'Google Places not configured', data: null });
  }

  try {
    const result = await googleGeocodeAddress(address);
    return res.status(200).json({ success: true, message: result ? 'Resolved' : 'Not found', data: result });
  } catch (error) {
    console.error('Google geocode error:', error);
    return res.status(200).json({ success: true, message: 'Provider error', data: null });
  }
};

/**
 * POST /api/geo/reverse-geocode
 * body: { lat: number, lng: number }
 *
 * Deprecated: reverse geocoding now runs on-device (Android's native
 * geocoder via expo-location), and the Geocoding API is no longer used.
 * Kept only so app builds that predate that change get the "not found" they
 * already handle (manual address entry) instead of a 404.
 */
export const reverseGeocode = async (req: Request, res: Response) => {
  const { lat, lng } = req.body as { lat?: number; lng?: number };
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json(errorResponse(400, 'lat and lng are required and must be numbers'));
  }
  return res.status(200).json({ success: true, message: 'Reverse geocoding moved on-device', data: null });
};

/**
 * POST /api/geo/search
 * body: { query: string, limit?: number }
 *
 * Multi-result free-text search. New app builds use /autocomplete +
 * /place-details instead; this stays for older builds.
 */
export const searchAddresses = async (req: Request, res: Response) => {
  const { query, limit } = req.body as { query?: string; limit?: number };
  if (!query || typeof query !== 'string' || query.trim().length < 3) {
    return res.status(200).json({ success: true, message: 'Query too short', data: [] });
  }

  if (!isGooglePlacesConfigured()) {
    return res.status(200).json({ success: true, message: 'Google Places not configured', data: [] });
  }

  try {
    const results = await googleSearchAddresses(query.trim(), typeof limit === 'number' ? limit : undefined);
    return res.status(200).json({ success: true, message: 'Resolved', data: results });
  } catch (error) {
    console.error('Google address search error:', error);
    return res.status(200).json({ success: true, message: 'Provider error', data: [] });
  }
};

/**
 * POST /api/geo/autocomplete
 * body: { input: string, sessionToken: string, near?: { lat, lng } }
 */
export const autocompleteAddresses = async (req: Request, res: Response) => {
  const { input, sessionToken, near } = req.body as {
    input?: string;
    sessionToken?: string;
    near?: { lat?: number; lng?: number };
  };
  if (typeof sessionToken !== 'string' || !SESSION_TOKEN_PATTERN.test(sessionToken)) {
    return res.status(400).json(errorResponse(400, 'sessionToken is required (URL-safe, max 36 characters)'));
  }
  if (!input || typeof input !== 'string' || input.trim().length < 3) {
    return res.status(200).json({ success: true, message: 'Input too short', data: [] });
  }

  if (!isGooglePlacesConfigured()) {
    return res.status(200).json({ success: true, message: 'Google Places not configured', data: [] });
  }

  const bias =
    Number.isFinite(near?.lat) && Number.isFinite(near?.lng)
      ? { lat: near!.lat as number, lng: near!.lng as number }
      : undefined;

  try {
    const results = await googleAutocomplete(input.trim().slice(0, 200), sessionToken, bias);
    return res.status(200).json({ success: true, message: 'Resolved', data: results });
  } catch (error) {
    console.error('Google autocomplete error:', error);
    return res.status(200).json({ success: true, message: 'Provider error', data: [] });
  }
};

/**
 * POST /api/geo/place-details
 * body: { placeId: string, sessionToken?: string }
 */
export const getPlaceDetails = async (req: Request, res: Response) => {
  const { placeId, sessionToken } = req.body as { placeId?: string; sessionToken?: string };
  if (typeof placeId !== 'string' || !PLACE_ID_PATTERN.test(placeId)) {
    return res.status(400).json(errorResponse(400, 'placeId is required'));
  }
  if (sessionToken !== undefined && (typeof sessionToken !== 'string' || !SESSION_TOKEN_PATTERN.test(sessionToken))) {
    return res.status(400).json(errorResponse(400, 'sessionToken must be URL-safe, max 36 characters'));
  }

  if (!isGooglePlacesConfigured()) {
    return res.status(200).json({ success: true, message: 'Google Places not configured', data: null });
  }

  try {
    const result = await googlePlaceDetails(placeId, sessionToken);
    return res.status(200).json({ success: true, message: result ? 'Resolved' : 'Not found', data: result });
  } catch (error) {
    console.error('Google place details error:', error);
    return res.status(200).json({ success: true, message: 'Provider error', data: null });
  }
};

/**
 * POST /api/geo/directions
 * body: { origin: { lat, lng }, destination: { lat, lng } }
 */
export const getDirections = async (req: Request, res: Response) => {
  const { origin, destination } = req.body as {
    origin?: { lat?: number; lng?: number };
    destination?: { lat?: number; lng?: number };
  };

  if (
    !Number.isFinite(origin?.lat) ||
    !Number.isFinite(origin?.lng) ||
    !Number.isFinite(destination?.lat) ||
    !Number.isFinite(destination?.lng)
  ) {
    return res.status(400).json(errorResponse(400, 'origin and destination lat/lng are required and must be numbers'));
  }

  if (!isGoogleDirectionsConfigured()) {
    return res.status(200).json({ success: true, message: 'Google directions not configured', data: null });
  }

  try {
    const result = await googleDirections(
      { lat: origin!.lat as number, lng: origin!.lng as number },
      { lat: destination!.lat as number, lng: destination!.lng as number },
    );
    return res.status(200).json({ success: true, message: result ? 'Resolved' : 'Not found', data: result });
  } catch (error) {
    console.error('Google directions error:', error);
    return res.status(200).json({ success: true, message: 'Provider error', data: null });
  }
};
