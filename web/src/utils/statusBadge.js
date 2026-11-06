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
