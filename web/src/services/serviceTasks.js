import { apiRequest } from './apiClient';

export async function fetchTasks(serviceTypeId) {
  const response = await apiRequest(`/admin/service-types/${serviceTypeId}/tasks`);
  return response.data;
}

export async function createTask(serviceTypeId, payload) {
  const response = await apiRequest(`/admin/service-types/${serviceTypeId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function updateTask(serviceTypeId, taskId, payload) {
  const response = await apiRequest(`/admin/service-types/${serviceTypeId}/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function toggleTaskActive(serviceTypeId, taskId, isActive) {
  const response = await apiRequest(`/admin/service-types/${serviceTypeId}/tasks/${taskId}/toggle-active`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive }),
  });
  return response.data;
}
