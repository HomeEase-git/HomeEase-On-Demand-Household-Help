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

export async function fetchWorkers(params = {}) {
  const response = await apiRequest(`/admin/users/workers?${buildQuery(params)}`);
  return { data: response.data, meta: response.meta };
}

export async function fetchWorkerById(id) {
  const response = await apiRequest(`/admin/users/workers/${id}`);
  return response.data;
}
