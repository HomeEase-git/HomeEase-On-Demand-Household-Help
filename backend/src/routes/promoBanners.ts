import { Router } from 'express';
import { listActivePromoBanners } from '../controllers/promoBannerController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.get('/', authMiddleware, listActivePromoBanners);

export default router;
