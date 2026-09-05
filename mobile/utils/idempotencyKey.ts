/**
 * Generates a client-side key identifying one booking-submission attempt,
 * so a retried POST /bookings (app backgrounded mid-request, network
 * timeout + user taps Submit again) returns the already-created booking
 * instead of creating a duplicate — see bookingController.createBooking's
 * idempotencyKey handling. Doesn't need cryptographic randomness: the
 * backend scopes uniqueness to (clientId, idempotencyKey), so this only
 * has to avoid colliding within one client's own retries, not globally.
 * No new dependency (e.g. expo-crypto) needed for that bar.
 */
export function generateIdempotencyKey(): string {
  const random = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${random}`;
}
