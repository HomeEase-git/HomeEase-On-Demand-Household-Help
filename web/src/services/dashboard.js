import { apiRequest } from './apiClient';

export async function fetchDashboardStats(days = 7) {
  const response = await apiRequest(`/admin/dashboard/stats?days=${encodeURIComponent(days)}`);
  return response.data;
}

export async function fetchDashboardCharts(month) {
  const response = await apiRequest(`/admin/dashboard/charts?month=${encodeURIComponent(month)}`);
  return response.data;
}
