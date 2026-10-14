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
// The part being warned about, exactly as the modal showed it (warnedParty),
// so a report that lands while the modal is open can't redirect the warning.
export const warnTargetOf = (review) => (review.flagTarget === 'RESPONSE' ? 'RESPONSE' : 'REVIEW')

export async function warnReviewAuthor(review, reason) {
  const response = await apiRequest(`/admin/reviews/${review.id}/warn`, {
    method: 'POST',
    body: JSON.stringify({ reason, target: warnTargetOf(review) }),
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
