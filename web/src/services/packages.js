import { apiRequest } from './apiClient';

export async function fetchWorkerPackages(status = 'PENDING') {
  const response = await apiRequest(`/admin/packages?status=${encodeURIComponent(status)}`);
  return response.data;
}

export async function approveWorkerPackage(id, price) {
  const response = await apiRequest(`/admin/packages/${id}/approve`, {
    method: 'PATCH',
    body: JSON.stringify(price === undefined ? {} : { price }),
  });
  return response.data;
}

export async function rejectWorkerPackage(id, rejectionReason) {
  const response = await apiRequest(`/admin/packages/${id}/reject`, {
    method: 'PATCH',
    body: JSON.stringify({ rejectionReason }),
  });
  return response.data;
}
