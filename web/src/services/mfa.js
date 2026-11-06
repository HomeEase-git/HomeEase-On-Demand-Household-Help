import { apiRequest } from './apiClient';

export async function startMfaSetup() {
  const response = await apiRequest('/auth/mfa/setup', { method: 'POST' });
  return response.data;
}

export async function confirmMfaSetup(code) {
  const response = await apiRequest('/auth/mfa/verify-setup', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  return response.data;
}

export async function disableMfa(password, code) {
  const response = await apiRequest('/auth/mfa/disable', {
    method: 'POST',
    body: JSON.stringify({ password, code }),
  });
  return response.data;
}
