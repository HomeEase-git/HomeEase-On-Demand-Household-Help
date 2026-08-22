import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SectionCard from '../components/common/SectionCard'
import Badge from '../components/common/Badge'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { useDetailQuery } from '../hooks/useListQuery'
import { fetchWorkerById, fetchWorkerWallet, adjustWorkerWallet } from '../services/workers'
import { suspendUser, reinstateUser } from '../services/users'
import { useToast } from '../context/ToastContext'

const WALLET_TYPE_LABELS = {
  TOPUP: 'Top Up',
  ADMIN_FEE_DEDUCTION: 'Admin Fee',
  REFUND: 'Refund',
  ADMIN_ADJUSTMENT: 'Adjustment',
}

export default function WorkerDetail() {
  const { id } = useParams()
  const { data: worker, loading, error, reload } = useDetailQuery(fetchWorkerById, id)
  const { showSuccess, showError } = useToast()
  const [statusModalOpen, setStatusModalOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [wallet, setWallet] = useState(null)
  const [walletLoading, setWalletLoading] = useState(true)
  const [adjustModalOpen, setAdjustModalOpen] = useState(false)
  const [adjustAmount, setAdjustAmount] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjustSubmitting, setAdjustSubmitting] = useState(false)

  const loadWallet = async () => {
    setWalletLoading(true)
    try {
      const data = await fetchWorkerWallet(id)
      setWallet(data)
    } catch (err) {
      console.error('Load worker wallet error:', err)
    } finally {
      setWalletLoading(false)
    }
  }

  useEffect(() => {
    loadWallet()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const handleAdjustWallet = async () => {
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
      await adjustWorkerWallet(id, amount, adjustReason.trim())
      showSuccess('Wallet balance adjusted.')
      setAdjustModalOpen(false)
      setAdjustAmount('')
      setAdjustReason('')
      loadWallet()
    } catch (err) {
      showError(err.message || 'Failed to adjust wallet')
    } finally {
      setAdjustSubmitting(false)
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
                <th>Booking ID</th><th>Client</th><th>Service</th><th>Date</th><th>Earnings</th>
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

      <SectionCard title="Wallet">
        {walletLoading ? (
          <LoadingState message="Loading wallet..." />
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <p style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>
                ₱{(wallet?.balance ?? 0).toFixed(2)}
              </p>
              <button type="button" className="btn btn-outline" onClick={() => setAdjustModalOpen(true)}>
                Adjust Balance
              </button>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Type</th><th>Amount</th><th>Status</th><th>Note / Reason</th><th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {(wallet?.transactions || []).length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                        No wallet activity yet.
                      </td>
                    </tr>
                  ) : (
                    wallet.transactions.map((t) => (
                      <tr key={t.id}>
                        <td>{WALLET_TYPE_LABELS[t.type] ?? t.type}</td>
                        <td style={{ color: t.amount >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                          {t.amount >= 0 ? '+' : ''}
                          {t.amount.toFixed(2)}
                        </td>
                        <td>{t.status}</td>
                        <td title={t.failureReason || undefined}>{t.note || t.failureReason || '—'}</td>
                        <td>{new Date(t.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
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
            <h2 className="modal-title">Adjust Wallet Balance</h2>
            <p className="modal-body">
              Positive amounts credit the wallet, negative amounts debit it. Use this for support cases like a
              goodwill credit or correcting a bad deduction.
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
                onClick={handleAdjustWallet}
                disabled={adjustSubmitting}
              >
                {adjustSubmitting ? 'Saving...' : 'Confirm Adjustment'}
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
