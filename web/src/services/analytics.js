import { apiRequest } from './apiClient';

export async function fetchAnalytics() {
  const response = await apiRequest('/admin/analytics');
  return response.data;
}
