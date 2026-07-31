import { useEffect, useMemo, useState } from 'react'
import PageHeader from '../components/common/PageHeader'
import SubNav from '../components/common/SubNav'
import SearchBar from '../components/common/SearchBar'
import SectionCard from '../components/common/SectionCard'
import Pagination from '../components/common/Pagination'
import Badge from '../components/common/Badge'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { fetchDisputes, updateDispute } from '../services/disputes'
import { useToast } from '../context/ToastContext'

const SUB_NAV = [
  { to: '/bookings', label: 'All Bookings' },
  { to: '/bookings/dispute', label: 'Booking Dispute' },
]

export default function BookingDispute() {
  const [disputes, setDisputes] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const { showSuccess, showError } = useToast()

  const loadDisputes = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetchDisputes({ search, page: 1, limit: 50 })
      setDisputes(response.data)
    } catch (err) {
      setError(err.message || 'Failed to load disputes')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDisputes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const selected = useMemo(() => disputes.find((d) => d.id === selectedId) || null, [disputes, selectedId])

  const closeModal = () => setSelectedId(null)

  const RESOLUTION_LABELS = {
    CANCELLED: 'Booking cancelled.',
    REFUNDED: 'Payment refunded.',
    QUOTE_APPROVED: 'Dispute marked resolved.',
  }

  const resolveDispute = async (status) => {
    if (!selected) return

    try {
      const updated = await updateDispute(selected.id, {
        status,
        resolution: `Resolved by admin: ${status}`,
      })
      setDisputes((prev) => prev.filter((d) => d.id !== updated.id))
      setSelectedId(null)
      showSuccess(RESOLUTION_LABELS[status] || 'Dispute updated.')
    } catch (err) {
      showError(err.message || 'Failed to update dispute')
    }
  }

  return (
    <>
      <PageHeader title="Booking Management" subtitle="Booking disputes" />
      <SubNav items={SUB_NAV} />
      <div className="toolbar">
        <SearchBar placeholder="Search disputes..." value={search} onChange={setSearch} />
      </div>
      <SectionCard>
        {loading && <LoadingState message="Loading disputes..." />}
        {error && <ErrorState message={error} onRetry={loadDisputes} />}
        {!loading && !error && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Dispute ID</th>
                  <th>Booking</th>
                  <th>Client</th>
                  <th>Worker</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {disputes.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      No open disputes found.
                    </td>
                  </tr>
                ) : (
                  disputes.map((d) => (
                    <tr key={d.id}>
                      <td>{d.displayId}</td>
                      <td>{d.booking}</td>
                      <td>{d.client}</td>
                      <td>{d.worker}</td>
                      <td>{d.reason}</td>
                      <td>
                        <Badge variant="pending">{d.status}</Badge>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="action-btn view"
                            title="Review dispute"
                            aria-label={`Review dispute ${d.displayId}`}
                            onClick={() => setSelectedId(d.id)}
                          >
                            <i className="fas fa-eye" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          info={`Showing ${disputes.length} open dispute${disputes.length === 1 ? '' : 's'}`}
          hasPrev={false}
          hasNext={false}
        />
      </SectionCard>

      {selected && (
        <div className="modal-backdrop" onClick={closeModal} role="presentation">
          <div
            className="modal modal--landscape"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2 className="modal-title">Review Dispute {selected.displayId}</h2>
            <p className="modal-body" style={{ marginBottom: '0.75rem' }}>
              <strong>Booking:</strong> {selected.booking} &nbsp;·&nbsp; <strong>Status:</strong>{' '}
              <Badge variant="pending">{selected.status}</Badge>
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
                <label>Amount</label>
                <div className="value">{selected.amount}</div>
              </div>
              <div className="detail-block detail-block--full">
                <label>Dispute Reason</label>
                <div className="value">{selected.reason}</div>
              </div>
            </div>

            <div className="modal-actions modal-actions--dispute" style={{ justifyContent: 'space-between' }}>
              <button type="button" className="btn btn-outline" onClick={closeModal}>
                Close
              </button>
              <div className="modal-actions__group">
                <button type="button" className="btn btn-outline" onClick={() => resolveDispute('CANCELLED')}>
                  Cancel Booking
                </button>
                <button type="button" className="btn btn-purple" onClick={() => resolveDispute('REFUNDED')}>
                  Refund Payment
                </button>
                <button type="button" className="btn btn-success" onClick={() => resolveDispute('QUOTE_APPROVED')}>
                  Mark Resolved
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
