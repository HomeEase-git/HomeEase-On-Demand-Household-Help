import { apiRequest } from './apiClient';

export async function fetchServiceTypes() {
  const response = await apiRequest('/admin/service-types');
  return response.data;
}

export async function createServiceType(payload) {
  const response = await apiRequest('/admin/service-types', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function updateServiceType(id, payload) {
  const response = await apiRequest(`/admin/service-types/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function toggleServiceTypeActive(id, isActive) {
  const response = await apiRequest(`/admin/service-types/${id}/toggle-active`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive }),
  });
  return response.data;
}

// Whole-category save from the job order editor (details + jobs + each job's
// questions). id = null creates a new category.
export async function saveServiceCatalog(id, payload) {
  const response = await apiRequest(id ? `/admin/service-types/${id}/catalog` : '/admin/service-types/catalog', {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}
