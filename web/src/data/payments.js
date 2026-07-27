export const TRANSACTIONS = [
  {
    id: 'T301',
    displayId: '#T301',
    booking: '#B201',
    user: 'Maria Santos',
    worker: 'Juan Dela Cruz',
    userAmount: 500,
    workerAmount: 425,
    platformFee: 75,
    method: 'GCash',
    date: 'Mar 1, 2025',
    status: 'Completed',
  },
  {
    id: 'T300',
    displayId: '#T300',
    booking: '#B200',
    user: 'Ana Reyes',
    worker: 'Pedro Garcia',
    userAmount: 620,
    workerAmount: 527,
    platformFee: 93,
    method: 'Cash',
    date: 'Mar 1, 2025',
    status: 'Pending',
  },
]

export function getTransactionById(id) {
  return TRANSACTIONS.find((t) => t.id === id) || null
}

export function formatPeso(amount) {
  return `₱${amount.toLocaleString()}`
}

