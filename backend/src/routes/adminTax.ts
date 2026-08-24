import { Router } from 'express';
import {
  generateCertificates,
  listCertificates,
  downloadCertificate,
  listRemittancePeriods,
  markRemitted,
} from '../controllers/adminTaxController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

const router = Router();

router.use(authMiddleware, restrictTo('ADMIN'));

router.post('/certificates/generate', generateCertificates);
router.get('/certificates', listCertificates);
router.get('/certificates/:id/download', downloadCertificate);

router.get('/remittance', listRemittancePeriods);
router.post('/remittance/mark-remitted', markRemitted);

export default router;
