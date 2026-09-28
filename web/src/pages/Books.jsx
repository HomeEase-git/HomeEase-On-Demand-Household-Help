import { useCallback, useEffect, useMemo, useState } from 'react'
import PageHeader from '../components/common/PageHeader'
import SubNav from '../components/common/SubNav'
import SectionCard from '../components/common/SectionCard'
import Badge from '../components/common/Badge'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import Pagination from '../components/common/Pagination'
import { useToast } from '../context/ToastContext'
import {
  fetchLedgerStatus,
  openLedger,
  syncXenditFees,
  fetchReconciliation,
  signOffMonth,
  fetchLedgerTransactions,
} from '../services/ledger'

const SUB_NAV = [
  { to: '/payments', label: 'All Transactions' },
  { to: '/payments/refunds', label: 'Refunds' },
  { to: '/payments/payouts', label: 'Payout Distribution' },
  { to: '/payments/books', label: 'Books' },
]

// Plain-language names; "normal" is the side the account usually sits on,
// so balances read as positive amounts.
const ACCOUNTS = {
  XENDIT_CASH: { label: 'Money at Xendit', normal: 'Dr' },
  MANUAL_SETTLEMENTS: { label: 'Settled outside the app', normal: 'Dr' },
  WORKER_BALANCE: { label: 'Worker balances (owed to workers)', normal: 'Cr' },
  CLIENT_RECEIVABLE: { label: 'Client fees owed', normal: 'Dr' },
  COMMISSION_REVENUE: { label: 'Commission revenue', normal: 'Cr' },
  PENALTY_REVENUE: { label: 'Penalty revenue', normal: 'Cr' },
  WITHHOLDING_TAX_PAYABLE: { label: 'Withholding tax owed to BIR', normal: 'Cr' },
  XENDIT_FEES: { label: 'Xendit fees', normal: 'Dr' },
  PLATFORM_FUNDED_EXPENSE: { label: 'Worker pay funded by the platform', normal: 'Dr' },
  REFUND_LOSS: { label: 'Refunds after the worker was paid', normal: 'Dr' },
  ADJUSTMENTS: { label: 'Admin dues adjustments', normal: 'Cr' },
  OPENING_BALANCE: { label: 'Opening balances', normal: 'Cr' },
}

const TYPE_LABELS = {
  OPENING: 'Opening balances',
  PAYMENT_CAPTURED: 'Client payment',
  CASH_JOB_SETTLED: 'Cash job',
  PLATFORM_FUNDED: 'Platform-funded pay',
  PAYOUT_SENT: 'Payout sent',
  REFUND_SENT: 'Refund',
  CASH_JOB_REFUNDED: 'Cash job refunded',
  MANUAL_REFUND: 'Manual refund',
  PENALTY: 'Penalty',
  CANCELLATION_FEE: 'Cancellation fee',
  CLIENT_FEE_CLEARED: 'Client fee settled',
  ADMIN_ADJUSTMENT: 'Dues adjustment',
  XENDIT_FEE: 'Xendit fee',
  TAX_REMITTED: 'Tax remitted to BIR',
}

const CHECK_BADGE = {
  PASS: { variant: 'approved', label: 'Agrees' },
  DIFFERENCE: { variant: 'flagged', label: 'Difference' },
  UNAVAILABLE: { variant: 'pending', label: 'Not checked' },
}

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000

function peso(centavos) {
  return `₱${(Math.abs(centavos) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// A signed debit-positive amount shown on the account's usual side.
function natural(centavos, normal) {
  if (centavos === 0) return '—'
  const onNormalSide = normal === 'Dr' ? centavos > 0 : centavos < 0
  return onNormalSide ? peso(centavos) : `(${peso(centavos)})`
}

function monthKey(date) {
  const d = new Date(date.getTime() + MANILA_OFFSET_MS)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

// Months from the one the ledger opened in up to the current one, newest first.
function monthsSince(openedAt) {
  const out = []
  const current = monthKey(new Date())
  let [y, m] = monthKey(new Date(openedAt)).split('-').map(Number)
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    out.unshift(key)
    if (key >= current || out.length > 60) break
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out
}

function CheckRow({ check }) {
  const [open, setOpen] = useState(false)
  const badge = CHECK_BADGE[check.status] ?? CHECK_BADGE.UNAVAILABLE
  const items = check.items ?? []
  const columns = items.length ? Object.keys(items[0]) : []
  return (
    <div style={{ padding: '0.75rem 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Badge variant={badge.variant}>{badge.label}</Badge>
        <strong>{check.label}</strong>
      </div>
      <div className="text-muted text-small" style={{ marginTop: '0.25rem' }}>
        {check.detail}{' '}
        {items.length > 0 && (
          <button type="button" className="btn btn-outline" style={{ padding: '0.1rem 0.5rem', marginLeft: '0.25rem' }} onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : `Show ${items.length}`}
          </button>
        )}
      </div>
      {open && items.length > 0 && (
        <div className="table-wrap" style={{ marginTop: '0.5rem' }}>
          <table className="table">
            <thead>
              <tr>{columns.map((c) => <th key={c}>{c.replace(/([A-Z])/g, ' $1')}</th>)}</tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i}>{columns.map((c) => <td key={c}>{String(item[c] ?? '—')}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/**
 * The platform's books: a double-entry ledger of every peso (see the
 * backend's ledgerService), with a monthly reconciliation an admin signs off.
 */
export default function Books() {
  const { showSuccess, showError } = useToast()
  const [status, setStatus] = useState(null)
  const [statusError, setStatusError] = useState(null)
  const [month, setMonth] = useState(monthKey(new Date()))
  const [report, setReport] = useState(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState(null)
  const [journal, setJournal] = useState({ data: [], meta: null })
  const [journalPage, setJournalPage] = useState(1)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const loadStatus = useCallback(async () => {
    setStatusError(null)
    try {
      setStatus(await fetchLedgerStatus())
    } catch (err) {
      setStatusError(err.message || 'Failed to load the books')
    }
  }, [])

  const loadReport = useCallback(async () => {
    setReportLoading(true)
    setReportError(null)
    try {
      setReport(await fetchReconciliation(month))
    } catch (err) {
      setReportError(err.message || 'Failed to build the reconciliation')
    } finally {
      setReportLoading(false)
    }
  }, [month])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  useEffect(() => {
    if (status?.openedAt) loadReport()
  }, [status?.openedAt, loadReport])

  useEffect(() => {
    if (!status?.openedAt) return
    fetchLedgerTransactions(month, journalPage)
      .then(setJournal)
      .catch(() => setJournal({ data: [], meta: null }))
  }, [status?.openedAt, month, journalPage])

  const months = useMemo(() => (status?.openedAt ? monthsSince(status.openedAt) : []), [status?.openedAt])
  const monthEnded = month < monthKey(new Date())

  const handleOpen = async () => {
    setBusy(true)
    try {
      const result = await openLedger()
      showSuccess(`Ledger opened with ${result.workersCarried} worker balance(s) carried in.`)
      if (result.warning) showError(result.warning)
      setConfirmOpen(false)
      await loadStatus()
    } catch (err) {
      showError(err.message || 'Failed to open the ledger')
    } finally {
      setBusy(false)
    }
  }

  const handleSync = async () => {
    setBusy(true)
    try {
      const result = await syncXenditFees()
      showSuccess(`Xendit fees synced: ${result.posted} new, ${result.unmatched} not ours.`)
      await Promise.all([loadStatus(), loadReport()])
    } catch (err) {
      showError(err.message || 'Failed to sync Xendit fees')
    } finally {
      setBusy(false)
    }
  }

  const handleSignOff = async () => {
    if (!note.trim()) {
      showError('Add a note — explain any check that shows a difference.')
      return
    }
    setBusy(true)
    try {
      await signOffMonth(month, note.trim())
      showSuccess(`${monthLabel(month)} signed off.`)
      setNote('')
      await Promise.all([loadStatus(), loadReport()])
    } catch (err) {
      showError(err.message || 'Failed to sign off the month')
    } finally {
      setBusy(false)
    }
  }

  if (statusError) return <ErrorState message={statusError} onRetry={loadStatus} />
  if (!status) return <LoadingState message="Loading the books..." />

  return (
    <>
      <PageHeader
        title="Books"
        subtitle={
          status.openedAt
            ? `Ledger kept since ${new Date(status.openedAt).toLocaleDateString('en-PH', { dateStyle: 'medium' })} · Xendit fees synced ${status.xenditFeesSyncedTo ? new Date(status.xenditFeesSyncedTo).toLocaleString('en-PH') : 'never'}`
            : 'A double-entry record of every peso the platform handles'
        }
        actions={
          status.openedAt && (
            <button type="button" className="btn btn-outline" onClick={handleSync} disabled={busy}>
              Sync Xendit fees now
            </button>
          )
        }
      />
      <SubNav items={SUB_NAV} />

      {!status.openedAt && (
        <SectionCard title="Start the ledger">
          <p>
            From the moment it's opened, every payment, payout, refund, cash job, penalty, dues adjustment and Xendit fee is
            recorded as a balanced entry, and each month can be reconciled against Xendit and the workers' records.
          </p>
          <p className="text-muted">
            Opening records today's balances as the starting point: what each worker is owed or owes, withholding tax not yet
            remitted, and the current Xendit balance. It can only be done once.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => setConfirmOpen(true)}>
            Open the ledger
          </button>
        </SectionCard>
      )}

      {status.openedAt && (
        <>
          <div className="toolbar" style={{ alignItems: 'center' }}>
            <label className="text-muted text-small" htmlFor="books-month">Month</label>
            <select
              id="books-month"
              className="form-input"
              style={{ maxWidth: '220px' }}
              value={month}
              onChange={(e) => {
                setMonth(e.target.value)
                setJournalPage(1)
              }}
            >
              {months.map((m) => (
                <option key={m} value={m}>{monthLabel(m)}</option>
              ))}
            </select>
          </div>

          {reportLoading && <LoadingState message="Reconciling..." />}
          {reportError && <ErrorState message={reportError} onRetry={loadReport} />}
          {!reportLoading && !reportError && report?.opened && (
            <>
              <SectionCard title={`Reconciliation — ${monthLabel(month)}`}>
                {report.checks.map((c) => <CheckRow key={c.key} check={c} />)}
                <div style={{ marginTop: '1rem' }}>
                  {report.signoff ? (
                    <p>
                      <Badge variant={report.signoff.allChecksPassed ? 'approved' : 'pending'}>Signed off</Badge>{' '}
                      {new Date(report.signoff.createdAt).toLocaleString('en-PH')} — {report.signoff.note}
                    </p>
                  ) : monthEnded ? (
                    <>
                      <label className="form-label form-label--spaced" htmlFor="signoff-note">
                        Sign off this month (explain any difference)
                      </label>
                      <textarea
                        id="signoff-note"
                        className="form-input field-full field-textarea"
                        rows={2}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
                        <button type="button" className="btn btn-primary" onClick={handleSignOff} disabled={busy}>
                          Sign off {monthLabel(month)}
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="text-muted text-small">This month can be signed off once it ends.</p>
                  )}
                </div>
              </SectionCard>

              <SectionCard title="Account balances">
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr><th>Account</th><th>Start of month</th><th>Debits</th><th>Credits</th><th>End of month</th></tr>
                    </thead>
                    <tbody>
                      {report.accounts
                        .filter((a) => a.opening || a.debits || a.credits || a.closing)
                        .map((a) => {
                          const meta = ACCOUNTS[a.account] ?? { label: a.account, normal: 'Dr' }
                          return (
                            <tr key={a.account}>
                              <td>{meta.label}</td>
                              <td>{natural(a.opening, meta.normal)}</td>
                              <td>{a.debits ? peso(a.debits) : '—'}</td>
                              <td>{a.credits ? peso(a.credits) : '—'}</td>
                              <td><strong>{natural(a.closing, meta.normal)}</strong></td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                </div>
                <p className="text-muted text-small">Amounts in brackets sit on the unusual side (e.g. workers who owe dues).</p>
              </SectionCard>

              <SectionCard title="Journal">
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr><th>Date</th><th>Entry</th><th>Lines</th></tr>
                    </thead>
                    <tbody>
                      {journal.data.length === 0 ? (
                        <tr><td colSpan={3} className="table-empty">Nothing recorded this month.</td></tr>
                      ) : (
                        journal.data.map((t) => (
                          <tr key={t.id}>
                            <td>{new Date(t.occurredAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                            <td>
                              <strong>{TYPE_LABELS[t.type] ?? t.type}</strong>
                              <div className="text-muted text-small">{t.memo}</div>
                            </td>
                            <td className="text-small">
                              {t.lines.map((l, i) => (
                                <div key={i}>
                                  {l.amountCentavos > 0 ? 'Dr' : 'Cr'} {ACCOUNTS[l.account]?.label ?? l.account} {peso(l.amountCentavos)}
                                </div>
                              ))}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {journal.meta && journal.data.length > 0 && (
                  <Pagination
                    info={`Page ${journal.meta.page} of ${journal.meta.totalPages}`}
                    hasPrev={journal.meta.hasPrev}
                    hasNext={journal.meta.hasNext}
                    onPrev={() => setJournalPage((p) => p - 1)}
                    onNext={() => setJournalPage((p) => p + 1)}
                  />
                )}
              </SectionCard>
            </>
          )}
        </>
      )}

      {confirmOpen && (
        <div className="modal-backdrop" onClick={() => !busy && setConfirmOpen(false)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">Open the ledger?</h2>
            <p className="modal-body">
              Today's balances become the starting point, and every money movement from now on is recorded. This can only be
              done once.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setConfirmOpen(false)} disabled={busy}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={handleOpen} disabled={busy}>
                {busy ? 'Opening...' : 'Open the ledger'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
