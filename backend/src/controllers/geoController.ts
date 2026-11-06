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

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,36}$/;
const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;

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

export const reverseGeocode = async (req: Request, res: Response) => {
  const { lat, lng } = req.body as { lat?: number; lng?: number };
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json(errorResponse(400, 'lat and lng are required and must be numbers'));
  }
  return res.status(200).json({ success: true, message: 'Reverse geocoding moved on-device', data: null });
};

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
