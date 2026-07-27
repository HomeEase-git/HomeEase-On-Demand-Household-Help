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

export async function fetchPayments(params = {}) {
  const response = await apiRequest(`/admin/payments?${buildQuery(params)}`);
  return { data: response.data, meta: response.meta };
}

export async function fetchPaymentById(id) {
  const response = await apiRequest(`/admin/payments/${id}`);
  return response.data;
}
