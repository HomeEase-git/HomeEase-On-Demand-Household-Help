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

export async function fetchWorkerDebt(id) {
  const response = await apiRequest(`/admin/users/workers/${id}/debt`);
  return response.data;
}

/** PATCH /admin/users/workers/:id/debt/adjust — signed amount (positive reduces what's owed, negative increases it). */
export async function adjustWorkerDebt(id, amount, reason) {
  const response = await apiRequest(`/admin/users/workers/${id}/debt/adjust`, {
    method: 'PATCH',
    body: JSON.stringify({ amount, reason }),
  });
  return response.data;
}

/** PATCH /admin/users/workers/:id/debt/release — lifts an account hold. */
export async function releaseWorkerHold(id, note) {
  const response = await apiRequest(`/admin/users/workers/${id}/debt/release`, {
    method: 'PATCH',
    body: JSON.stringify({ note }),
  });
  return response.data;
}
