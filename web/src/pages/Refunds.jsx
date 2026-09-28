import { useCallback, useState } from 'react'
import PageHeader from '../components/common/PageHeader'
import SubNav from '../components/common/SubNav'
import { PAYMENTS_SUB_NAV } from '../constants/paymentsNav'
import SectionCard from '../components/common/SectionCard'
import Badge from '../components/common/Badge'
import FilterTabs from '../components/common/FilterTabs'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import Pagination from '../components/common/Pagination'
import { fetchRefundRequests, decideRefundRequest } from '../services/payments'
import { useListQuery } from '../hooks/useListQuery'
import { useToast } from '../context/ToastContext'

// Tab label -> RefundRequest statuses it shows.
const TABS = {
  'Awaiting decision': 'PENDING,FAILED',
  Approved: 'APPROVED',
  'Refunded manually': 'REFUNDED_MANUALLY',
  Rejected: 'REJECTED',
  All: '',
}

const STATUS_BADGE = {
  PENDING: { variant: 'pending', label: 'Awaiting approval' },
  FAILED: { variant: 'flagged', label: 'Refund failed' },
  APPROVED: { variant: 'approved', label: 'Approved' },
  REFUNDED_MANUALLY: { variant: 'active', label: 'Refunded manually' },
  REJECTED: { variant: 'suspended', label: 'Rejected' },
}

const SOURCE_LABELS = {
  BOOKING_CANCELLED: 'Booking cancelled',
  ADMIN_CANCEL: 'Admin cancel',
  DISPUTE_RESOLUTION: 'Dispute',
}

// What each decision does, shown in the confirm dialog.
const ACTIONS = {
  approve: {
    title: 'Approve refund',
    button: 'Approve & send refund',
    className: 'btn btn-success',
    noteRequired: false,
    explain: 'Sends the money back to the client through Xendit. If the worker has not been paid yet, their payout is stopped.',
  },
  manual: {
    title: 'Record a manual refund',
    button: 'Mark refunded manually',
    className: 'btn btn-primary',
    noteRequired: true,
    explain:
      'Use this when you refunded the client outside the app — usually because the worker was already paid. ' +
      'Nothing is sent through Xendit. To collect the money back from the worker, use Adjust Dues on their page.',
  },
  reject: {
    title: 'Reject refund',
    button: 'Reject',
    className: 'btn btn-danger',
    noteRequired: true,
    explain: 'No money moves. The client is told the refund was not approved, with your note.',
  },
}

function formatPeso(amount) {
  return `₱${Number(amount ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Refund approval queue. Refunds of paid bookings never happen on their own —
 * cancellations, admin force-cancels and disputes resolved with Cancel &
 * Refund all land here, and an admin approves, rejects, or records the refund
 * as done manually.
 */
export default function Refunds() {
  const { showSuccess, showError } = useToast()
  const [pending, setPending] = useState(null) // { request, action }
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const fetchFn = useCallback(
    (params) => fetchRefundRequests({ status: TABS[params.tab], page: params.page || 1, limit: 10 }),
    []
  )
  const {
    data: requests,
    meta,
    params,
    loading,
    error,
    reload,
    goToPage,
    setFilter,
  } = useListQuery(fetchFn, { initialParams: { page: 1, tab: 'Awaiting decision' } })

  const openAction = (request, action) => {
    setPending({ request, action })
    setNote('')
  }

  const submit = async () => {
    const config = ACTIONS[pending.action]
    if (config.noteRequired && !note.trim()) {
      showError('Please add a note explaining this decision.')
      return
    }
    setSubmitting(true)
    try {
      const result = await decideRefundRequest(pending.request.id, pending.action, note.trim())
      if (result.status === 'FAILED') {
        showError(`The refund could not be sent: ${result.failureReason || 'unknown error'}`)
      } else {
        showSuccess(`${config.title}: done.`)
      }
      setPending(null)
      reload()
    } catch (err) {
      showError(err.message || 'Could not save the decision')
    } finally {
      setSubmitting(false)
    }
  }

  const awaiting = meta?.awaitingDecision ?? 0

  return (
    <>
      <PageHeader
        title="Refunds"
        subtitle={awaiting > 0 ? `${awaiting} waiting for a decision` : 'Every refund of a paid booking needs admin approval'}
      />
      <SubNav items={PAYMENTS_SUB_NAV} />
      <SectionCard>
        <FilterTabs tabs={Object.keys(TABS)} activeTab={params.tab} onTabChange={(tab) => setFilter('tab', tab)} />
        {loading && <LoadingState message="Loading refunds..." />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Booking</th>
                  <th>Client</th>
                  <th>Worker</th>
                  <th>Amount</th>
                  <th>From</th>
                  <th>Reason</th>
                  <th>Requested</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {requests.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="table-empty">
                      No refunds here.
                    </td>
                  </tr>
                ) : (
                  requests.map((r) => {
                    const badge = STATUS_BADGE[r.status] ?? { variant: 'pending', label: r.status }
                    const decidable = r.status === 'PENDING' || r.status === 'FAILED'
                    return (
                      <tr key={r.id}>
                        <td>
                          <a href={`#/bookings/${r.bookingId}`}>{r.booking}</a>
                        </td>
                        <td>{r.client}</td>
                        <td>{r.worker}</td>
                        <td>{formatPeso(r.amount)}</td>
                        <td>{SOURCE_LABELS[r.source] ?? r.source}</td>
                        <td>{r.reason}</td>
                        <td>{new Date(r.createdAt).toLocaleDateString()}</td>
                        <td>
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                          {r.payoutStatus === 'PAID' && decidable && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                              Worker already paid
                            </div>
                          )}
                          {r.status === 'FAILED' && r.failureReason && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: '0.25rem' }}>{r.failureReason}</div>
                          )}
                          {!decidable && r.decisionNote && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{r.decisionNote}</div>
                          )}
                        </td>
                        <td>
                          {decidable && (
                            <div className="row-actions">
                              <button type="button" className="btn btn-success" onClick={() => openAction(r, 'approve')}>
                                {r.status === 'FAILED' ? 'Retry' : 'Approve'}
                              </button>
                              <button type="button" className="btn btn-outline" onClick={() => openAction(r, 'manual')}>
                                Manual
                              </button>
                              <button type="button" className="btn btn-outline" onClick={() => openAction(r, 'reject')}>
                                Reject
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !error && requests.length > 0 && (
          <Pagination
            info={`Showing ${requests.length} of ${meta.total} refunds`}
            hasPrev={meta.hasPrev}
            hasNext={meta.hasNext}
            onPrev={() => goToPage(meta.page - 1)}
            onNext={() => goToPage(meta.page + 1)}
          />
        )}
      </SectionCard>

      {pending && (
        <div className="modal-backdrop" onClick={() => !submitting && setPending(null)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">{ACTIONS[pending.action].title}</h2>
            <p className="modal-body">
              <strong>{formatPeso(pending.request.amount)}</strong> for booking {pending.request.booking} ({pending.request.client}).
            </p>
            <p className="modal-body" style={{ color: 'var(--text-muted)' }}>
              {ACTIONS[pending.action].explain}
            </p>
            <label className="form-label form-label--spaced" htmlFor="refund-note">
              Note{ACTIONS[pending.action].noteRequired ? ' (required)' : ' (optional)'}
            </label>
            <textarea
              id="refund-note"
              className="form-input field-full field-textarea"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={pending.action === 'manual' ? 'e.g. Sent ₱1,000 to the client via GCash on Sept 28' : ''}
            />
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" disabled={submitting} onClick={() => setPending(null)}>
                Cancel
              </button>
              <button type="button" className={ACTIONS[pending.action].className} disabled={submitting} onClick={submit}>
                {submitting ? 'Saving...' : ACTIONS[pending.action].button}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
