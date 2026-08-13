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

export async function fetchWorkerWallet(id) {
  const response = await apiRequest(`/admin/users/workers/${id}/wallet`);
  return response.data;
}

/** PATCH /admin/users/workers/:id/wallet/adjust — signed amount (positive credits, negative debits). */
export async function adjustWorkerWallet(id, amount, reason) {
  const response = await apiRequest(`/admin/users/workers/${id}/wallet/adjust`, {
    method: 'PATCH',
    body: JSON.stringify({ amount, reason }),
  });
  return response.data;
}
