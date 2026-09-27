import { apiRequest } from './apiClient';

/** GET /admin/cancellations?status= — on-site cancellations with the worker's proof. */
export async function fetchCancellationReviews(status = 'PENDING_REVIEW') {
  const response = await apiRequest(`/admin/cancellations?status=${encodeURIComponent(status)}`);
  return response.data;
}

/** PATCH /admin/cancellations/:bookingId/review — decision APPROVE (client at fault) or REJECT. */
export async function reviewCancellation(bookingId, decision, note) {
  const response = await apiRequest(`/admin/cancellations/${bookingId}/review`, {
    method: 'PATCH',
    body: JSON.stringify({ decision, note }),
  });
  return response;
}
