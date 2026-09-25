import { useCallback } from 'react'
import PageHeader from '../components/common/PageHeader'
import SubNav from '../components/common/SubNav'
import SectionCard from '../components/common/SectionCard'
import Badge from '../components/common/Badge'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import Pagination from '../components/common/Pagination'
import { fetchDisputes } from '../services/disputes'
import { useListQuery } from '../hooks/useListQuery'

const SUB_NAV = [
  { to: '/payments', label: 'All Transactions' },
  { to: '/payments/refunds', label: 'Refund History' },
  { to: '/payments/payouts', label: 'Payout Distribution' },
]

function formatPeso(amount) {
  return `₱${amount?.toLocaleString() ?? '0'}`
}

/**
 * Read-only refund log. There's no standalone "refund" action or REFUNDED
 * dispute status on the backend — a refund happens automatically as a side
 * effect of resolving a dispute with the CANCEL_BOOKING action (see
 * BookingDispute.jsx / adminDisputeController.resolveDispute), which
 * releases the held payment back to the client. This page just lists those
 * outcomes; to issue a refund, resolve the dispute from the Dispute
 * Resolution Center instead.
 */
export default function Refunds() {
  // Server-side filtered and paged (status=RESOLVED_CANCELLED sorts
  // newest-first, see listDisputes) — a client-side cap here would silently
  // drop older refunds once dispute volume outgrows a single fetched page.
  const fetchFn = useCallback(
    (params) => fetchDisputes({ status: 'RESOLVED_CANCELLED', page: params.page || 1, limit: 10 }),
    []
  )

  const {
    data: refunds,
    meta,
    loading,
    error,
    reload: loadRefunds,
    goToPage,
  } = useListQuery(fetchFn, { initialParams: { page: 1 } })

  return (
    <>
      <PageHeader title="Refund History" subtitle="Refunds issued via dispute cancellation" />
      <SubNav items={SUB_NAV} />
      <SectionCard>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
          Refunds happen automatically when a dispute is resolved with <strong>Cancel &amp; Refund</strong> in the{' '}
          <a href="#/bookings/dispute">Dispute Resolution Center</a>. This is a read-only log of those outcomes.
        </p>
        {loading && <LoadingState message="Loading refund history..." />}
        {error && <ErrorState message={error} onRetry={loadRefunds} />}
        {!loading && !error && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Booking</th>
                  <th>Client</th>
                  <th>Worker</th>
                  <th>Amount</th>
                  <th>Reason</th>
                  <th>Resolved</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {refunds.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="table-empty">
                      No refunds issued yet.
                    </td>
                  </tr>
                ) : (
                  refunds.map((r) => (
                    <tr key={r.id}>
                      <td>{r.displayId}</td>
                      <td>{r.client}</td>
                      <td>{r.worker}</td>
                      <td>{formatPeso(Number(String(r.amount).replace(/[^\d.-]/g, '')))}</td>
                      <td>{r.reason}</td>
                      <td>{r.resolvedAt ? new Date(r.resolvedAt).toLocaleDateString() : '—'}</td>
                      <td>
                        <Badge variant="approved">Refunded</Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !error && refunds.length > 0 && (
          <Pagination
            info={`Showing ${refunds.length} of ${meta.total} refunds`}
            hasPrev={meta.hasPrev}
            hasNext={meta.hasNext}
            onPrev={() => goToPage(meta.page - 1)}
            onNext={() => goToPage(meta.page + 1)}
          />
        )}
      </SectionCard>
    </>
  )
}
