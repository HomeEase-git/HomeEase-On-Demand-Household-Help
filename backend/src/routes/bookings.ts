import { Router } from 'express';
import {
  createBooking,
  createMultiDayBooking,
  listBookings,
  getBookingDetail,
  acceptBooking,
  declineBooking,
  arriveBooking,
  updateWorkerLiveLocation,
  startBooking,
  extendBooking,
  acknowledgeReschedule,
  requestReschedule,
  withdrawRescheduleRequest,
  respondToRescheduleRequest,
  submitQuote,
  approveQuote,
  disputeQuote,
  completeBooking,
  confirmCompletion,
  cancelBooking,
  addAddon,
  respondToAddon,
  submitReview,
} from '../controllers/bookingController';
import { bookingPhotoUpload, uploadBookingCompletionPhoto, uploadIssuePhoto, uploadReviewPhoto } from '../controllers/uploadController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';
import {
  validateCreateBooking,
  validateCreateMultiDayBooking,
  validateSubmitQuote,
  validateBookingStatusUpdate,
  validateApproveQuote,
  validateDisputeQuote,
  validateAddAddon,
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

// Book the same worker for N consecutive days upfront (client only) — see
// createMultiDayBooking's docblock for how this differs from a single-day
// POST / above.
router.post('/multi-day', restrictTo('CLIENT'), validateCreateMultiDayBooking, createMultiDayBooking);

// Upload a pre-booking issue photo (client only) — no bookingId yet, since
// this runs during Step 1 before the booking exists; the returned URL is
// included in the createBooking payload as issuePhotoUrls.
router.post('/issue-photo/upload', restrictTo('CLIENT'), bookingPhotoUpload, uploadIssuePhoto);

// Accept booking (worker only)
router.patch('/:id/accept', restrictTo('WORKER'), acceptBooking);

// Decline booking (worker only)
router.patch('/:id/decline', restrictTo('WORKER'), validateBookingStatusUpdate, declineBooking);

// Worker checks in as arrived at the job site (worker only)
router.patch('/:id/arrive', restrictTo('WORKER'), validateArriveBooking, arriveBooking);

// Worker's live GPS while en route (worker only) — pushed to the client over
// the socket so "Track Service" can show a moving marker
router.patch('/:id/live-location', restrictTo('WORKER'), validateLiveLocation, updateWorkerLiveLocation);

// Start booking (worker only) — requires a prior verified arrival
router.patch('/:id/start', restrictTo('WORKER'), startBooking);

// Worker signals a job is running into a second day (worker only) — see
// extendBooking's docblock for the reschedule-on-conflict behavior this triggers
router.patch('/:id/extend', restrictTo('WORKER'), extendBooking);

// Client keeps the new date for a booking a worker's spillover moved (client only)
router.patch('/:id/acknowledge-reschedule', restrictTo('CLIENT'), acknowledgeReschedule);

// Client-initiated reschedule request (ACCEPTED bookings only) — client
// proposes a new date/time, the assigned worker must accept or decline it.
router.patch('/:id/request-reschedule', restrictTo('CLIENT'), requestReschedule);
router.patch('/:id/reschedule-request/withdraw', restrictTo('CLIENT'), withdrawRescheduleRequest);
router.patch('/:id/reschedule-request/respond', restrictTo('WORKER'), respondToRescheduleRequest);

// Submit quote (worker only)
router.post('/:id/quote', restrictTo('WORKER'), validateSubmitQuote, submitQuote);

// Approve quote (client only)
router.patch('/:id/quote/approve', restrictTo('CLIENT'), validateApproveQuote, approveQuote);

// Dispute quote (client only)
router.patch('/:id/quote/dispute', restrictTo('CLIENT'), validateDisputeQuote, disputeQuote);

// Upload a job-completion proof photo (worker only)
router.post('/:id/completion-photo/upload', restrictTo('WORKER'), bookingPhotoUpload, uploadBookingCompletionPhoto);

// Complete booking — worker submits completion photo, awaits client confirmation (worker only)
router.patch('/:id/complete', restrictTo('WORKER'), completeBooking);

// Confirm completion — client reviews the photo and finalizes the booking (client only)
router.patch('/:id/confirm-completion', restrictTo('CLIENT'), confirmCompletion);

// Cancel booking (client or worker)
router.patch('/:id/cancel', validateBookingStatusUpdate, cancelBooking);

// Add addon (worker only)
router.post('/:id/addons', restrictTo('WORKER'), validateAddAddon, addAddon);
router.patch('/:id/addons/:addonId/respond', restrictTo('CLIENT'), respondToAddon);

// Upload a review photo (client only) — no reviewId yet, returned URL is
// included in the submit-review payload as photoUrls.
router.post('/:id/review-photo/upload', restrictTo('CLIENT'), bookingPhotoUpload, uploadReviewPhoto);

// Submit review (client only)
router.post('/:id/review', restrictTo('CLIENT'), validateAddReview, submitReview);


export default router;