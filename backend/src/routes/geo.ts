import { Router } from 'express';
import {
  geocodeAddress,
  reverseGeocode,
  searchAddresses,
  autocompleteAddresses,
  getPlaceDetails,
  getDirections,
} from '@controllers/geoController';
import { authMiddleware } from '@middleware/auth';

const router = Router();

// Auth-gated (not just rate-limited) so an unauthenticated caller can't run
// up this project's Google Maps billing for free.
router.use(authMiddleware);

router.post('/geocode', geocodeAddress);
router.post('/reverse-geocode', reverseGeocode);
router.post('/search', searchAddresses);
router.post('/autocomplete', autocompleteAddresses);
router.post('/place-details', getPlaceDetails);
router.post('/directions', getDirections);

export default router;
