import { promoBannerImageUpload, uploadPromoBannerImage } from '../controllers/promoBannerController';
import { Router } from 'express';
import {
  listServiceTypesAdmin,
  createServiceType,
  updateServiceType,
  toggleServiceTypeActive,
} from '../controllers/adminServiceTypeController';
import { createServiceCatalog, updateServiceCatalog } from '../controllers/adminCatalogController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

router.get('/', listServiceTypesAdmin);
router.post('/', createServiceType);
router.post('/upload-image', promoBannerImageUpload, uploadPromoBannerImage);
router.post('/catalog', createServiceCatalog);
router.put('/:id/catalog', updateServiceCatalog);
router.patch('/:id', updateServiceType);
router.patch('/:id/toggle-active', toggleServiceTypeActive);

export default router;
