import { Router } from 'express';
import {
  adminListPromoBanners,
  createPromoBanner,
  updatePromoBanner,
  reorderPromoBanners,
  deletePromoBanner,
  promoBannerImageUpload,
  uploadPromoBannerImage,
} from '../controllers/promoBannerController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

router.get('/', adminListPromoBanners);
router.post('/', createPromoBanner);
router.post('/upload-image', promoBannerImageUpload, uploadPromoBannerImage);
// Before '/:id' so "order" isn't taken for an id.
router.put('/order', reorderPromoBanners);
router.put('/:id', updatePromoBanner);
router.delete('/:id', deletePromoBanner);

export default router;
