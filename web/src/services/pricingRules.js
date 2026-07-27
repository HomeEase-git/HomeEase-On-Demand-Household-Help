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

export async function fetchPricingRules(params = {}) {
  const response = await apiRequest(`/admin/pricing-rules?${buildQuery(params)}`);
  return response.data;
}

export async function createPricingRule(payload) {
  const response = await apiRequest('/admin/pricing-rules', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function updatePricingRule(id, payload) {
  const response = await apiRequest(`/admin/pricing-rules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function deletePricingRule(id) {
  const response = await apiRequest(`/admin/pricing-rules/${id}`, {
    method: 'DELETE',
  });
  return response.data;
}
