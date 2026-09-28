import { apiRequest } from './apiClient';

export async function fetchLedgerStatus() {
  const response = await apiRequest('/admin/ledger/status');
  return response.data;
}

export async function openLedger() {
  const response = await apiRequest('/admin/ledger/open', { method: 'POST' });
  return response.data;
}

export async function syncXenditFees() {
  const response = await apiRequest('/admin/ledger/sync-fees', { method: 'POST' });
  return response.data;
}

export async function fetchReconciliation(month) {
  const response = await apiRequest(`/admin/ledger/reconciliation?month=${encodeURIComponent(month)}`);
  return response.data;
}

export async function signOffMonth(month, note) {
  const response = await apiRequest('/admin/ledger/reconciliation', {
    method: 'POST',
    body: JSON.stringify({ month, note }),
  });
  return response.data;
}

export async function fetchLedgerTransactions(month, page = 1) {
  const response = await apiRequest(`/admin/ledger/transactions?month=${encodeURIComponent(month)}&page=${page}&limit=20`);
  return { data: response.data, meta: response.meta };
}
