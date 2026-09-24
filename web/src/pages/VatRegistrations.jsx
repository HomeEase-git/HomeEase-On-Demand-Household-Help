import { useCallback, useState } from 'react'
import PageHeader from '../components/common/PageHeader'
import SectionCard from '../components/common/SectionCard'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import Badge from '../components/common/Badge'
import Pagination from '../components/common/Pagination'
import { useListQuery } from '../hooks/useListQuery'
import {
  fetchVatRegistrations,
  approveVatRegistration,
  rejectVatRegistration,
  fetchVatSummaries,
  generateVatSummary,
} from '../services/vat'
import { useToast } from '../context/ToastContext'

// Defaults to the calendar quarter before the current one — same reasoning
// as TaxCertificates.jsx's defaultQuarter: the quarter that just closed is
// almost always the one an admin wants to generate next.
function defaultQuarter() {
  const now = new Date()
  const q = Math.floor(now.getUTCMonth() / 3)
  const year = q === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear()
  const startMonth = q === 0 ? 9 : (q - 1) * 3
  const periodStart = new Date(Date.UTC(year, startMonth, 1))
  const periodEnd = new Date(Date.UTC(year, startMonth + 3, 1))
  return {
    periodStart: periodStart.toISOString().slice(0, 10),
    periodEnd: periodEnd.toISOString().slice(0, 10),
  }
}

const STATUS_BADGE_VARIANT = { PENDING: 'pending', APPROVED: 'active', REJECTED: 'suspended' }

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function VatRegistrations() {
  const { showError, showSuccess } = useToast()
  const [statusFilter, setStatusFilter] = useState('PENDING')
  const [actioningId, setActioningId] = useState(null)
  const [rejectingWorker, setRejectingWorker] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [rejecting, setRejecting] = useState(false)

  const fetchFn = useCallback(() => fetchVatRegistrations(statusFilter), [statusFilter])
  const { data: registrations, loading, error, reload, setData } = useListQuery(fetchFn)

  const [period, setPeriod] = useState(defaultQuarter())
  const [generatingSummary, setGeneratingSummary] = useState(false)
  const summaryFetchFn = useCallback((params) => fetchVatSummaries({ page: params.page || 1, limit: 10 }), [])
  const {
    data: summaries,
    meta: summaryMeta,
    loading: summariesLoading,
    error: summariesError,
    reload: reloadSummaries,
    goToPage: goToSummaryPage,
  } = useListQuery(summaryFetchFn, { initialParams: { page: 1 } })

  const handleGenerateSummary = async () => {
    setGeneratingSummary(true)
    try {
      const result = await generateVatSummary(period.periodStart, period.periodEnd)
      showSuccess(
        `Generated ${result.generated} VAT summary/summaries.${
          result.skippedNoVat ? ` ${result.skippedNoVat} worker(s) had no VAT collected in this period.` : ''
        }`
      )
      reloadSummaries()
    } catch (err) {
      showError(err.message || 'Failed to generate VAT summary')
    } finally {
      setGeneratingSummary(false)
    }
  }

  const handleApprove = async (workerId) => {
    setActioningId(workerId)
    try {
      await approveVatRegistration(workerId)
      setData((prev) => prev.filter((r) => r.userId !== workerId))
      showSuccess('VAT registration approved.')
    } catch (err) {
      showError(err.message || 'Failed to approve')
    } finally {
      setActioningId(null)
    }
  }

  const openReject = (registration) => {
    setRejectingWorker(registration)
    setRejectReason('')
  }

  const handleReject = async () => {
    if (!rejectReason.trim()) return
    setRejecting(true)
    try {
      await rejectVatRegistration(rejectingWorker.userId, rejectReason.trim())
      setData((prev) => prev.filter((r) => r.userId !== rejectingWorker.userId))
      showSuccess('VAT registration rejected.')
      setRejectingWorker(null)
    } catch (err) {
      showError(err.message || 'Failed to reject')
    } finally {
      setRejecting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="VAT Registrations"
        subtitle="Review worker-submitted proof of VAT registration before it affects any booking's pricing"
      />
      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: '0.5rem 0 1rem' }}>
        Approving here is the only thing that makes VAT apply to a worker's future bookings — submitting a document
        alone does nothing. None of this platform's trades are BIR-licensed professions, so one ATC code covers
        every worker regardless of VAT status (see Settings for the code on file).
      </p>
      <div className="toolbar">
        <select
          className="form-input"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ maxWidth: '160px' }}
        >
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="ALL">All</option>
        </select>
      </div>
      <SectionCard title="Registrations">
        {loading && <LoadingState message="Loading registrations..." />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Worker</th><th>Submitted</th><th>Document</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {registrations.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      No {statusFilter !== 'ALL' ? statusFilter.toLowerCase() : ''} registrations.
                    </td>
                  </tr>
                ) : (
                  registrations.map((r) => (
                    <tr key={r.userId}>
                      <td>
                        <strong>{r.user?.fullName}</strong>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{r.user?.email}</div>
                      </td>
                      <td>{formatDate(r.vatSubmittedAt)}</td>
                      <td>
                        {r.vatDocumentUrl ? (
                          <a href={r.vatDocumentUrl} target="_blank" rel="noopener noreferrer">
                            View
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <Badge variant={STATUS_BADGE_VARIANT[r.vatVerificationStatus] ?? 'pending'}>
                          {r.vatVerificationStatus}
                        </Badge>
                        {r.vatVerificationStatus === 'REJECTED' && r.vatRejectionReason && (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.2rem' }}>
                            {r.vatRejectionReason}
                          </div>
                        )}
                      </td>
                      <td>
                        {r.vatVerificationStatus === 'PENDING' && (
                          <div className="row-actions">
                            <button
                              type="button"
                              className="action-btn approve"
                              title="Approve"
                              aria-label={`Approve ${r.user?.fullName}`}
                              disabled={actioningId === r.userId}
                              onClick={() => handleApprove(r.userId)}
                            >
                              <i className="fas fa-check" />
                            </button>
                            <button
                              type="button"
                              className="action-btn delete"
                              title="Reject"
                              aria-label={`Reject ${r.user?.fullName}`}
                              onClick={() => openReject(r)}
                            >
                              <i className="fas fa-xmark" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <PageHeader
        title="VAT Collection Summary"
        subtitle="Informational only — this is VAT workers collected on their own bookings, for their own 2550Q/2551Q filing. The platform never remits this (see Tax Remittance for the platform's actual withholding-tax obligation)."
      />
      <SectionCard title="Generate Summary for a Period">
        <div className="toolbar" style={{ alignItems: 'center' }}>
          <label style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>From</label>
          <input
            type="date"
            className="form-input"
            value={period.periodStart}
            onChange={(e) => setPeriod((p) => ({ ...p, periodStart: e.target.value }))}
            style={{ maxWidth: '160px' }}
          />
          <label style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>To</label>
          <input
            type="date"
            className="form-input"
            value={period.periodEnd}
            onChange={(e) => setPeriod((p) => ({ ...p, periodEnd: e.target.value }))}
            style={{ maxWidth: '160px' }}
          />
          <button type="button" className="btn btn-primary" onClick={handleGenerateSummary} disabled={generatingSummary}>
            {generatingSummary ? 'Generating...' : 'Generate'}
          </button>
        </div>
      </SectionCard>
      <SectionCard>
        {summariesLoading && <LoadingState message="Loading VAT summaries..." />}
        {summariesError && <ErrorState message={summariesError} onRetry={reloadSummaries} />}
        {!summariesLoading && !summariesError && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Worker</th><th>Period</th><th>VAT Collected</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                        No summaries generated yet.
                      </td>
                    </tr>
                  ) : (
                    summaries.map((s) => (
                      <tr key={s.id}>
                        <td>{s.workerName}</td>
                        <td>{formatDate(s.periodStart)} – {formatDate(s.periodEnd)}</td>
                        <td>{s.totalVatCollectedFormatted}</td>
                        <td>
                          {s.needsReview ? (
                            <Badge variant="flagged">Needs Review</Badge>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              info={`Showing ${summaries.length} of ${summaryMeta.total} summaries`}
              hasPrev={summaryMeta.hasPrev}
              hasNext={summaryMeta.hasNext}
              onPrev={() => goToSummaryPage(summaryMeta.page - 1)}
              onNext={() => goToSummaryPage(summaryMeta.page + 1)}
            />
          </>
        )}
      </SectionCard>

      {rejectingWorker && (
        <div className="modal-backdrop" onClick={() => setRejectingWorker(null)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">Reject VAT Registration</h2>
            <p className="modal-body">
              Tell {rejectingWorker.user?.fullName} why this submission was rejected.
            </p>
            <div className="form-field">
              <label htmlFor="vat-reject-reason">Reason</label>
              <input
                id="vat-reject-reason"
                type="text"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Document is illegible, please re-upload"
                style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 8 }}
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setRejectingWorker(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={rejecting || !rejectReason.trim()}
                onClick={handleReject}
              >
                {rejecting ? 'Rejecting...' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
