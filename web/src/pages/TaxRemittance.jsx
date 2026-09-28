import { useEffect, useState } from 'react'
import PageHeader from '../components/common/PageHeader'
import SectionCard from '../components/common/SectionCard'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import Badge from '../components/common/Badge'
import { fetchRemittancePeriods, markRemittancePeriodRemitted } from '../services/tax'
import { useToast } from '../context/ToastContext'
import { recentClosedQuarters, monthShort } from '../utils/taxPeriods'

// The last 8 closed calendar quarters (Manila time). BIR takes the first two
// months of each quarter on monthly remittance forms and the quarter on the
// quarterly return, so each row also shows the per-month amounts. Nothing is
// stored until an admin marks a quarter remitted.
const lastEightQuarters = () => recentClosedQuarters(8)

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
      <p className="form-hint">
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
                      <td>
                        {summary ? summary.totalTaxWithheldFormatted : '—'}
                        {summary?.months?.length > 0 && (
                          <div className="text-muted text-small">
                            {summary.months.map((m) => `${monthShort(m.month)} ${m.taxWithheldFormatted}`).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td>
                        <Badge
                          variant={
                            summary?.status === 'REMITTED'
                              ? 'approved'
                              : summary?.status === 'NEEDS_REVIEW'
                                ? 'flagged'
                                : 'pending'
                          }
                        >
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
