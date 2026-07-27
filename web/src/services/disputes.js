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

export async function fetchDisputes(params = {}) {
  const response = await apiRequest(`/admin/disputes?${buildQuery(params)}`);
  return { data: response.data, meta: response.meta };
}

export async function updateDispute(id, payload) {
  const response = await apiRequest(`/admin/disputes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return response.data;
}
