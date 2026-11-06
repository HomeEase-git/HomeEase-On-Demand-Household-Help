import { apiRequest } from './apiClient';

export async function fetchCancellationReviews(status = 'PENDING_REVIEW') {
  const response = await apiRequest(`/admin/cancellations?status=${encodeURIComponent(status)}`);
  return response.data;
}

export async function reviewCancellation(bookingId, decision, note) {
  const response = await apiRequest(`/admin/cancellations/${bookingId}/review`, {
    method: 'PATCH',
    body: JSON.stringify({ decision, note }),
  });
  return response;
}
