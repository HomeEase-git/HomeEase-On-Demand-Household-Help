import { apiRequest } from './apiClient';

function buildQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });
  return query.toString();
}

export async function fetchBookings(params = {}) {
  const response = await apiRequest(`/admin/bookings?${buildQuery(params)}`);
  return { data: response.data, meta: response.meta };
}

export async function fetchBookingById(id) {
  const response = await apiRequest(`/admin/bookings/${id}`);
  return response.data;
}
