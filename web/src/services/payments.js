import { apiRequest, getStoredToken } from './apiClient';

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

export async function fetchPayouts(params = {}) {
  const response = await apiRequest(`/admin/payments/payouts?${buildQuery(params)}`);
  return { data: response.data, meta: response.meta };
}

export async function retryPayout(id) {
  const response = await apiRequest(`/admin/payments/payouts/${id}/retry`, { method: 'PATCH' });
  return response.data;
}

/** Downloads the CSV via a raw fetch (apiRequest always parses JSON) and saves it client-side. */
export async function downloadPayoutsCsv(params = {}) {
  const baseUrl = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
  const token = getStoredToken();

  const response = await fetch(`${baseUrl}/admin/payments/payouts/export?${buildQuery(params)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error(`Export failed (${response.status})`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `payouts-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
