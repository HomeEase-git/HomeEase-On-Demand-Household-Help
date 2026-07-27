import { apiRequest } from './apiClient';

export async function fetchVerifications({ status = 'PENDING', type = 'all', search = '' } = {}) {
  const params = new URLSearchParams({ status, type });
  if (search) params.set('search', search);
  const response = await apiRequest(`/admin/verifications?${params.toString()}`);
  return response.data;
}

export async function fetchVerificationById(id) {
  const response = await apiRequest(`/admin/verifications/${id}`);
  return response.data;
}

export async function approveVerification(id, adminOverrideReason = '') {
  const response = await apiRequest(`/admin/verifications/${id}/approve`, {
    method: 'PATCH',
    body: JSON.stringify({ adminOverrideReason }),
  });
  return response.data;
}

export async function rejectVerification(id, rejectReason) {
  const response = await apiRequest(`/admin/verifications/${id}/reject`, {
    method: 'PATCH',
    body: JSON.stringify({ rejectReason }),
  });
  return response.data;
}

export async function rerunVerification(id) {
  const response = await apiRequest(`/admin/verifications/${id}/rerun`, {
    method: 'PATCH',
  });
  return response.data;
}
