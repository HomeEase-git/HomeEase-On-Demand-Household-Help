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

export const DISPUTE_ACTIONS = ['APPROVE_QUOTE', 'REQUEST_NEW_QUOTE', 'CANCEL_BOOKING'];

export async function fetchDisputes(params = {}) {
  const response = await apiRequest(`/admin/disputes?${buildQuery(params)}`);
  return { data: response.data, meta: response.meta };
}

export async function fetchDisputeById(id) {
  const response = await apiRequest(`/admin/disputes/${id}`);
  return response.data;
}

/**
 * PATCH /admin/disputes/:id/resolve — action must be one of DISPUTE_ACTIONS.
 * `resolution` is the admin's audit note; the backend stores it on both the
 * Dispute row and (appended) the booking's disputeReason.
 */
export async function resolveDispute(id, action, resolution) {
  const response = await apiRequest(`/admin/disputes/${id}/resolve`, {
    method: 'PATCH',
    body: JSON.stringify({ action, resolution }),
  });
  return response.data;
}
