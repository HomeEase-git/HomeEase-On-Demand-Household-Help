import { Router } from 'express';
import {
  createBooking,
  listBookings,
  getBookingDetail,
  acceptBooking,
  declineBooking,
  arriveBooking,
  updateWorkerLiveLocation,
  startBooking,
  scheduleVisit,
  cancelVisit,
  acknowledgeReschedule,
  requestReschedule,
  withdrawRescheduleRequest,
  respondToRescheduleRequest,
  submitQuote,
  approveQuote,
  rejectQuote,
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
  validateSubmitQuote,
  validateRejectQuote,
  validateDateAndTime,
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

// "Follow Up Date": the worker schedules another visit when the job needs
// more than one day (worker only)
router.post('/:id/visits', restrictTo('WORKER'), validateDateAndTime, scheduleVisit);
router.patch('/:id/visits/:visitId/cancel', restrictTo('WORKER'), cancelVisit);

// Client keeps the new date for a booking the old "Continue Tomorrow"
// spillover moved (client only; bookings from before follow-up visits)
router.patch('/:id/acknowledge-reschedule', restrictTo('CLIENT'), acknowledgeReschedule);

// Reschedule request (ACCEPTED bookings only) — the client or the worker
// proposes a new date/time and the other side accepts or declines it.
router.patch('/:id/request-reschedule', restrictTo('CLIENT', 'WORKER'), validateDateAndTime, requestReschedule);
router.patch('/:id/reschedule-request/withdraw', restrictTo('CLIENT', 'WORKER'), withdrawRescheduleRequest);
router.patch('/:id/reschedule-request/respond', restrictTo('CLIENT', 'WORKER'), respondToRescheduleRequest);

// Submit quote (worker only)
router.post('/:id/quote', restrictTo('WORKER'), validateSubmitQuote, submitQuote);

// Approve or refuse quote (client only)
router.patch('/:id/quote/approve', restrictTo('CLIENT'), validateApproveQuote, approveQuote);
router.patch('/:id/quote/reject', restrictTo('CLIENT'), validateRejectQuote, rejectQuote);

// Dispute quote (client only)
router.patch('/:id/quote/dispute', restrictTo('CLIENT'), validateDisputeQuote, disputeQuote);

// Upload a job-completion proof photo (worker only)
router.post('/:id/completion-photo/upload', restrictTo('WORKER'), bookingPhotoUpload, uploadBookingCompletionPhoto);
// Same upload for the worker's other job photos: quote receipts, materials
// in use, and proof for a cancellation after arriving.
router.post('/:id/job-photo/upload', restrictTo('WORKER'), bookingPhotoUpload, uploadBookingCompletionPhoto);

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