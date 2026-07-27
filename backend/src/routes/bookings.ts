import { Router } from 'express';
import {
  createBooking,
  listBookings,
  getBookingDetail,
  acceptBooking,
  declineBooking,
  startBooking,
  submitQuote,
  approveQuote,
  disputeQuote,
  completeBooking,
  cancelBooking,
  rescheduleBooking,
  addAddon,
  submitReview,
} from '../controllers/bookingController';
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

// Accept booking (worker only)
router.patch('/:id/accept', restrictTo('WORKER'), acceptBooking);

// Decline booking (worker only)
router.patch('/:id/decline', restrictTo('WORKER'), validateBookingStatusUpdate, declineBooking);

// Start booking (worker only)
router.patch('/:id/start', restrictTo('WORKER'), startBooking);

// Submit quote (worker only)
router.post('/:id/quote', restrictTo('WORKER'), validateSubmitQuote, submitQuote);

// Approve quote (client only)
router.patch('/:id/quote/approve', restrictTo('CLIENT'), validateApproveQuote, approveQuote);

// Dispute quote (client only)
router.patch('/:id/quote/dispute', restrictTo('CLIENT'), validateDisputeQuote, disputeQuote);

// Complete booking (worker only)
router.patch('/:id/complete', restrictTo('WORKER'), completeBooking);

// Cancel booking (client or worker)
router.patch('/:id/cancel', validateBookingStatusUpdate, cancelBooking);

// Reschedule booking (client or worker)
router.patch('/:id/reschedule', validateRescheduleBooking, rescheduleBooking);

// Add addon (worker only)
router.post('/:id/addons', restrictTo('WORKER'), validateAddAddon, addAddon);

// Submit review (client only)
router.post('/:id/review', restrictTo('CLIENT'), validateAddReview, submitReview);


export default router;