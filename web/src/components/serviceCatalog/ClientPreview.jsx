import { useState } from 'react'
import { countQuestionFor, formatPeso, usesCount } from './catalogModel'

const choicesOf = (q) => (q.type === 'YESNO' ? ['Yes', 'No'] : q.choices.map((c) => c.trim()).filter(Boolean))

/** One question as the client app shows it. `answer`/`onAnswer` omitted = display only. */
export function PreviewQuestion({ question: q, answer, onAnswer, missing }) {
  const interactive = !!onAnswer
  let body
  if (q.type === 'TEXT') {
    body = (
      <input
        className="sce-input"
        value={answer || ''}
        readOnly={!interactive}
        onChange={(e) => onAnswer?.(e.target.value)}
        placeholder="Type your answer"
        aria-label={q.label}
      />
    )
  } else if (q.type === 'NUMBER') {
    const value = answer ?? q.min ?? 0
    const step = (delta) => {
      let next = Number(value) + delta
      if (q.min !== '' && q.min != null) next = Math.max(Number(q.min), next)
      if (q.max !== '' && q.max != null) next = Math.min(Number(q.max), next)
      onAnswer?.(next)
    }
    body = (
      <div className="sce-step">
        <button type="button" onClick={() => step(-1)} tabIndex={interactive ? 0 : -1} aria-label="Less">−</button>
        <span>{value}</span>
        <button type="button" onClick={() => step(1)} tabIndex={interactive ? 0 : -1} aria-label="More">+</button>
      </div>
    )
  } else {
    const choices = choicesOf(q)
    const shown = choices.length ? choices : ['Choice 1', 'Choice 2']
    body = (
      <div className="sce-pills">
        {shown.map((c) => {
          const on = q.type === 'ANY' ? (answer || []).includes(c) : answer === c
          return (
            <button
              key={c}
              type="button"
              className={`sce-pill ${on ? 'is-on' : ''}`}
              aria-pressed={on}
              tabIndex={interactive ? 0 : -1}
              onClick={() => {
                if (!interactive) return
                if (q.type === 'ANY') {
                  const set = new Set(answer || [])
                  if (set.has(c)) set.delete(c)
                  else set.add(c)
                  onAnswer([...set])
                } else {
                  onAnswer(answer === c ? undefined : c)
                }
              }}
            >
              {c}
            </button>
          )
        })}
      </div>
    )
  }
  return (
    <div className={`sce-pq ${missing ? 'sce-pq--missing' : ''}`}>
      <div className="sce-pq__l">
        {q.label || 'Your question'}
        {q.required && <span className="sce-req"> *</span>}
      </div>
      {q.helpText?.trim() && <div className="sce-pq__h">{q.helpText}</div>}
      {body}
    </div>
  )
}

const isAnswered = (q, a) => {
  if (q.type === 'NUMBER') return true
  if (q.type === 'ANY') return Array.isArray(a) && a.length > 0
  return a != null && String(a).trim() !== ''
}

/**
 * The client's booking step for the chosen job: the category's common
 * questions, then that job's own. Mirrors mobile step-1's filtering
 * (utils/scopeFields on the backend) so the admin sees what clients get.
 */
export default function ClientPreview({ draft, jobRef, onJobChange }) {
  const [answers, setAnswers] = useState({})
  const [result, setResult] = useState(null)
  const jobs = draft.jobs.filter((j) => j.isActive)
  const job = jobs.find((j) => j.ref === jobRef) || jobs[0] || null

  const setAnswer = (ref, value) => {
    setAnswers((prev) => ({ ...prev, [ref]: value }))
    setResult((r) => (r && !r.ok ? { ...r, missing: r.missing.filter((m) => m !== ref) } : null))
  }

  const countQ = job && usesCount(job.model) ? countQuestionFor(draft, job) : null
  const jobQuestions = job ? job.questions : []

  let estimate = { main: '—', sub: '' }
  if (job?.model === 'CUSTOM_QUOTE') estimate = { main: 'Quote', sub: 'The worker sends a price after inspecting' }
  else if (job && !usesCount(job.model)) estimate = { main: formatPeso(job.price), sub: job.unit ? `Flat, per ${job.unit}` : 'Flat price' }
  else if (job) {
    const n = countQ ? Number(answers[countQ.ref] ?? countQ.min ?? 1) : 1
    estimate = {
      main: formatPeso(Number(job.price) * n),
      sub: countQ ? `${formatPeso(job.price)} × ${n} ${job.unit || ''}`.trim() : 'Count question missing',
    }
  }

  const onContinue = () => {
    if (!job) return
    const missing = [...draft.common, ...jobQuestions].filter((q) => q.required && !isAnswered(q, answers[q.ref]))
    setResult(
      missing.length
        ? { ok: false, missing: missing.map((q) => q.ref), text: `Answer ${missing.length} more: ${missing.map((q) => q.label).join(', ')}.` }
        : { ok: true, missing: [], text: 'All set. Next the client picks a worker, date and time.' }
    )
  }

  const missing = new Set(result?.missing || [])
  const renderList = (list) =>
    list.map((q) => (
      <PreviewQuestion
        key={q.ref}
        question={q}
        answer={answers[q.ref]}
        onAnswer={(v) => setAnswer(q.ref, v)}
        missing={missing.has(q.ref)}
      />
    ))

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
                    setResult(null)
                  }}
                  disabled={!jobs.length}
                >
                  {jobs.length ? jobs.map((j) => <option key={j.ref} value={j.ref}>{j.name || 'Untitled job'}</option>) : <option>No active jobs yet</option>}
                </select>
              </label>
              {job && (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                  {job.model === 'CUSTOM_QUOTE' ? 'Price after inspection' : `${formatPeso(job.price)}${job.unit ? ` per ${job.unit}` : ''}`}
                </div>
              )}
            </div>
            {draft.common.length > 0 && (
              <>
                <div className="sce-ph-sec">About your request</div>
                <div className="sce-ph-card">{renderList(draft.common)}</div>
              </>
            )}
            {jobQuestions.length > 0 && (
              <>
                <div className="sce-ph-sec">About this job</div>
                <div className="sce-ph-card">{renderList(jobQuestions)}</div>
              </>
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
            <button type="button" className="btn btn-primary" onClick={onContinue} disabled={!job}>Continue</button>
            {result && <div className={`sce-ph-msg ${result.ok ? 'sce-ph-msg--good' : 'sce-ph-msg--bad'}`}>{result.text}</div>}
          </div>
        </div>
      </div>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.6rem 0.25rem 0' }}>
        Shows the standard price. Each worker sets their own within the job's range.
      </p>
    </aside>
  )
}
