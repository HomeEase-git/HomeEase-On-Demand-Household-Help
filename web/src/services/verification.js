import { apiRequest } from './apiClient';

export async function fetchVerifications({ status = 'PENDING', search = '' } = {}) {
  const params = new URLSearchParams({ status });
  if (search) params.set('search', search);
  const response = await apiRequest(`/admin/verifications?${params.toString()}`);
  return response.data;
}

export async function fetchVerificationById(id) {
  const response = await apiRequest(`/admin/verifications/${id}`);
  return response.data;
}

// yearsExperience (workers): the admin confirms or corrects the worker's
// declared years against the resume — it's an expertise-tier requirement.
export async function approveVerification(id, adminOverrideReason = '', yearsExperience = undefined) {
  const response = await apiRequest(`/admin/verifications/${id}/approve`, {
    method: 'PATCH',
    body: JSON.stringify({
      adminOverrideReason,
      ...(yearsExperience !== undefined ? { yearsExperience } : {}),
    }),
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

export async function approveDocument(verificationId, documentId) {
  const response = await apiRequest(`/admin/verifications/${verificationId}/documents/${documentId}/approve`, {
    method: 'PATCH',
  });
  return response.data;
}

export async function rejectDocument(verificationId, documentId, rejectReason) {
  const response = await apiRequest(`/admin/verifications/${verificationId}/documents/${documentId}/reject`, {
    method: 'PATCH',
    body: JSON.stringify({ rejectReason }),
  });
  return response.data;
}
