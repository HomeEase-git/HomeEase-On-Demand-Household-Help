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

router.use(authMiddleware);

router.post('/geocode', geocodeAddress);
router.post('/reverse-geocode', reverseGeocode);
router.post('/search', searchAddresses);
router.post('/autocomplete', autocompleteAddresses);
router.post('/place-details', getPlaceDetails);
router.post('/directions', getDirections);

export default router;
