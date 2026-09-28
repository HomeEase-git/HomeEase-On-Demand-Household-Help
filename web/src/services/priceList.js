import { apiRequest } from './apiClient';

// Every category's starting price and every job's price, plus the DOLE
// hourly floor the save checks against.
export async function fetchPriceList() {
  const response = await apiRequest('/admin/price-list');
  return response.data;
}

// { tasks: [{ id, basePrice }], categories: [{ id, basePrice }], overrideReason }
export async function savePriceList(payload) {
  const response = await apiRequest('/admin/price-list', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return response.data;
}
