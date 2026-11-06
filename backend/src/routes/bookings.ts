import { Router } from 'express';
import {
  createBooking,
  listBookings,
  getBookingDetail,
  acceptBooking,
  declineBooking,
  arriveBooking,
  reportClientNotHere,
  updateWorkerLiveLocation,
  startBooking,
  scheduleVisit,
  cancelVisit,
  acknowledgeReschedule,
  requestReschedule,
  withdrawRescheduleRequest,
  respondToRescheduleRequest,
  completeBooking,
  markCashReceived,
  reportCashNotPaid,
  confirmCompletion,
  reportInvoice,
  reportBookingProblem,
  respondToCancelRequest,
  cancelBooking,
  submitReview,
  reportReview,
  addBeforePhotos,
  addProgressPhotos,
} from '../controllers/bookingController';
import { bookingPhotoUpload, uploadBookingCompletionPhoto, uploadIssuePhoto, uploadReviewPhoto } from '../controllers/uploadController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';
import {
  validateCreateBooking,
  validateDateAndTime,
  validateBookingStatusUpdate,
  validateAddReview,
  validateArriveBooking,
  validateLiveLocation,
} from '../middleware/validation';

const router = Router();

// All booking routes require auth
router.use(authMiddleware);

// List bookings (role-filtered)
router.get('/', listBookings);

// Get booking detail
router.get('/:id', getBookingDetail);

// Create booking (client only)
router.post('/', restrictTo('CLIENT'), validateCreateBooking, createBooking);

router.post('/issue-photo/upload', restrictTo('CLIENT'), bookingPhotoUpload, uploadIssuePhoto);

// Accept booking (worker only)
router.patch('/:id/accept', restrictTo('WORKER'), acceptBooking);

// Decline booking (worker only)
router.patch('/:id/decline', restrictTo('WORKER'), validateBookingStatusUpdate, declineBooking);

router.patch('/:id/arrive', restrictTo('WORKER'), validateArriveBooking, arriveBooking);

router.patch('/:id/client-not-here', restrictTo('WORKER'), reportClientNotHere);

router.patch('/:id/live-location', restrictTo('WORKER'), validateLiveLocation, updateWorkerLiveLocation);

router.patch('/:id/start', restrictTo('WORKER'), startBooking);

router.post('/:id/visits', restrictTo('WORKER'), validateDateAndTime, scheduleVisit);
router.patch('/:id/visits/:visitId/cancel', restrictTo('WORKER'), cancelVisit);

router.patch('/:id/acknowledge-reschedule', restrictTo('CLIENT'), acknowledgeReschedule);

router.patch('/:id/request-reschedule', restrictTo('CLIENT', 'WORKER'), validateDateAndTime, requestReschedule);
router.patch('/:id/reschedule-request/withdraw', restrictTo('CLIENT', 'WORKER'), withdrawRescheduleRequest);
router.patch('/:id/reschedule-request/respond', restrictTo('CLIENT', 'WORKER'), respondToRescheduleRequest);

// Upload a job-completion proof photo (worker only)
router.post('/:id/completion-photo/upload', restrictTo('WORKER'), bookingPhotoUpload, uploadBookingCompletionPhoto);
router.post('/:id/job-photo/upload', restrictTo('WORKER'), bookingPhotoUpload, uploadBookingCompletionPhoto);

router.post('/:id/before-photos', restrictTo('WORKER'), addBeforePhotos);

router.post('/:id/progress-photos', restrictTo('WORKER'), addProgressPhotos);

router.patch('/:id/complete', restrictTo('WORKER'), completeBooking);

router.patch('/:id/cash-received', restrictTo('WORKER'), markCashReceived);
router.patch('/:id/cash-not-paid', restrictTo('WORKER'), reportCashNotPaid);

router.patch('/:id/confirm-completion', restrictTo('CLIENT'), confirmCompletion);

router.patch('/:id/invoice/report', restrictTo('CLIENT'), reportInvoice);

router.post('/:id/problem', restrictTo('CLIENT'), reportBookingProblem);

router.patch('/:id/cancel-request/respond', restrictTo('WORKER'), respondToCancelRequest);

// Cancel booking (client or worker)
router.patch('/:id/cancel', validateBookingStatusUpdate, cancelBooking);

router.post('/:id/review-photo/upload', restrictTo('CLIENT'), bookingPhotoUpload, uploadReviewPhoto);

// Submit review (client only)
router.post('/:id/review', restrictTo('CLIENT'), validateAddReview, submitReview);

router.post('/:id/review/report', restrictTo('CLIENT', 'WORKER'), reportReview);


export default router;