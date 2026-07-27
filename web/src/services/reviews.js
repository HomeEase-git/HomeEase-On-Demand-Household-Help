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

export async function updateReview(id, payload) {
  const response = await apiRequest(`/admin/reviews/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return response.data;
}
