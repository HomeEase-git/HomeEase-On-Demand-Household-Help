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
