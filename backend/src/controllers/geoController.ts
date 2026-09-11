import { Request, Response } from 'express';
import { errorResponse } from '@utils/errorResponse';
import { googleGeocodeAddress, googleReverseGeocode, isGoogleGeocodingConfigured } from '@services/googleGeocodingService';

// Both endpoints below respond 200 with `data: null` for "not configured",
// "not found", and "provider error" alike — the mobile client treats all
// three identically (fall back to its own Nominatim geocoding), so there's
// no reason to make it distinguish HTTP status codes for what's the same
// "we don't have a Google-quality answer" outcome from its perspective.

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
