import { Router } from 'express';
import {
  generateCertificates,
  listCertificates,
  downloadCertificate,
  generateVatSummary,
  listVatSummaries,
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

router.post('/vat-summary/generate', generateVatSummary);
router.get('/vat-summary', listVatSummaries);

router.get('/remittance', listRemittancePeriods);
router.post('/remittance/mark-remitted', markRemitted);

export default router;
