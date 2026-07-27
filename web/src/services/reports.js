import { apiRequest } from './apiClient';

export async function fetchServiceReport() {
  const response = await apiRequest('/admin/reports/service');
  return response.data;
}

export async function fetchActivityReport() {
  const response = await apiRequest('/admin/reports/activity');
  return response.data;
}
