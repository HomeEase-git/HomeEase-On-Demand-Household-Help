import { useCallback, useState } from 'react'
import PageHeader from '../components/common/PageHeader'
import SectionCard from '../components/common/SectionCard'
import Pagination from '../components/common/Pagination'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import Badge from '../components/common/Badge'
import { useListQuery } from '../hooks/useListQuery'
import { fetchTaxCertificates, generateTaxCertificates, getCertificateDownloadUrl } from '../services/tax'
import { useToast } from '../context/ToastContext'
import { recentClosedQuarters, monthShort } from '../utils/taxPeriods'

const STATUS_BADGE_VARIANT = { ISSUED: 'approved', DRAFT: 'pending', NEEDS_REVIEW: 'flagged' }

// Form 2307 is issued per calendar quarter; the one that just closed is
// almost always the one an admin wants next, so it's the default.
const QUARTERS = recentClosedQuarters(8)

export default function TaxCertificates() {
  const { showError, showSuccess } = useToast()
  const [period, setPeriod] = useState(QUARTERS[0])
  const [generating, setGenerating] = useState(false)
  const [downloadingId, setDownloadingId] = useState(null)

  const fetchFn = useCallback(
    (params) => fetchTaxCertificates({ page: params.page || 1, limit: 10 }),
    []
  )

  const { data: certificates, meta, loading, error, reload, goToPage } = useListQuery(fetchFn, {
    initialParams: { page: 1 },
  })

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const result = await generateTaxCertificates(period.periodStart, period.periodEnd)
      showSuccess(
        `Generated ${result.generated} certificate(s).${
          result.skippedNoTin.length ? ` ${result.skippedNoTin.length} worker(s) skipped — no TIN on file.` : ''
        }`
      )
      reload()
    } catch (err) {
      showError(err.message || 'Failed to generate certificates')
    } finally {
      setGenerating(false)
    }
  }

  const handleDownload = async (id) => {
    setDownloadingId(id)
    try {
      const url = await getCertificateDownloadUrl(id)
      window.open(url, '_blank', 'noopener')
    } catch (err) {
      showError(err.message || 'Failed to generate a download link')
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Tax Certificates"
        subtitle="BIR Form 2307 withholding certificates generated per worker per reporting period"
      />
      <p className="form-hint">
        Generates one certificate per worker who has a TIN on file and at least one completed payment in the
        period. Workers without a TIN are skipped — they need to add one in the app first. The generated PDF
        contains the correct figures but has not been verified as identical to BIR's official template; confirm
        with an accountant before relying on it for formal filing.
      </p>
      <SectionCard title="Generate Certificates for a Quarter">
        <div className="toolbar" style={{ alignItems: 'center' }}>
          <label className="text-muted text-small" htmlFor="cert-quarter">Quarter</label>
          <select
            id="cert-quarter"
            className="form-input"
            value={period.periodStart}
            onChange={(e) => setPeriod(QUARTERS.find((q) => q.periodStart === e.target.value))}
            style={{ maxWidth: '160px' }}
          >
            {QUARTERS.map((q) => (
              <option key={q.periodStart} value={q.periodStart}>{q.label}</option>
            ))}
          </select>
          <button type="button" className="btn btn-primary" onClick={handleGenerate} disabled={generating}>
            {generating ? 'Generating...' : 'Generate'}
          </button>
        </div>
      </SectionCard>
      <SectionCard>
        {loading && <LoadingState message="Loading certificates..." />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Worker</th><th>TIN</th><th>Period</th><th>Income Payments</th><th>Tax Withheld</th><th>Status</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {certificates.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="table-empty">
                        No certificates generated yet.
                      </td>
                    </tr>
                  ) : (
                    certificates.map((c) => (
                      <tr key={c.id}>
                        <td>{c.workerName}</td>
                        <td style={{ fontFamily: 'monospace' }}>{c.maskedTin}</td>
                        <td>{c.periodLabel}</td>
                        <td>{c.totalIncomePaymentsFormatted}</td>
                        <td>
                          {c.totalTaxWithheldFormatted}
                          {Array.isArray(c.monthlyBreakdown) && (
                            <div className="text-muted text-small">
                              {c.monthlyBreakdown.map((m) => `${monthShort(m.month)} ₱${m.taxWithheld.toFixed(2)}`).join(' · ')}
                            </div>
                          )}
                        </td>
                        <td><Badge variant={STATUS_BADGE_VARIANT[c.status] ?? 'pending'}>{c.status}</Badge></td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-outline"
                            disabled={downloadingId === c.id}
                            onClick={() => handleDownload(c.id)}
                          >
                            {downloadingId === c.id ? 'Opening...' : 'Download'}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              info={`Showing ${certificates.length} of ${meta.total} certificates`}
              hasPrev={meta.hasPrev}
              hasNext={meta.hasNext}
              onPrev={() => goToPage(meta.page - 1)}
              onNext={() => goToPage(meta.page + 1)}
            />
          </>
        )}
      </SectionCard>
    </>
  )
}
