import { apiRequest } from './apiClient';

// days: 7, 30 or 90 (the backend falls back to 7 for anything else).
export async function fetchDashboardStats(days = 7) {
  const response = await apiRequest(`/admin/dashboard/stats?days=${encodeURIComponent(days)}`);
  return response.data;
}

// month: "YYYY-MM" (Manila calendar month). Returns that month's bookings per
// day and per service category.
export async function fetchDashboardCharts(month) {
  const response = await apiRequest(`/admin/dashboard/charts?month=${encodeURIComponent(month)}`);
  return response.data;
}
