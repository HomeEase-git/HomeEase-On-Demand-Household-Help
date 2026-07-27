import { useEffect, useState } from 'react'
import PageHeader from '../components/common/PageHeader'
import SubNav from '../components/common/SubNav'
import SectionCard from '../components/common/SectionCard'
import Badge from '../components/common/Badge'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { fetchDisputes, updateDispute } from '../services/disputes'

const SUB_NAV = [
  { to: '/payments', label: 'All Transactions' },
  { to: '/payments/refunds', label: 'Refund Management' },
]

function formatPeso(amount) {
  return `₱${amount?.toLocaleString() ?? '0'}`
}

export default function Refunds() {
  const [refunds, setRefunds] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadRefunds = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetchDisputes({ status: 'open', page: 1, limit: 50 })
      setRefunds(response.data)
    } catch (err) {
      setError(err.message || 'Failed to load refunds')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRefunds()
  }, [])

  const startProcess = (r) => {
    setSelected(r)
  }

  const closeModal = () => setSelected(null)

  const confirmRefund = async () => {
    if (!selected) return

    try {
      const updated = await updateDispute(selected.id, {
        status: 'REFUNDED',
        resolution: 'Refund processed by admin',
      })
      setRefunds((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
      setSelected(null)
    } catch (err) {
      setError(err.message || 'Failed to confirm refund')
    }
  }

  return (
    <>
      <PageHeader title="Refund Management" subtitle="Process and track refunds" />
      <SubNav items={SUB_NAV} />
      <SectionCard>
        {loading && <LoadingState message="Loading refunds..." />}
        {error && <ErrorState message={error} onRetry={loadRefunds} />}
        {!loading && !error && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Refund ID</th>
                  <th>Booking</th>
                  <th>Client</th>
                  <th>Worker</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {refunds.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      No refund disputes found.
                    </td>
                  </tr>
                ) : (
                  refunds.map((r) => (
                    <tr key={r.id}>
                      <td>{r.displayId}</td>
                      <td>{r.booking}</td>
                      <td>{r.client}</td>
                      <td>{r.worker}</td>
                      <td>{formatPeso(r.amount)}</td>
                      <td>
                        <Badge variant={r.status === 'REFUNDED' ? 'approved' : 'pending'}>
                          {r.status}
                        </Badge>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-success"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.8125rem' }}
                          disabled={r.status === 'REFUNDED'}
                          onClick={() => startProcess(r)}
                        >
                          {r.status === 'REFUNDED' ? 'Refunded' : 'Process'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {selected && (
        <div className="modal-backdrop" onClick={closeModal} role="presentation">
          <div
            className="modal modal--landscape"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2 className="modal-title">Process Refund {selected.displayId}</h2>
            <p className="modal-body" style={{ marginBottom: '0.75rem' }}>
              This refund was requested for booking <strong>{selected.booking}</strong>.
            </p>
            <div className="modal-detail-grid--2col">
              <div className="detail-block">
                <label>Client</label>
                <div className="value">{selected.client}</div>
              </div>
              <div className="detail-block">
                <label>Worker</label>
                <div className="value">{selected.worker}</div>
              </div>
              <div className="detail-block">
                <label>Booking Amount</label>
                <div className="value">{formatPeso(selected.amount)}</div>
              </div>
              <div className="detail-block detail-block--full">
                <label>Dispute Reason</label>
                <div className="value">{selected.reason}</div>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={closeModal}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={confirmRefund}>
                Confirm Refund
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
