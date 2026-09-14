import { Router } from 'express';
import {
  listTasksForServiceType,
  createTask,
  updateTask,
  toggleTaskActive,
} from '../controllers/adminServiceTaskController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';

// mergeParams so :serviceTypeId (from the mount path in app.ts) is visible
// on req.params here, the same way a nested Express router normally would.
const router = Router({ mergeParams: true });

router.use(authMiddleware, restrictTo('ADMIN'));

router.get('/', listTasksForServiceType);
router.post('/', createTask);
router.patch('/:taskId', updateTask);
router.patch('/:taskId/toggle-active', toggleTaskActive);

export default router;
