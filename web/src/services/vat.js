import { apiRequest } from './apiClient';

export async function fetchVatRegistrations(status = 'PENDING') {
  const response = await apiRequest(`/admin/vat-registrations?status=${encodeURIComponent(status)}`);
  return response.data;
}

export async function approveVatRegistration(workerId) {
  const response = await apiRequest(`/admin/vat-registrations/${workerId}/approve`, { method: 'PATCH' });
  return response.data;
}

export async function rejectVatRegistration(workerId, rejectionReason) {
  const response = await apiRequest(`/admin/vat-registrations/${workerId}/reject`, {
    method: 'PATCH',
    body: JSON.stringify({ rejectionReason }),
  });
  return response.data;
}

export async function fetchVatSummaries(params = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', params.page);
  if (params.limit) query.set('limit', params.limit);
  const response = await apiRequest(`/admin/tax/vat-summary?${query.toString()}`);
  return { data: response.data, meta: response.meta };
}

export async function generateVatSummary(periodStart, periodEnd) {
  const response = await apiRequest('/admin/tax/vat-summary/generate', {
    method: 'POST',
    body: JSON.stringify({ periodStart, periodEnd }),
  });
  return response.data;
}
