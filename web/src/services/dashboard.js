import { apiRequest } from './apiClient';

// days: 7, 30 or 90 (the backend falls back to 7 for anything else).
export async function fetchDashboardStats(days = 7) {
  const response = await apiRequest(`/admin/dashboard/stats?days=${encodeURIComponent(days)}`);
  return response.data;
}
