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

export async function fetchTaxCertificates(params = {}) {
  const response = await apiRequest(`/admin/tax/certificates?${buildQuery(params)}`);
  return { data: response.data, meta: response.meta };
}

export async function generateTaxCertificates(periodStart, periodEnd) {
  const response = await apiRequest('/admin/tax/certificates/generate', {
    method: 'POST',
    body: JSON.stringify({ periodStart, periodEnd }),
  });
  return response.data;
}

export async function getCertificateDownloadUrl(id) {
  const response = await apiRequest(`/admin/tax/certificates/${id}/download`);
  return response.data.downloadUrl;
}
