import { Router } from 'express';
import {
  createBooking,
  listBookings,
  getBookingDetail,
  acceptBooking,
  declineBooking,
  arriveBooking,
  startBooking,
  submitQuote,
  approveQuote,
  disputeQuote,
  completeBooking,
  confirmCompletion,
  cancelBooking,
  rescheduleBooking,
  addAddon,
  submitReview,
} from '../controllers/bookingController';
import { bookingPhotoUpload, uploadBookingCompletionPhoto, uploadIssuePhoto, uploadReviewPhoto } from '../controllers/uploadController';
import { authMiddleware } from '../middleware/auth';
import { restrictTo } from '../middleware/role';
import {
  validateCreateBooking,
  validateSubmitQuote,
  validateBookingStatusUpdate,
  validateApproveQuote,
  validateDisputeQuote,
  validateAddAddon,
  validateAddReview,
  validateRescheduleBooking,
  validateArriveBooking,
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

// Start booking (worker only) — requires a prior verified arrival
router.patch('/:id/start', restrictTo('WORKER'), startBooking);

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

// Reschedule booking (client or worker)
router.patch('/:id/reschedule', validateRescheduleBooking, rescheduleBooking);

// Add addon (worker only)
router.post('/:id/addons', restrictTo('WORKER'), validateAddAddon, addAddon);

// Upload a review photo (client only) — no reviewId yet, returned URL is
// included in the submit-review payload as photoUrls.
router.post('/:id/review-photo/upload', restrictTo('CLIENT'), bookingPhotoUpload, uploadReviewPhoto);

// Submit review (client only)
router.post('/:id/review', restrictTo('CLIENT'), validateAddReview, submitReview);


export default router;