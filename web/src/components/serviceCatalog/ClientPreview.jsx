import { useState } from 'react'
import { countRange, formatPeso, usesCount } from './catalogModel'

/**
 * The client's booking step for the chosen job: pick the job, and for a
 * per-piece job enter how many. Mirrors mobile step-1 so the admin sees
 * what clients get.
 */
export default function ClientPreview({ draft, jobRef, onJobChange }) {
  const [count, setCount] = useState(null)
  const jobs = draft.jobs.filter((j) => j.isActive)
  const job = jobs.find((j) => j.ref === jobRef) || jobs[0] || null
  const perPiece = job && usesCount(job.model)
  const min = Math.max(1, Number(job?.minQty) || 1)
  const max = job?.maxQty === '' || job?.maxQty == null ? null : Number(job.maxQty)
  const n = perPiece ? Math.min(max ?? Infinity, Math.max(min, count ?? min)) : 1

  let estimate = { main: '—', sub: '' }
  if (job && !perPiece) estimate = { main: formatPeso(job.price), sub: 'Flat price' }
  else if (job) estimate = { main: formatPeso(Number(job.price) * n), sub: `${formatPeso(job.price)} × ${n} ${job.unit || ''}`.trim() }

  return (
    <aside className="sce-preview" aria-label="Client app preview">
      <p className="sce-preview__cap">Client app preview</p>
      <div className="sce-phone">
        <div className="sce-screen">
          <div className="sce-ph-top">
            <small>Book a service</small>
            <h3>{draft.details.name || 'New service'}</h3>
          </div>
          <div className="sce-ph-body">
            <div className="sce-ph-card">
              <label className="sce-field">
                <span>What do you need?</span>
                <select
                  className="sce-input"
                  value={job?.ref || ''}
                  onChange={(e) => {
                    onJobChange(e.target.value)
                    setCount(null)
                  }}
                  disabled={!jobs.length}
                >
                  {jobs.length ? jobs.map((j) => <option key={j.ref} value={j.ref}>{j.name || 'Untitled job'}</option>) : <option>No active jobs yet</option>}
                </select>
              </label>
              {job && (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                  {`${formatPeso(job.price)}${perPiece && job.unit ? ` per ${job.unit}` : ''}`}
                </div>
              )}
            </div>
            {perPiece && (
              <div className="sce-ph-card">
                <div className="sce-pq">
                  <div className="sce-pq__l">How many?</div>
                  <div className="sce-pq__h">
                    Priced per {job.unit || 'unit'}
                    {countRange(job) ? ` · ${countRange(job)}` : ''}
                  </div>
                  <div className="sce-step">
                    <button type="button" onClick={() => setCount(Math.max(min, n - 1))} aria-label="Less">−</button>
                    <span>{n}</span>
                    <button type="button" onClick={() => setCount(max != null ? Math.min(max, n + 1) : n + 1)} aria-label="More">+</button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="sce-ph-foot">
            <div className="sce-est">
              <small>Estimated labor</small>
              <b>{estimate.main}</b>
            </div>
            <div className="sce-est">
              <small>{estimate.sub}</small>
              <small>+ distance fee</small>
            </div>
          </div>
        </div>
      </div>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.6rem 0.25rem 0' }}>
        Shows the job's price, the same at every worker. The expertise-tier surcharge and distance fee are added at booking.
      </p>
    </aside>
  )
}
