"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const workerController_1 = require("../controllers/workerController");
const auth_1 = require("../middleware/auth");
const role_1 = require("../middleware/role");
const validation_1 = require("../middleware/validation");
const router = (0, express_1.Router)();
// Public routes (no auth required)
router.get('/', workerController_1.searchWorkers);
router.get('/:workerId', workerController_1.getWorkerDetail);
router.get('/:workerId/reviews', workerController_1.getWorkerReviews);
router.get('/:workerId/availability', workerController_1.getWorkerAvailability);
router.get('/:workerId/blocked-dates', workerController_1.getWorkerBlockedDates);
// Protected routes (auth + worker only)
router.patch('/me/availability', auth_1.authMiddleware, (0, role_1.restrictTo)('WORKER'), validation_1.validateUpdateAvailability, workerController_1.updateAvailability);
router.patch('/me/profile', auth_1.authMiddleware, (0, role_1.restrictTo)('WORKER'), validation_1.validateUpdateWorkerProfile, workerController_1.updateWorkerProfile);
router.post('/me/service-types', auth_1.authMiddleware, (0, role_1.restrictTo)('WORKER'), validation_1.validateAddServiceTypes, workerController_1.addServiceTypes);
router.get('/me/capacity', auth_1.authMiddleware, (0, role_1.restrictTo)('WORKER'), workerController_1.getWorkerCapacity);
exports.default = router;
//# sourceMappingURL=workers.js.map