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

export async function suspendUser(id, reason, notes) {
  const response = await apiRequest(`/admin/users/${id}/suspend`, {
    method: 'PATCH',
    body: JSON.stringify({ reason, notes }),
  });
  return response.data;
}

export async function reinstateUser(id, reason, notes) {
  const response = await apiRequest(`/admin/users/${id}/reinstate`, {
    method: 'PATCH',
    body: JSON.stringify({ reason, notes }),
  });
  return response.data;
}

export async function fetchClientPaymentHold(id) {
  const response = await apiRequest(`/admin/users/clients/${id}/payment-hold`);
  return response.data;
}

export async function releaseClientPaymentHold(id, note) {
  const response = await apiRequest(`/admin/users/clients/${id}/payment-hold/release`, {
    method: 'PATCH',
    body: JSON.stringify({ note }),
  });
  return response.data;
}
