import { apiRequest } from './apiClient';

export async function fetchPromoBanners() {
  const response = await apiRequest('/admin/promo-banners');
  return response.data;
}

export async function createPromoBanner(payload) {
  const response = await apiRequest('/admin/promo-banners', { method: 'POST', body: JSON.stringify(payload) });
  return response.data;
}

export async function updatePromoBanner(id, payload) {
  const response = await apiRequest(`/admin/promo-banners/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  return response.data;
}

export async function deletePromoBanner(id) {
  await apiRequest(`/admin/promo-banners/${id}`, { method: 'DELETE' });
}

// ids in the order they should appear in the app.
export async function reorderPromoBanners(ids) {
  await apiRequest('/admin/promo-banners/order', { method: 'PUT', body: JSON.stringify({ ids }) });
}

// Returns the public URL to store on a banner.
export async function uploadPromoBannerImage(file) {
  const body = new FormData();
  body.append('image', file);
  const response = await apiRequest('/admin/promo-banners/upload-image', { method: 'POST', body });
  return response.data.url;
}
