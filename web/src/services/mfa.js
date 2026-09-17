import { apiRequest } from './apiClient';

// Starts (or restarts) MFA enrollment for the current admin. Returns a
// provisioning URI, a ready-to-render QR code data URL, and the raw secret
// (manual-entry fallback) — nothing is enabled yet until confirmSetup below.
export async function startMfaSetup() {
  const response = await apiRequest('/auth/mfa/setup', { method: 'POST' });
  return response.data;
}

// Confirms enrollment with a 6-digit code from the authenticator app.
// Returns the one-time list of backup codes — shown once, never retrievable
// again.
export async function confirmMfaSetup(code) {
  const response = await apiRequest('/auth/mfa/verify-setup', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  return response.data;
}

// Turns MFA off. Requires the current password plus a valid TOTP/backup
// code — being logged in alone isn't enough for a change this sensitive.
export async function disableMfa(password, code) {
  const response = await apiRequest('/auth/mfa/disable', {
    method: 'POST',
    body: JSON.stringify({ password, code }),
  });
  return response.data;
}
