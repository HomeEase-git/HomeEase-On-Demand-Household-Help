import { Router } from 'express';
import { geocodeAddress, reverseGeocode } from '@controllers/geoController';
import { authMiddleware } from '@middleware/auth';

const router = Router();

// Auth-gated (not just rate-limited) so an unauthenticated caller can't run
// up this project's Google Maps billing for free.
router.use(authMiddleware);

router.post('/geocode', geocodeAddress);
router.post('/reverse-geocode', reverseGeocode);

export default router;
