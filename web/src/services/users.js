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

export async function fetchClients(params = {}) {
  const response = await apiRequest(`/admin/users/clients?${buildQuery(params)}`);
  return { data: response.data, meta: response.meta };
}

export async function fetchClientById(id) {
  const response = await apiRequest(`/admin/users/clients/${id}`);
  return response.data;
}

export async function updateUserStatus(id, status, reason, notes) {
  const response = await apiRequest(`/admin/users/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, reason, notes }),
  });
  return response.data;
}
