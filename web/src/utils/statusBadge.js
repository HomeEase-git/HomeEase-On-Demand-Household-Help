// Maps backend status enums (raw "COMPLETED" or admin-API title-cased
// "In_progress") to the Badge component's color variants, so every page
// shows the same status in the same color instead of a two-color guess.

function normalize(status) {
  return String(status || '').toUpperCase().replace(/[\s-]+/g, '_')
}

const BOOKING_VARIANTS = {
  COMPLETED: 'approved',
  CANCELLED: 'flagged',
  REJECTED: 'flagged',
  DISPUTED: 'flagged',
}

export function getBookingStatusVariant(status) {
  return BOOKING_VARIANTS[normalize(status)] || 'pending'
}

const PAYMENT_VARIANTS = {
  COMPLETED: 'approved',
  REFUNDED: 'approved',
  FAILED: 'flagged',
}

export function getPaymentStatusVariant(status) {
  return PAYMENT_VARIANTS[normalize(status)] || 'pending'
}
