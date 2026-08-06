import { useEffect, useMemo, useState } from 'react'
import PageHeader from '../components/common/PageHeader'
import SearchBar from '../components/common/SearchBar'
import FilterTabs from '../components/common/FilterTabs'
import SectionCard from '../components/common/SectionCard'
import Pagination from '../components/common/Pagination'
import Badge from '../components/common/Badge'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { fetchDisputes, resolveDispute } from '../services/disputes'
import { useToast } from '../context/ToastContext'
import { usePolling } from '../hooks/usePolling'

const POLL_INTERVAL_MS = 5000

const STATUS_TABS = ['Open', 'Resolved']

const STATUS_BADGE_VARIANT = {
  OPEN: 'pending',
  UNDER_REVIEW: 'pending',
  RESOLVED_APPROVED: 'approved',
  RESOLVED_NEW_QUOTE_REQUESTED: 'approved',
  RESOLVED_CANCELLED: 'approved',
}

const ACTIONS = [
  {
    action: 'APPROVE_QUOTE',
    label: 'Approve Quote',
    className: 'btn btn-success',
    description: 'Proceeds the booking to QUOTE_APPROVED at the disputed price. The worker can complete the job as quoted.',
  },
  {
    action: 'REQUEST_NEW_QUOTE',
    label: 'Request New Quote',
    className: 'btn btn-outline',
    description: 'Sends the booking back to IN_PROGRESS so the worker can submit a revised quote.',
  },
  {
    action: 'CANCEL_BOOKING',
    label: 'Cancel & Refund',
    className: 'btn btn-danger',
    description: 'Cancels the booking and releases the held payment back to the client.',
  },
]

export default function BookingDispute() {
  const [disputes, setDisputes] = useState([])
  const [meta, setMeta] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [statusTab, setStatusTab] = useState('Open')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [pendingAction, setPendingAction] = useState(null) // { action, label, description } | null
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { showSuccess, showError } = useToast()

  const loadDisputes = async () => {
    setLoading(true)
    setError(null)

    try {
      // The backend filters on an exact status match; "Resolved" spans 3
      // possible values (RESOLVED_APPROVED/RESOLVED_NEW_QUOTE_REQUESTED/
      // RESOLVED_CANCELLED), so that tab fetches 'all' and filters client-side.
      const response = await fetchDisputes({
        search,
        page,
        limit: 20,
        status: statusTab === 'Open' ? 'OPEN' : 'all',
      })
      const rows = statusTab === 'Open' ? response.data : response.data.filter((d) => d.status.startsWith('RESOLVED'))
      setDisputes(rows)
      setMeta(response.meta)
    } catch (err) {
      setError(err.message || 'Failed to load disputes')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDisputes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusTab, page])

  useEffect(() => {
    setPage(1)
  }, [search, statusTab])

  // Keep the queue current for other admins working disputes concurrently —
  // paused while a dispute is open so a background refresh can't disrupt an
  // in-progress review/resolution.
  usePolling(loadDisputes, POLL_INTERVAL_MS, { paused: !!selectedId })

  const selected = useMemo(() => disputes.find((d) => d.id === selectedId) || null, [disputes, selectedId])

  const closeModal = () => {
    setSelectedId(null)
    setPendingAction(null)
    setNote('')
  }

  const openActionConfirm = (actionDef) => {
    setPendingAction(actionDef)
  }

  const submitResolution = async () => {
    if (!selected || !pendingAction) return
    if (!note.trim()) {
      showError('An audit note is required before resolving a dispute.')
      return
    }

    setSubmitting(true)
    try {
      await resolveDispute(selected.id, pendingAction.action, note.trim())
      setDisputes((prev) => (statusTab === 'Open' ? prev.filter((d) => d.id !== selected.id) : prev))
      showSuccess(`Dispute resolved: ${pendingAction.label}.`)
      closeModal()
    } catch (err) {
      showError(err.message || 'Failed to resolve dispute')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <PageHeader title="Dispute Resolution Center" subtitle="Review and resolve disputed bookings" />
      <div className="toolbar">
        <SearchBar placeholder="Search disputes..." value={search} onChange={setSearch} />
        <FilterTabs tabs={STATUS_TABS} activeTab={statusTab} onTabChange={setStatusTab} />
      </div>
      <SectionCard>
        {loading && <LoadingState message="Loading disputes..." />}
        {error && <ErrorState message={error} onRetry={loadDisputes} />}
        {!loading && !error && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Booking</th>
                  <th>Client</th>
                  <th>Worker</th>
                  <th>Reason</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {disputes.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      No {statusTab.toLowerCase()} disputes found.
                    </td>
                  </tr>
                ) : (
                  disputes.map((d) => (
                    <tr key={d.id}>
                      <td>{d.displayId}</td>
                      <td>{d.client}</td>
                      <td>{d.worker}</td>
                      <td>{d.reason}</td>
                      <td>{d.amount}</td>
                      <td>
                        <Badge variant={STATUS_BADGE_VARIANT[d.status] ?? 'pending'}>{d.status.replace(/_/g, ' ')}</Badge>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="action-btn view"
                            title="Review dispute"
                            aria-label={`Review dispute for booking ${d.displayId}`}
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
          info={`Showing ${disputes.length} of ${meta?.total ?? disputes.length} ${statusTab.toLowerCase()} dispute(s)`}
          hasPrev={(meta?.page ?? 1) > 1}
          hasNext={!!meta && meta.page < meta.totalPages}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => p + 1)}
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
            <h2 className="modal-title">Review Dispute — {selected.displayId}</h2>
            <p className="modal-body" style={{ marginBottom: '0.75rem' }}>
              <strong>Status:</strong> <Badge variant={STATUS_BADGE_VARIANT[selected.status] ?? 'pending'}>{selected.status.replace(/_/g, ' ')}</Badge>
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
              {selected.resolution && (
                <div className="detail-block detail-block--full">
                  <label>Resolution Note</label>
                  <div className="value">{selected.resolution}</div>
                </div>
              )}
            </div>

            {selected.status === 'OPEN' && !pendingAction && (
              <div className="modal-actions modal-actions--dispute" style={{ justifyContent: 'space-between' }}>
                <button type="button" className="btn btn-outline" onClick={closeModal}>
                  Close
                </button>
                <div className="modal-actions__group">
                  {ACTIONS.map((a) => (
                    <button key={a.action} type="button" className={a.className} onClick={() => openActionConfirm(a)}>
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selected.status === 'OPEN' && pendingAction && (
              <div style={{ marginTop: '1rem' }}>
                <p className="modal-body">{pendingAction.description}</p>
                <label htmlFor="dispute-note" style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
                  Admin audit note (required)
                </label>
                <textarea
                  id="dispute-note"
                  className="form-input"
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Explain why you're resolving this dispute this way..."
                  style={{ width: '100%', resize: 'vertical' }}
                />
                <div className="modal-actions" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
                  <button type="button" className="btn btn-outline" onClick={() => setPendingAction(null)} disabled={submitting}>
                    Back
                  </button>
                  <button type="button" className={pendingAction.className} onClick={submitResolution} disabled={submitting}>
                    {submitting ? 'Submitting...' : `Confirm: ${pendingAction.label}`}
                  </button>
                </div>
              </div>
            )}

            {selected.status !== 'OPEN' && (
              <div className="modal-actions" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-outline" onClick={closeModal}>
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
