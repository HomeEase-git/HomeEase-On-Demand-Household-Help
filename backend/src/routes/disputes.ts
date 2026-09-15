import { Router } from 'express';
import { getDisputeForParty } from '../controllers/disputeController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Any authenticated user may call this — getDisputeForParty itself checks
// the caller is either the dispute's raiser or a party on its booking
// (client or worker), returning 403 otherwise. Distinct from
// /api/admin/disputes, which is admin-only and unrestricted by ownership.
router.use(authMiddleware);

router.get('/:id', getDisputeForParty);

export default router;
