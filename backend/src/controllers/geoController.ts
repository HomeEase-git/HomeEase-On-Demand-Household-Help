import { Request, Response } from 'express';
import { errorResponse } from '@utils/errorResponse';
import {
  googleGeocodeAddress,
  googleReverseGeocode,
  googleSearchAddresses,
  isGoogleGeocodingConfigured,
} from '@services/googleGeocodingService';
import { googleDirections, isGoogleDirectionsConfigured } from '@services/googleDirectionsService';

// All endpoints below respond 200 with a "not configured"/"not found"/empty
// result rather than a 4xx/5xx for "we don't have an answer" — the mobile
// client treats all of those the same way (surface a manual-entry fallback in
// the UI), so there's no reason to make it distinguish HTTP status codes for
// what's the same outcome from its perspective. There is no non-Google
// fallback provider anymore (OpenStreetMap/Nominatim/OSRM have been removed
// app-wide) — GOOGLE_MAPS_API_KEY must be set for geocoding, search, and
// directions to work at all.

/**
 * POST /api/geo/geocode
 * body: { address: string }
 */
export const geocodeAddress = async (req: Request, res: Response) => {
  const { address } = req.body as { address?: string };
  if (!address || typeof address !== 'string' || !address.trim()) {
    return res.status(400).json(errorResponse(400, 'address is required and must be a non-empty string'));
  }

  if (!isGoogleGeocodingConfigured()) {
    return res.status(200).json({ success: true, message: 'Google geocoding not configured', data: null });
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
 */
export const reverseGeocode = async (req: Request, res: Response) => {
  const { lat, lng } = req.body as { lat?: number; lng?: number };
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json(errorResponse(400, 'lat and lng are required and must be numbers'));
  }

  if (!isGoogleGeocodingConfigured()) {
    return res.status(200).json({ success: true, message: 'Google geocoding not configured', data: null });
  }

  try {
    const result = await googleReverseGeocode(lat as number, lng as number);
    return res.status(200).json({ success: true, message: result ? 'Resolved' : 'Not found', data: result });
  } catch (error) {
    console.error('Google reverse geocode error:', error);
    return res.status(200).json({ success: true, message: 'Provider error', data: null });
  }
};

/**
 * POST /api/geo/search
 * body: { query: string, limit?: number }
 */
export const searchAddresses = async (req: Request, res: Response) => {
  const { query, limit } = req.body as { query?: string; limit?: number };
  if (!query || typeof query !== 'string' || query.trim().length < 3) {
    return res.status(200).json({ success: true, message: 'Query too short', data: [] });
  }

  if (!isGoogleGeocodingConfigured()) {
    return res.status(200).json({ success: true, message: 'Google geocoding not configured', data: [] });
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
