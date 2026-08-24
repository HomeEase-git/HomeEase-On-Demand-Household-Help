import { useEffect, useState } from 'react'
import PageHeader from '../components/common/PageHeader'
import SubNav from '../components/common/SubNav'
import SectionCard from '../components/common/SectionCard'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import Badge from '../components/common/Badge'
import { fetchRemittancePeriods, markRemittancePeriodRemitted } from '../services/tax'
import { useToast } from '../context/ToastContext'

const SUB_NAV = [
  { to: '/payments', label: 'All Transactions' },
  { to: '/payments/refunds', label: 'Refund History' },
  { to: '/payments/payouts', label: 'Payout Distribution' },
  { to: '/payments/tax-certificates', label: 'Tax Certificates' },
  { to: '/payments/tax-remittance', label: 'Tax Remittance' },
]

function formatDate(value) {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// The last 8 calendar quarters — BIR withholding remittance is filed
// quarterly (1601-EQ). Computed client-side; nothing is stored until an
// admin actually marks one remitted.
function lastEightQuarters() {
  const now = new Date()
  const periods = []
  let year = now.getUTCFullYear()
  let quarter = Math.floor(now.getUTCMonth() / 3)

  for (let i = 0; i < 8; i++) {
    quarter -= 1
    if (quarter < 0) {
      quarter = 3
      year -= 1
    }
    const startMonth = quarter * 3
    const periodStart = new Date(Date.UTC(year, startMonth, 1))
    const periodEnd = new Date(Date.UTC(year, startMonth + 3, 1))
    periods.push({
      periodStart: periodStart.toISOString().slice(0, 10),
      periodEnd: periodEnd.toISOString().slice(0, 10),
      label: `Q${quarter + 1} ${year}`,
    })
  }
  return periods
}

export default function TaxRemittance() {
  const { showError, showSuccess } = useToast()
  const [periods] = useState(lastEightQuarters)
  const [summaries, setSummaries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editingPeriod, setEditingPeriod] = useState(null)
  const [referenceNumber, setReferenceNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchRemittancePeriods(periods)
      setSummaries(data)
    } catch (err) {
      setError(err.message || 'Failed to load remittance summary')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openMarkRemitted = (period) => {
    setEditingPeriod(period)
    setReferenceNumber('')
    setNotes('')
  }

  const submitMarkRemitted = async (period) => {
    if (!referenceNumber.trim()) {
      showError('A BIR/bank OR reference number is required')
      return
    }
    setSubmitting(true)
    try {
      await markRemittancePeriodRemitted({
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        referenceNumber: referenceNumber.trim(),
        notes: notes.trim() || undefined,
      })
      showSuccess('Period marked as remitted')
      setEditingPeriod(null)
      load()
    } catch (err) {
      showError(err.message || 'Failed to mark period as remitted')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Tax Remittance"
        subtitle="Quarterly withholding tax due to BIR, and a record of what's actually been filed and paid"
      />
      <SubNav items={SUB_NAV} />
      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: '0.5rem 0 1rem' }}>
        There is no public BIR e-filing API — actual filing and payment happen outside this app (eFPS or an
        authorized bank). This page is a bookkeeping record: it shows what's due per quarter and lets you record
        the OR/reference number once you've filed it.
      </p>
      <SectionCard>
        {loading && <LoadingState message="Loading remittance summary..." />}
        {error && <ErrorState message={error} onRetry={load} />}
        {!loading && !error && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Period</th><th>Tax Withheld</th><th>Status</th><th>Reference</th><th></th>
                </tr>
              </thead>
              <tbody>
                {periods.map((period, i) => {
                  const summary = summaries[i]
                  const isEditing = editingPeriod && editingPeriod.periodStart === period.periodStart
                  return (
                    <tr key={period.periodStart}>
                      <td>{period.label}</td>
                      <td>{summary ? summary.totalTaxWithheldFormatted : '—'}</td>
                      <td>
                        <Badge variant={summary?.status === 'REMITTED' ? 'approved' : 'pending'}>
                          {summary?.status ?? 'PENDING'}
                        </Badge>
                      </td>
                      <td>{summary?.referenceNumber ?? '—'}</td>
                      <td>
                        {summary?.status !== 'REMITTED' && !isEditing && (
                          <button type="button" className="btn btn-outline" onClick={() => openMarkRemitted(period)}>
                            Mark Remitted
                          </button>
                        )}
                        {isEditing && (
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <input
                              type="text"
                              className="form-input"
                              placeholder="OR/reference number"
                              value={referenceNumber}
                              onChange={(e) => setReferenceNumber(e.target.value)}
                              style={{ maxWidth: '160px' }}
                            />
                            <input
                              type="text"
                              className="form-input"
                              placeholder="Notes (optional)"
                              value={notes}
                              onChange={(e) => setNotes(e.target.value)}
                              style={{ maxWidth: '160px' }}
                            />
                            <button
                              type="button"
                              className="btn btn-primary"
                              disabled={submitting}
                              onClick={() => submitMarkRemitted(period)}
                            >
                              {submitting ? 'Saving...' : 'Confirm'}
                            </button>
                            <button type="button" className="btn btn-outline" onClick={() => setEditingPeriod(null)}>
                              Cancel
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  )
}
