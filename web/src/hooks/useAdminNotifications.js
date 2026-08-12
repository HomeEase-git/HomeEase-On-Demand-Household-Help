import { useCallback, useEffect, useState } from 'react'
import { fetchVerifications } from '../services/verification'
import { fetchDisputes } from '../services/disputes'
import { fetchReviews } from '../services/reviews'
import { fetchPayouts } from '../services/payments'
import { usePolling } from './usePolling'

const POLL_INTERVAL_MS = 30000

// Each source is a pending-action queue that already exists elsewhere in the
// admin app; this just surfaces how many items are waiting and where to go
// resolve them, instead of the header's old hardcoded badge count.
const SOURCES = [
  {
    key: 'verifications',
    label: 'Pending verifications',
    to: '/verification',
    icon: 'fa-id-card',
    load: () => fetchVerifications({ status: 'PENDING', type: 'all' }).then((data) => data.length),
  },
  {
    key: 'disputes',
    label: 'Open disputes',
    to: '/bookings/dispute',
    icon: 'fa-triangle-exclamation',
    load: () => fetchDisputes({ status: 'OPEN', page: 1, limit: 1 }).then((r) => r.meta?.total || 0),
  },
  {
    key: 'flaggedReviews',
    label: 'Flagged reviews',
    to: '/reviews/flagged',
    icon: 'fa-flag',
    load: () => fetchReviews({ flagged: 'true', page: 1, limit: 1 }).then((r) => r.meta?.total || 0),
  },
  {
    key: 'failedPayouts',
    label: 'Failed payouts',
    to: '/payments/payouts',
    icon: 'fa-money-bill-transfer',
    load: () => fetchPayouts({ status: 'failed', page: 1, limit: 1 }).then((r) => r.meta?.total || 0),
  },
]

export function useAdminNotifications() {
  const [counts, setCounts] = useState({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const results = await Promise.allSettled(SOURCES.map((source) => source.load()))
    setCounts((prev) => {
      const next = { ...prev }
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') next[SOURCES[i].key] = result.value
      })
      return next
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  usePolling(load, POLL_INTERVAL_MS)

  const items = SOURCES.map((source) => ({
    key: source.key,
    label: source.label,
    to: source.to,
    icon: source.icon,
    count: counts[source.key] || 0,
  })).filter((item) => item.count > 0)

  const total = items.reduce((sum, item) => sum + item.count, 0)

  return { items, total, loading, reload: load }
}
