import { apiRequest } from './apiClient';

function buildQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });
  return query.toString();
}

export async function fetchReviews(params = {}) {
  const response = await apiRequest(`/admin/reviews?${buildQuery(params)}`);
  return { data: response.data, meta: response.meta };
}

export async function fetchReviewById(id) {
  const response = await apiRequest(`/admin/reviews/${id}`);
  return response.data;
}

/** POST /admin/reviews/:id/warn — strikes the author of the reported part (3rd strike suspends). */
export async function warnReviewAuthor(id, reason) {
  const response = await apiRequest(`/admin/reviews/${id}/warn`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
  return response.data;
}

/** Who a warning on this review goes to, from the reported part. */
export function warnedParty(review) {
  return review.flagTarget === 'RESPONSE' ? `${review.worker} (worker, for their reply)` : `${review.client} (client, for the review)`;
}

export async function updateReview(id, payload) {
  const response = await apiRequest(`/admin/reviews/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return response.data;
}
