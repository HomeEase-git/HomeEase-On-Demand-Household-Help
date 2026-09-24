import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SectionCard from '../components/common/SectionCard'
import Badge from '../components/common/Badge'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { useDetailQuery } from '../hooks/useListQuery'
import {
  fetchWorkerById,
  fetchWorkerDebt,
  adjustWorkerDebt,
  releaseWorkerHold,
  approveCertification,
  rejectCertification,
} from '../services/workers'
import { suspendUser, reinstateUser } from '../services/users'
import { useToast } from '../context/ToastContext'

const DEBT_TYPE_LABELS = {
  COMMISSION_DEBIT: 'Commission Accrued (cash job)',
  DEBT_RECOVERY: 'Recovered from Payout',
  ADMIN_ADJUSTMENT: 'Admin Adjustment',
  REVERSAL: 'Reversed (refund)',
}

const CERT_STATUS_VARIANT = {
  PENDING: 'pending',
  APPROVED: 'active',
  REJECTED: 'suspended',
}

export default function WorkerDetail() {
  const { id } = useParams()
  const { data: worker, loading, error, reload } = useDetailQuery(fetchWorkerById, id)
  const { showSuccess, showError } = useToast()
  const [statusModalOpen, setStatusModalOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [debt, setDebt] = useState(null)
  const [debtLoading, setDebtLoading] = useState(true)
  const [adjustModalOpen, setAdjustModalOpen] = useState(false)
  const [adjustAmount, setAdjustAmount] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjustSubmitting, setAdjustSubmitting] = useState(false)
  const [releaseModalOpen, setReleaseModalOpen] = useState(false)
  const [releaseNote, setReleaseNote] = useState('')
  const [releaseSubmitting, setReleaseSubmitting] = useState(false)

  const [certActionId, setCertActionId] = useState(null)
  const [rejectingCert, setRejectingCert] = useState(null)
  const [certRejectReason, setCertRejectReason] = useState('')
  const [certRejectSubmitting, setCertRejectSubmitting] = useState(false)

  const handleApproveCertification = async (certId) => {
    setCertActionId(certId)
    try {
      await approveCertification(certId)
      showSuccess('Certification approved.')
      reload()
    } catch (err) {
      showError(err.message || 'Failed to approve certification')
    } finally {
      setCertActionId(null)
    }
  }

  const handleRejectCertification = async () => {
    if (!certRejectReason.trim()) {
      showError('A rejection reason is required.')
      return
    }
    setCertRejectSubmitting(true)
    try {
      await rejectCertification(rejectingCert.id, certRejectReason.trim())
      showSuccess('Certification rejected.')
      setRejectingCert(null)
      setCertRejectReason('')
      reload()
    } catch (err) {
      showError(err.message || 'Failed to reject certification')
    } finally {
      setCertRejectSubmitting(false)
    }
  }

  const loadDebt = async () => {
    setDebtLoading(true)
    try {
      const data = await fetchWorkerDebt(id)
      setDebt(data)
    } catch (err) {
      console.error('Load worker debt error:', err)
    } finally {
      setDebtLoading(false)
    }
  }

  useEffect(() => {
    loadDebt()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const handleAdjustDebt = async () => {
    const amount = Number(adjustAmount)
    if (!amount) {
      showError('Enter a non-zero amount.')
      return
    }
    if (!adjustReason.trim()) {
      showError('A reason is required.')
      return
    }
    setAdjustSubmitting(true)
    try {
      await adjustWorkerDebt(id, amount, adjustReason.trim())
      showSuccess('Platform dues adjusted.')
      setAdjustModalOpen(false)
      setAdjustAmount('')
      setAdjustReason('')
      loadDebt()
    } catch (err) {
      showError(err.message || 'Failed to adjust dues')
    } finally {
      setAdjustSubmitting(false)
    }
  }

  const handleReleaseHold = async () => {
    setReleaseSubmitting(true)
    try {
      await releaseWorkerHold(id, releaseNote.trim() || undefined)
      showSuccess('Account hold lifted.')
      setReleaseModalOpen(false)
      setReleaseNote('')
      loadDebt()
    } catch (err) {
      showError(err.message || 'Failed to release hold')
    } finally {
      setReleaseSubmitting(false)
    }
  }

  if (loading) return <LoadingState message="Loading worker..." />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!worker) {
    return (
      <SectionCard>
        <p style={{ color: 'var(--text-muted)' }}>Worker not found. <Link to="/workers">Back to Workers</Link></p>
      </SectionCard>
    )
  }

  const isSuspended = worker.accountStatus !== 'active'

  const handleToggleStatus = async () => {
    setSubmitting(true)
    try {
      if (isSuspended) {
        await reinstateUser(worker.id, reason.trim() || 'Reinstated by admin')
        showSuccess('Worker account reinstated.')
      } else {
        await suspendUser(worker.id, reason.trim() || 'Suspended by admin')
        showSuccess('Worker account suspended.')
      }
      setStatusModalOpen(false)
      setReason('')
      reload()
    } catch (err) {
      showError(err.message || 'Failed to update account status')
    } finally {
      setSubmitting(false)
    }
  }

  const details = [
    { label: 'Worker ID', value: worker.displayId },
    { label: 'Full Name', value: worker.name },
    { label: 'Email', value: worker.email },
    { label: 'Services', value: worker.services },
    { label: 'Rating', value: `★ ${worker.rating} (${worker.reviews} reviews)` },
    {
      label: 'Expertise Tier',
      value: worker.tier && worker.tier !== 'STANDARD' ? <Badge variant="approved">{worker.tier}</Badge> : 'Standard',
    },
    { label: 'Total Earnings', value: worker.earnings },
    {
      label: 'Verification',
      value: (
        <Badge variant={worker.verification === 'Verified' ? 'approved' : 'pending'}>
          {worker.verification}
        </Badge>
      ),
    },
    {
      label: 'Account Status',
      value: <Badge variant={worker.accountStatus === 'active' ? 'active' : 'suspended'}>{worker.accountStatus}</Badge>,
    },
    { label: 'Joined', value: worker.joined },
    {
      label: 'Recent Declines',
      value: worker.recentDeclineCount != null ? worker.recentDeclineCount : '—',
    },
    {
      label: 'Decline Cooldown',
      value:
        worker.declineCooldownUntil && new Date(worker.declineCooldownUntil) > new Date() ? (
          <Badge variant="suspended">
            Paused until {new Date(worker.declineCooldownUntil).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </Badge>
        ) : (
          'None'
        ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Worker Detail"
        subtitle="View and manage worker profile"
        actions={(
          <>
            <Link to="/workers" className="btn btn-outline">Back to Workers</Link>
            <button
              type="button"
              className={isSuspended ? 'btn btn-success' : 'btn btn-danger'}
              onClick={() => setStatusModalOpen(true)}
            >
              {isSuspended ? 'Reinstate Account' : 'Suspend Account'}
            </button>
          </>
        )}
      />
      <div className="detail-grid">
        {details.map(({ label, value }) => (
          <div key={label} className="detail-block">
            <label>{label}</label>
            <div className="value">{value}</div>
          </div>
        ))}
      </div>
      <SectionCard title="Recent Bookings">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Booking ID</th><th>Client</th><th>Service</th><th>Scheduled</th><th>Worker Earnings</th>
              </tr>
            </thead>
            <tbody>
              {(worker.recentBookings || []).length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No bookings yet.</td>
                </tr>
              ) : (
                worker.recentBookings.map((b) => (
                  <tr key={b.bookingId}>
                    <td>{b.id}</td>
                    <td>{b.client}</td>
                    <td>{b.service}</td>
                    <td>{b.date}</td>
                    <td>{b.earnings}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Certifications">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Title</th><th>Issuer</th><th>Category</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(worker.certifications || []).length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No certifications uploaded.</td>
                </tr>
              ) : (
                worker.certifications.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <a href={c.documentUrl} target="_blank" rel="noreferrer">{c.title}</a>
                    </td>
                    <td>{c.issuer}</td>
                    <td>
                      {c.serviceType?.name ?? '—'}
                      {c.gatesPendingCategoryName && (
                        <div style={{ fontSize: '0.8em', color: 'var(--text-muted)' }}>
                          Approving unlocks "{c.gatesPendingCategoryName}" as an additional service
                        </div>
                      )}
                    </td>
                    <td><Badge variant={CERT_STATUS_VARIANT[c.verificationStatus] ?? 'pending'}>{c.verificationStatus}</Badge></td>
                    <td>
                      {c.verificationStatus === 'PENDING' && (
                        <div className="row-actions">
                          <button
                            type="button"
                            className="action-btn approve"
                            title="Approve"
                            aria-label={`Approve ${c.title}`}
                            disabled={certActionId === c.id}
                            onClick={() => handleApproveCertification(c.id)}
                          >
                            <i className="fas fa-check" />
                          </button>
                          <button
                            type="button"
                            className="action-btn delete"
                            title="Reject"
                            aria-label={`Reject ${c.title}`}
                            onClick={() => { setRejectingCert(c); setCertRejectReason('') }}
                          >
                            <i className="fas fa-xmark" />
                          </button>
                        </div>
                      )}
                      {c.verificationStatus === 'REJECTED' && c.rejectionReason && (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{c.rejectionReason}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {rejectingCert && (
        <div className="modal-backdrop" onClick={() => setRejectingCert(null)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">Reject Certification</h2>
            <p className="modal-body">Rejecting "{rejectingCert.title}" — explain why so the worker can fix and resubmit.</p>
            <div className="form-field">
              <label htmlFor="cert-reject-reason">Reason</label>
              <textarea
                id="cert-reject-reason"
                value={certRejectReason}
                onChange={(e) => setCertRejectReason(e.target.value)}
                rows={3}
                style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 8 }}
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setRejectingCert(null)}>Cancel</button>
              <button type="button" className="btn btn-danger" disabled={certRejectSubmitting} onClick={handleRejectCertification}>
                {certRejectSubmitting ? 'Rejecting...' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      <SectionCard title="Platform Dues">
        {debtLoading ? (
          <LoadingState message="Loading platform dues..." />
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <p style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>
                ₱{(debt?.commissionOwed ?? 0).toFixed(2)} owed
              </p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {debt?.debtHoldAt && (
                  <button type="button" className="btn btn-success" onClick={() => setReleaseModalOpen(true)}>
                    Release Hold
                  </button>
                )}
                <button type="button" className="btn btn-outline" onClick={() => setAdjustModalOpen(true)}>
                  Adjust Dues
                </button>
              </div>
            </div>
            {debt?.debtHoldAt && (
              <p style={{ marginBottom: '0.75rem' }}>
                <Badge variant="suspended">
                  On hold since {new Date(debt.debtHoldAt).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </Badge>
                {debt.debtHoldNote && (
                  <span style={{ marginLeft: '0.5rem', color: 'var(--text-muted)' }}>{debt.debtHoldNote}</span>
                )}
              </p>
            )}
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Type</th><th>Amount</th><th>Balance After</th><th>Note</th><th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {(debt?.entries || []).length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                        No ledger activity yet.
                      </td>
                    </tr>
                  ) : (
                    debt.entries.map((e) => (
                      <tr key={e.id}>
                        <td>{DEBT_TYPE_LABELS[e.type] ?? e.type}</td>
                        <td style={{ color: e.amount <= 0 ? 'var(--success)' : 'var(--danger)' }}>
                          {e.amount >= 0 ? '+' : ''}
                          {e.amount.toFixed(2)}
                        </td>
                        <td>₱{e.balanceAfter.toFixed(2)}</td>
                        <td>{e.note || '—'}</td>
                        <td>{new Date(e.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </SectionCard>

      {adjustModalOpen && (
        <div className="modal-backdrop" onClick={() => setAdjustModalOpen(false)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">Adjust Platform Dues</h2>
            <p className="modal-body">
              Positive amounts reduce what the worker owes, negative amounts increase it. Use this for support
              cases like waiving a debt or correcting a bad accrual.
            </p>
            <label htmlFor="adjust-amount" style={{ display: 'block', margin: '0.5rem 0 0.35rem', fontWeight: 600 }}>
              Amount (₱)
            </label>
            <input
              id="adjust-amount"
              type="number"
              step="1"
              className="form-input"
              value={adjustAmount}
              onChange={(e) => setAdjustAmount(e.target.value)}
              placeholder="e.g. 50 or -20"
              style={{ width: '100%' }}
            />
            <label htmlFor="adjust-reason" style={{ display: 'block', margin: '0.75rem 0 0.35rem', fontWeight: 600 }}>
              Reason
            </label>
            <textarea
              id="adjust-reason"
              className="form-input"
              rows={3}
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
              placeholder="Why is this adjustment being made?"
              style={{ width: '100%', resize: 'vertical' }}
            />
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setAdjustModalOpen(false)}
                disabled={adjustSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleAdjustDebt}
                disabled={adjustSubmitting}
              >
                {adjustSubmitting ? 'Saving...' : 'Confirm Adjustment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {releaseModalOpen && (
        <div className="modal-backdrop" onClick={() => setReleaseModalOpen(false)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">Release Account Hold</h2>
            <p className="modal-body">
              This lets {worker.name} accept new jobs again. It does not forgive their outstanding dues — use
              "Adjust Dues" separately if you're waiving any of it.
            </p>
            <label htmlFor="release-note" style={{ display: 'block', margin: '0.5rem 0 0.35rem', fontWeight: 600 }}>
              Note (optional)
            </label>
            <textarea
              id="release-note"
              className="form-input"
              rows={3}
              value={releaseNote}
              onChange={(e) => setReleaseNote(e.target.value)}
              placeholder="What was agreed with the worker?"
              style={{ width: '100%', resize: 'vertical' }}
            />
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setReleaseModalOpen(false)}
                disabled={releaseSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-success"
                onClick={handleReleaseHold}
                disabled={releaseSubmitting}
              >
                {releaseSubmitting ? 'Saving...' : 'Confirm Release'}
              </button>
            </div>
          </div>
        </div>
      )}

      {statusModalOpen && (
        <div className="modal-backdrop" onClick={() => setStatusModalOpen(false)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">{isSuspended ? 'Reinstate' : 'Suspend'} {worker.name}?</h2>
            {!isSuspended && (
              <p className="modal-body">
                Suspending blocks this worker from accepting new bookings and being surfaced in discovery until
                reinstated.
              </p>
            )}
            <label htmlFor="status-reason" style={{ display: 'block', margin: '0.5rem 0 0.35rem', fontWeight: 600 }}>
              Reason
            </label>
            <textarea
              id="status-reason"
              className="form-input"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={isSuspended ? 'Why is this account being reinstated?' : 'Why is this account being suspended?'}
              style={{ width: '100%', resize: 'vertical' }}
            />
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setStatusModalOpen(false)} disabled={submitting}>
                Cancel
              </button>
              <button
                type="button"
                className={isSuspended ? 'btn btn-success' : 'btn btn-danger'}
                onClick={handleToggleStatus}
                disabled={submitting}
              >
                {submitting ? 'Saving...' : isSuspended ? 'Confirm Reinstate' : 'Confirm Suspend'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
