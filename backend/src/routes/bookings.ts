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
  confirmCompletion,
  reportInvoice,
  cancelBooking,
  submitReview,
  reportReview,
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

// Worker is at the door and can't reach the client: alerts them and starts the wait (worker only)
router.patch('/:id/client-not-here', restrictTo('WORKER'), reportClientNotHere);

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

// Upload a job-completion proof photo (worker only)
router.post('/:id/completion-photo/upload', restrictTo('WORKER'), bookingPhotoUpload, uploadBookingCompletionPhoto);
// Same upload for the worker's other job photos: invoice receipts, extra
// work, and proof for a cancellation after arriving.
router.post('/:id/job-photo/upload', restrictTo('WORKER'), bookingPhotoUpload, uploadBookingCompletionPhoto);

// Worker posts an "ongoing" proof photo update (worker only)
router.post('/:id/progress-photos', restrictTo('WORKER'), addProgressPhotos);

// Worker finishes the job and sends the invoice (completion photo, parts,
// extra work) (worker only)
router.patch('/:id/complete', restrictTo('WORKER'), completeBooking);

// Worker confirms the client paid a cash invoice (worker only)
router.patch('/:id/cash-received', restrictTo('WORKER'), markCashReceived);

// "Pay now" on a GCash/Maya invoice — returns the checkout URL (client only)
router.patch('/:id/confirm-completion', restrictTo('CLIENT'), confirmCompletion);

// Client reports the invoice before paying — goes to an admin (client only)
router.patch('/:id/invoice/report', restrictTo('CLIENT'), reportInvoice);

// Cancel booking (client or worker)
router.patch('/:id/cancel', validateBookingStatusUpdate, cancelBooking);

// Upload a review photo (client only) — no reviewId yet, returned URL is
// included in the submit-review payload as photoUrls.
router.post('/:id/review-photo/upload', restrictTo('CLIENT'), bookingPhotoUpload, uploadReviewPhoto);

// Submit review (client only)
router.post('/:id/review', restrictTo('CLIENT'), validateAddReview, submitReview);

// Report the review (worker) or the worker's reply to it (client)
router.post('/:id/review/report', restrictTo('CLIENT', 'WORKER'), reportReview);


export default router;