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

/** PATCH /admin/bookings/:id/cancel — force-cancels a booking in any non-terminal state. */
export async function cancelBookingAdmin(id, reason) {
  const response = await apiRequest(`/admin/bookings/${id}/cancel`, {
    method: 'PATCH',
    body: JSON.stringify({ reason }),
  });
  return response.data;
}
