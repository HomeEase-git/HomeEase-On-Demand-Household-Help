import { apiRequest } from './apiClient';

export async function fetchSettings() {
  const response = await apiRequest('/admin/settings');
  return response.data;
}

export async function updateSettings(payload) {
  const response = await apiRequest('/admin/settings', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return response.data;
}
