import { Router } from 'express';
import { getServiceTypes } from '@controllers/serviceController';

const router = Router();

router.get('/', getServiceTypes);

export default router;