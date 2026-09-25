import { Router } from 'express';
import { listActivePromoBanners } from '../controllers/promoBannerController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Signed-in app users (the client home screen); admin management lives
// under /api/admin/promo-banners.
router.get('/', authMiddleware, listActivePromoBanners);

export default router;
