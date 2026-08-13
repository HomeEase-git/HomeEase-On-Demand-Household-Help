import { useEffect, useMemo, useState } from 'react'
import PageHeader from '../components/common/PageHeader'
import SubNav from '../components/common/SubNav'
import SectionCard from '../components/common/SectionCard'
import Badge from '../components/common/Badge'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import Pagination from '../components/common/Pagination'
import { fetchDisputes } from '../services/disputes'

const SUB_NAV = [
  { to: '/payments', label: 'All Transactions' },
  { to: '/payments/refunds', label: 'Refund History' },
  { to: '/payments/payouts', label: 'Payout Distribution' },
]

const PAGE_SIZE = 10

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
  const [refunds, setRefunds] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [page, setPage] = useState(1)

  const loadRefunds = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetchDisputes({ status: 'all', page: 1, limit: 50 })
      setRefunds(response.data.filter((d) => d.status === 'RESOLVED_CANCELLED'))
    } catch (err) {
      setError(err.message || 'Failed to load refund history')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRefunds()
  }, [])

  const totalPages = Math.max(1, Math.ceil(refunds.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pagedRefunds = useMemo(
    () => refunds.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [refunds, currentPage]
  )

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
                    <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      No refunds issued yet.
                    </td>
                  </tr>
                ) : (
                  pagedRefunds.map((r) => (
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
            info={`Showing ${pagedRefunds.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0}-${
              (currentPage - 1) * PAGE_SIZE + pagedRefunds.length
            } of ${refunds.length} refunds`}
            hasPrev={currentPage > 1}
            hasNext={currentPage < totalPages}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
          />
        )}
      </SectionCard>
    </>
  )
}
