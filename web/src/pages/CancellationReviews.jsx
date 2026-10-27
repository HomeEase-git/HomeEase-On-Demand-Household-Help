import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SubNav from '../components/common/SubNav'
import { BOOKINGS_SUB_NAV } from '../constants/bookingsSubNav'
import FilterTabs from '../components/common/FilterTabs'
import SectionCard from '../components/common/SectionCard'
import Badge from '../components/common/Badge'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { fetchCancellationReviews, reviewCancellation } from '../services/cancellations'
import { downloadCsv } from '../utils/csvExport'
import { csvDateStamp } from '../utils/exportList'
import { downloadPdf } from '../utils/exportPdf'
import ExportMenu from '../components/common/ExportMenu'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { useListQuery } from '../hooks/useListQuery'

const POLL_INTERVAL_MS = 15000

// Tab label -> the backend's ?status= value.
const STATUS_TABS = { Pending: 'PENDING_REVIEW', Approved: 'APPROVED', Rejected: 'REJECTED', All: 'ALL' }

const STATUS_BADGE = {
  PENDING_REVIEW: { variant: 'pending', label: 'Pending review' },
  APPROVED: { variant: 'approved', label: 'Client at fault' },
  REJECTED: { variant: 'flagged', label: 'Worker at fault' },
}

const DECISIONS = {
  APPROVE: {
    label: 'Client at fault',
    className: 'btn btn-success',
    description:
      "The proof shows the client caused the cancellation. The client is charged the cancellation fee (their new bookings are paused until it's paid) and the worker receives it as compensation.",
  },
  REJECT: {
    label: 'Worker at fault',
    className: 'btn btn-danger',
    description:
      "The proof doesn't show it was the client's fault. It's treated as the worker's fault and the no-show penalty is added to their dues.",
  },
}

function formatWhen(dateIso, time) {
  if (!dateIso) return '—'
  const date = new Date(dateIso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  if (!time) return date
  const [h, m] = time.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  return `${date}, ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`
}

function formatPeso(amount) {
  return !amount ? 'No fee' : `₱${Number(amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
}

/**
 * On-site cancellations: a worker who cancels after checking in must attach
 * photo proof and say whose fault it was. When they blame the client, an
 * admin decides here (adminCancellationController.reviewCancellation).
 */
export default function CancellationReviews() {
  const [selectedId, setSelectedId] = useState(null)
  const [decision, setDecision] = useState(null) // 'APPROVE' | 'REJECT' | null
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { showSuccess, showError } = useToast()
  const { user } = useAuth()

  const fetchFn = useCallback(async (params) => {
    const rows = await fetchCancellationReviews(STATUS_TABS[params.statusTab])
    return { data: rows, meta: { page: 1, totalPages: 1, total: rows.length } }
  }, [])

  const {
    data: rows,
    params,
    loading,
    error,
    reload,
    setData: setRows,
    setFilter,
  } = useListQuery(fetchFn, {
    initialParams: { statusTab: 'Pending' },
    pollIntervalMs: POLL_INTERVAL_MS,
    pausePolling: !!selectedId,
  })

  const selected = useMemo(() => rows.find((r) => r.bookingId === selectedId) || null, [rows, selectedId])

  // `fetchCancellationReviews` isn't paginated — `rows` already holds every
  // on-site cancellation for the current status tab, so the export just
  // writes what's already loaded instead of re-fetching page by page.
  const mapCancellationRow = (r) => ({
    'Booking ID': r.displayId,
    Service: r.service,
    Scheduled: formatWhen(r.scheduledDate, r.scheduledTime),
    Client: r.client?.fullName ?? '',
    Worker: r.worker?.fullName ?? '',
    Fee: r.compensationAmount ?? 0,
    Status: r.compensationStatus,
    'Review Note': r.reviewNote ?? '',
  })

  const [exporting, setExporting] = useState(false)
  const handleExport = async (format) => {
    if (!rows.length) {
      showError('Nothing to export for this filter')
      return
    }
    setExporting(true)
    try {
      const mapped = rows.map(mapCancellationRow)
      if (format === 'pdf') {
        const columns = Object.keys(mapped[0])
        await downloadPdf({
          filename: `cancellation-reviews-${csvDateStamp()}.pdf`,
          title: 'Cancellation Review Report',
          subtitle: `Status: ${params.statusTab}`,
          generatedBy: user?.name || user?.email,
          columns,
          rows: mapped.map((row) => columns.map((key) => row[key])),
        })
      } else {
        downloadCsv(`cancellation-reviews-${csvDateStamp()}.csv`, mapped)
      }
      showSuccess(`Exported ${rows.length} cancellation review(s)`)
    } catch (err) {
      showError(err.message || 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const closeModal = () => {
    setSelectedId(null)
    setDecision(null)
    setNote('')
  }

  const submit = async () => {
    if (!selected || !decision) return
    if (note.trim().length < 10) {
      showError('Add a note explaining the decision (at least 10 characters).')
      return
    }
    setSubmitting(true)
    try {
      await reviewCancellation(selected.bookingId, decision, note.trim())
      showSuccess(decision === 'APPROVE' ? (selected.compensationAmount ? 'Approved — the worker will be compensated.' : 'Approved — the client was at fault. No fee was charged.') : 'Rejected — the penalty was applied.')
      setRows((prev) =>
        params.statusTab === 'Pending'
          ? prev.filter((r) => r.bookingId !== selected.bookingId)
          : prev.map((r) =>
              r.bookingId === selected.bookingId
                ? { ...r, compensationStatus: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', reviewNote: note.trim() }
                : r
            )
      )
      closeModal()
    } catch (err) {
      showError(err.message || 'Failed to review the cancellation')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <PageHeader
        actions={
          <ExportMenu exporting={exporting} onExportCsv={() => handleExport('csv')} onExportPdf={() => handleExport('pdf')} />
        }
        title="Cancellation Reviews"
        subtitle="Workers who cancelled on site and say the client was at fault — check their proof"
      />
      <SubNav items={BOOKINGS_SUB_NAV} />
      <div className="toolbar">
        <FilterTabs
          tabs={Object.keys(STATUS_TABS)}
          activeTab={params.statusTab}
          onTabChange={(tab) => setFilter('statusTab', tab)}
        />
      </div>
      <SectionCard>
        {loading && <LoadingState message="Loading cancellations..." />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Booking</th>
                  <th>Service</th>
                  <th>Scheduled</th>
                  <th>Client</th>
                  <th>Worker</th>
                  <th>Fee</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="table-empty">
                      No {params.statusTab.toLowerCase()} cancellations.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const badge = STATUS_BADGE[r.compensationStatus] ?? { variant: 'pending', label: r.compensationStatus }
                    return (
                      <tr key={r.bookingId}>
                        <td>
                          <Link to={`/bookings/detail/${r.bookingId}`}>{r.displayId}</Link>
                        </td>
                        <td>{r.service}</td>
                        <td>{formatWhen(r.scheduledDate, r.scheduledTime)}</td>
                        <td>{r.client?.fullName ?? '—'}</td>
                        <td>{r.worker?.fullName ?? '—'}</td>
                        <td>{formatPeso(r.compensationAmount)}</td>
                        <td>
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="action-btn view"
                              title="Review proof"
                              aria-label={`Review cancellation of booking ${r.displayId}`}
                              onClick={() => setSelectedId(r.bookingId)}
                            >
                              <i className="fas fa-eye" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {selected && (
        <div className="modal-backdrop" onClick={closeModal} role="presentation">
          <div className="modal modal--landscape" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">Cancellation — {selected.displayId}</h2>
            <div className="modal-detail-grid--2col">
              <div className="detail-block">
                <label>Client</label>
                <div className="value">
                  {selected.client?.fullName ?? '—'}
                  <div className="text-muted" style={{ fontSize: '0.8rem' }}>{selected.client?.phone ?? selected.client?.email}</div>
                </div>
              </div>
              <div className="detail-block">
                <label>Worker</label>
                <div className="value">
                  {selected.worker?.fullName ?? '—'}
                  <div className="text-muted" style={{ fontSize: '0.8rem' }}>{selected.worker?.phone ?? selected.worker?.email}</div>
                </div>
              </div>
              <div className="detail-block">
                <label>Scheduled</label>
                <div className="value">{formatWhen(selected.scheduledDate, selected.scheduledTime)}</div>
              </div>
              <div className="detail-block">
                <label>Worker checked in</label>
                <div className="value">
                  {selected.workerArrivedAt ? new Date(selected.workerArrivedAt).toLocaleString('en-PH') : '—'}
                </div>
              </div>
              <div className="detail-block">
                <label>Cancelled</label>
                <div className="value">{new Date(selected.cancelledAt).toLocaleString('en-PH')}</div>
              </div>
              <div className="detail-block">
                <label>Fee if client at fault</label>
                <div className="value">{formatPeso(selected.compensationAmount)}</div>
              </div>
              {selected.location && (
                <div className="detail-block detail-block--full">
                  <label>Address</label>
                  <div className="value">{selected.location}</div>
                </div>
              )}
              <div className="detail-block detail-block--full">
                <label>What the worker says happened</label>
                <div className="value">{selected.reason || '—'}</div>
              </div>
              <div className="detail-block detail-block--full">
                <label>Proof</label>
                <div className="value" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {(selected.proofUrls ?? []).length === 0
                    ? 'No photos'
                    : selected.proofUrls.map((url, idx) => (
                        <a key={url} href={url} target="_blank" rel="noopener noreferrer" title={`Proof ${idx + 1}`}>
                          <img
                            src={url}
                            alt={`Cancellation proof ${idx + 1}`}
                            style={{
                              width: '120px',
                              height: '120px',
                              objectFit: 'cover',
                              borderRadius: '6px',
                              border: '1px solid var(--border-color, #ddd)',
                            }}
                          />
                        </a>
                      ))}
                </div>
              </div>
              {selected.reviewNote && (
                <div className="detail-block detail-block--full">
                  <label>Review note</label>
                  <div className="value">{selected.reviewNote}</div>
                </div>
              )}
            </div>

            {selected.compensationStatus === 'PENDING_REVIEW' && !decision && (
              <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
                <button type="button" className="btn btn-outline" onClick={closeModal}>
                  Close
                </button>
                <div className="modal-actions__group">
                  {Object.entries(DECISIONS).map(([key, d]) => (
                    <button key={key} type="button" className={d.className} onClick={() => setDecision(key)}>
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selected.compensationStatus === 'PENDING_REVIEW' && decision && (
              <div style={{ marginTop: '1rem' }}>
                <p className="modal-body">{decision === 'APPROVE' && !selected.compensationAmount
                    ? 'The proof shows the client caused the cancellation. There is no cancellation fee, so nothing is charged.'
                    : DECISIONS[decision].description}</p>
                <label htmlFor="cancellation-note" style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
                  Note (sent to both sides, required)
                </label>
                <textarea
                  id="cancellation-note"
                  className="form-input field-full field-textarea"
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="What in the proof led to this decision?"
                />
                <div className="modal-actions" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
                  <button type="button" className="btn btn-outline" onClick={() => setDecision(null)} disabled={submitting}>
                    Back
                  </button>
                  <button type="button" className={DECISIONS[decision].className} onClick={submit} disabled={submitting}>
                    {submitting ? 'Submitting...' : `Confirm: ${DECISIONS[decision].label}`}
                  </button>
                </div>
              </div>
            )}

            {selected.compensationStatus !== 'PENDING_REVIEW' && (
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
