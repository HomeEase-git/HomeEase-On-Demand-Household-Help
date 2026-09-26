import { apiRequest } from './apiClient';

// Worker requests to offer another service, with the documents they attached.
export async function fetchServiceRequests(status = 'PENDING_VERIFICATION') {
  const response = await apiRequest(`/admin/service-requests?status=${encodeURIComponent(status)}`);
  return response.data;
}

export async function approveServiceRequest(id) {
  const response = await apiRequest(`/admin/service-requests/${id}/approve`, { method: 'PATCH' });
  return response.data;
}

export async function rejectServiceRequest(id, rejectionReason) {
  const response = await apiRequest(`/admin/service-requests/${id}/reject`, {
    method: 'PATCH',
    body: JSON.stringify({ rejectionReason }),
  });
  return response.data;
}
