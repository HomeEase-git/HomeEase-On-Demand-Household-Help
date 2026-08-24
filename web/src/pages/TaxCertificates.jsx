import { useCallback, useState } from 'react'
import PageHeader from '../components/common/PageHeader'
import SubNav from '../components/common/SubNav'
import SectionCard from '../components/common/SectionCard'
import Pagination from '../components/common/Pagination'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import Badge from '../components/common/Badge'
import { useListQuery } from '../hooks/useListQuery'
import { fetchTaxCertificates, generateTaxCertificates, getCertificateDownloadUrl } from '../services/tax'
import { useToast } from '../context/ToastContext'

const SUB_NAV = [
  { to: '/payments', label: 'All Transactions' },
  { to: '/payments/refunds', label: 'Refund History' },
  { to: '/payments/payouts', label: 'Payout Distribution' },
  { to: '/payments/tax-certificates', label: 'Tax Certificates' },
  { to: '/payments/tax-remittance', label: 'Tax Remittance' },
]

const STATUS_BADGE_VARIANT = { ISSUED: 'approved', DRAFT: 'pending' }

function formatDate(value) {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Defaults to the calendar quarter before the current one — the quarter that
// just closed is almost always the one an admin wants to generate next.
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

export default function TaxCertificates() {
  const { showError, showSuccess } = useToast()
  const [period, setPeriod] = useState(defaultQuarter())
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
      <SubNav items={SUB_NAV} />
      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: '0.5rem 0 1rem' }}>
        Generates one certificate per worker who has a TIN on file and at least one completed payment in the
        period. Workers without a TIN are skipped — they need to add one in the app first. The generated PDF
        contains the correct figures but has not been verified as identical to BIR's official template; confirm
        with an accountant before relying on it for formal filing.
      </p>
      <SectionCard title="Generate Certificates for a Period">
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
                      <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                        No certificates generated yet.
                      </td>
                    </tr>
                  ) : (
                    certificates.map((c) => (
                      <tr key={c.id}>
                        <td>{c.workerName}</td>
                        <td style={{ fontFamily: 'monospace' }}>{c.maskedTin}</td>
                        <td>{formatDate(c.periodStart)} – {formatDate(c.periodEnd)}</td>
                        <td>{c.totalIncomePaymentsFormatted}</td>
                        <td>{c.totalTaxWithheldFormatted}</td>
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
