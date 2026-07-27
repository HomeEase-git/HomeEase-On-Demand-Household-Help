import { apiRequest } from './apiClient';

export async function fetchDashboardStats() {
  const response = await apiRequest('/admin/dashboard/stats');
  return response.data;
}
