import { apiRequest } from './apiClient';

export async function fetchPriceList() {
  const response = await apiRequest('/admin/price-list');
  return response.data;
}

export async function savePriceList(payload) {
  const response = await apiRequest('/admin/price-list', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return response.data;
}
