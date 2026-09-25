import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import IconPicker from '../components/common/IconPicker'
import { fetchServiceTypes, saveServiceCatalog } from '../services/serviceTypes'
import { useToast } from '../context/ToastContext'
import { getHighestDoleWageReference } from '../constants/doleWageReference'
import ClientPreview from '../components/serviceCatalog/ClientPreview'
import QuestionModal from '../components/serviceCatalog/QuestionModal'
import JobModal from '../components/serviceCatalog/JobModal'
import {
  QUESTION_TYPES,
  buildLibrary,
  countQuestionFor,
  draftToPayload,
  emptyDraft,
  formatPeso,
  isChoiceType,
  newKey,
  serviceToDraft,
  usesCount,
  validateDraft,
} from '../components/serviceCatalog/catalogModel'
import '../components/serviceCatalog/serviceCatalogEditor.css'

// ServiceTask.minPrice applies platform-wide (no city), so it's checked
// against the single highest regional DOLE floor, same as the backend.
const DOLE_REF = getHighestDoleWageReference()

const clone = (v) => JSON.parse(JSON.stringify(v))
const snapshotOf = (draft) => JSON.stringify({ ...draft, splitCount: 0 })

/**
 * Service Catalog → Add/Edit service: the category's details, its job order
 * matrix, and each job's own booking questions, saved together in one
 * request (PUT /admin/service-types/:id/catalog). The phone on the right
 * shows what a client sees after picking a job.
 */
export default function ServiceCatalogEditor() {
  const { id } = useParams()
  const isNew = !id
  const navigate = useNavigate()
  const { showSuccess } = useToast()

  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [draft, setDraft] = useState(emptyDraft)
  const [baseline, setBaseline] = useState(() => snapshotOf(emptyDraft()))
  const [isActive, setIsActive] = useState(true)
  const [open, setOpen] = useState(() => new Set())
  const [previewJob, setPreviewJob] = useState(null)
  const [modal, setModal] = useState(null)
  const [undo, setUndo] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const undoTimer = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const all = await fetchServiceTypes()
      setServices(all)
      if (isNew) {
        const d = emptyDraft()
        setDraft(d)
        setBaseline(snapshotOf(d))
      } else {
        const service = all.find((s) => s.id === id)
        if (!service) throw new Error('This service no longer exists.')
        const d = serviceToDraft(service)
        setDraft(d)
        setBaseline(snapshotOf(d))
        setIsActive(service.isActive)
        setPreviewJob(d.jobs.find((j) => j.isActive)?.ref ?? null)
      }
    } catch (err) {
      setLoadError(err.message || 'Failed to load the service catalog')
    } finally {
      setLoading(false)
    }
  }, [id, isNew])

  useEffect(() => {
    load()
  }, [load])

  const dirty = snapshotOf(draft) !== baseline || draft.splitCount > 0

  useEffect(() => {
    if (!dirty) return undefined
    const warn = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  useEffect(() => () => clearTimeout(undoTimer.current), [])

  const library = useMemo(() => buildLibrary(services, draft), [services, draft])

  // --- draft updates ------------------------------------------------------
  // Edits come from discrete clicks, so applying them to the current draft
  // (not a functional updater) is safe, and keeps newKey() calls out of an
  // updater React may run twice.
  const change = (fn) => {
    setSaveError('')
    const next = clone(draft)
    fn(next)
    setDraft(next)
  }
  const withUndo = (text, fn) => {
    const before = clone(draft)
    change(fn)
    clearTimeout(undoTimer.current)
    setUndo({ text, before })
    undoTimer.current = setTimeout(() => setUndo(null), 7000)
  }
  const listIn = (d, scope) => (scope === 'common' ? d.common : d.jobs.find((j) => j.ref === scope).questions)
  const jobIn = (d, ref) => d.jobs.find((j) => j.ref === ref)

  const saveQuestion = (scope, originalRef, question, setsPrice) => {
    change((d) => {
      const list = listIn(d, scope)
      const ref = originalRef || newKey('q')
      const next = { ...question, ref }
      if (originalRef) list[list.findIndex((q) => q.ref === originalRef)] = next
      else list.push(next)
      if (scope !== 'common') {
        const job = jobIn(d, scope)
        if (setsPrice) {
          job.quantityRef = ref
          if (!usesCount(job.model)) {
            job.model = 'PER_UNIT'
            if (!job.unit || job.unit === 'job') job.unit = 'unit'
          }
        } else if (job.quantityRef === ref) {
          job.quantityRef = null
        }
      }
      // A question that's no longer a Number can't count anything.
      if (question.type !== 'NUMBER') d.jobs.forEach((j) => j.quantityRef === ref && (j.quantityRef = null))
    })
    if (scope !== 'common') setPreviewJob(scope)
    setModal(null)
  }

  const deleteQuestion = (scope, ref) => {
    const q = listIn(draft, scope).find((x) => x.ref === ref)
    withUndo(`Deleted “${q.label}”.`, (d) => {
      const list = listIn(d, scope)
      list.splice(list.findIndex((x) => x.ref === ref), 1)
      d.jobs.forEach((j) => j.quantityRef === ref && (j.quantityRef = null))
    })
  }

  const moveQuestion = (scope, ref, delta) =>
    change((d) => {
      const list = listIn(d, scope)
      const i = list.findIndex((q) => q.ref === ref)
      const k = i + delta
      if (k < 0 || k >= list.length) return
      ;[list[i], list[k]] = [list[k], list[i]]
    })

  const copyQuestions = (targetRef, sourceRef) => {
    const source = jobIn(draft, sourceRef)
    withUndo(`Copied ${source.questions.length} question${source.questions.length === 1 ? '' : 's'} from “${source.name}”. Edit or delete any that don't fit.`, (d) => {
      const target = jobIn(d, targetRef)
      const src = jobIn(d, sourceRef)
      const taken = new Set([...d.common, ...target.questions].map((q) => q.label.trim().toLowerCase()))
      for (const q of src.questions) {
        if (taken.has(q.label.trim().toLowerCase())) continue
        const copy = { ...clone(q), ref: newKey('q'), id: undefined, sourceId: undefined }
        target.questions.push(copy)
        if (src.quantityRef === q.ref && usesCount(target.model) && !target.quantityRef) target.quantityRef = copy.ref
      }
    })
    setPreviewJob(targetRef)
  }

  const saveJob = (originalRef, values) => {
    change((d) => {
      if (originalRef) {
        Object.assign(jobIn(d, originalRef), values)
      } else {
        const job = { ...values, ref: newKey('j'), id: undefined, isActive: true, questions: [] }
        d.jobs.push(job)
        setOpen((prev) => new Set(prev).add(job.ref))
        setPreviewJob(job.ref)
      }
    })
    setModal(null)
  }

  const removeOrToggleJob = (job) => {
    if (!job.id) {
      withUndo(`Removed “${job.name}”.`, (d) => {
        d.jobs.splice(d.jobs.findIndex((j) => j.ref === job.ref), 1)
      })
      return
    }
    change((d) => {
      jobIn(d, job.ref).isActive = !job.isActive
    })
  }

  const moveJob = (ref, delta) =>
    change((d) => {
      const i = d.jobs.findIndex((j) => j.ref === ref)
      const k = i + delta
      if (k < 0 || k >= d.jobs.length) return
      ;[d.jobs[i], d.jobs[k]] = [d.jobs[k], d.jobs[i]]
    })

  const toggleOpen = (ref) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(ref)) next.delete(ref)
      else {
        next.add(ref)
        setPreviewJob(ref)
      }
      return next
    })
  }

  // --- save -----------------------------------------------------------------
  const onSave = async () => {
    const problem = validateDraft(draft, DOLE_REF.hourlyWage)
    if (problem) {
      setSaveError(problem)
      return
    }
    setSaving(true)
    setSaveError('')
    try {
      const saved = await saveServiceCatalog(isNew ? null : id, draftToPayload(draft))
      const openNames = new Set(draft.jobs.filter((j) => open.has(j.ref)).map((j) => j.name))
      const d = serviceToDraft(saved)
      setDraft(d)
      setBaseline(snapshotOf(d))
      setOpen(new Set(d.jobs.filter((j) => openNames.has(j.name)).map((j) => j.ref)))
      const previewName = draft.jobs.find((j) => j.ref === previewJob)?.name
      setPreviewJob(d.jobs.find((j) => j.name === previewName)?.ref ?? d.jobs[0]?.ref ?? null)
      setServices((prev) => [...prev.filter((s) => s.id !== saved.id), saved])
      showSuccess(isNew ? 'Service added.' : 'Service saved.')
      if (isNew) navigate(`/service-catalog/${saved.id}`, { replace: true })
    } catch (err) {
      setSaveError(err.message || 'Failed to save the service')
    } finally {
      setSaving(false)
    }
  }

  const onDiscard = () => {
    setDraft(JSON.parse(baseline))
    setSaveError('')
  }

  const onBack = (e) => {
    if (dirty && !window.confirm('Leave without saving? Your changes to this service will be lost.')) e.preventDefault()
  }

  // --- render helpers ---------------------------------------------------------
  if (loading) return <LoadingState variant="detail" message="Loading service..." />
  if (loadError) return <ErrorState message={loadError} onRetry={load} />

  const d = draft.details
  const jobQuestionCount = draft.jobs.reduce((n, j) => n + j.questions.length, 0)
  const countUsers = (ref) => draft.jobs.filter((j) => j.quantityRef === ref).length

  const questionRow = (q, index, list, scope, job) => {
    const isCount = job ? job.quantityRef === q.ref : countUsers(q.ref) > 0
    return (
      <li key={q.ref} className="sce-q">
        <span className="sce-q__n">{index + 1}</span>
        <div>
          <div className="sce-q__label">
            {q.label}
            {q.required && <span className="sce-req" aria-label="required">*</span>}
          </div>
          <div className="sce-q__meta">
            <span className="sce-chip">{QUESTION_TYPES[q.type].label}</span>
            {q.type === 'NUMBER' && <span>{q.min} to {q.max}</span>}
            {isChoiceType(q.type) && <span className="sce-choices">{q.choices.join(' · ')}</span>}
            {!q.required && <span className="sce-chip sce-chip--ghost">Optional</span>}
            {isCount && (
              <span className="sce-chip sce-chip--price">
                {job ? 'Sets the price' : `Sets the price for ${countUsers(q.ref)} job${countUsers(q.ref) === 1 ? '' : 's'}`}
              </span>
            )}
            {q.match && <span className="sce-chip sce-chip--match">Matches workers</span>}
          </div>
        </div>
        <div className="sce-q__btns">
          <button type="button" className="sce-ib" onClick={() => moveQuestion(scope, q.ref, -1)} disabled={index === 0} aria-label={`Move “${q.label}” up`}>
            <i className="fas fa-chevron-up" />
          </button>
          <button type="button" className="sce-ib" onClick={() => moveQuestion(scope, q.ref, 1)} disabled={index === list.length - 1} aria-label={`Move “${q.label}” down`}>
            <i className="fas fa-chevron-down" />
          </button>
          <button type="button" className="sce-ib" onClick={() => setModal({ kind: 'q', scope, qRef: q.ref })} aria-label={`Edit “${q.label}”`}>
            <i className="fas fa-pen" />
          </button>
          <button type="button" className="sce-ib sce-ib--danger" onClick={() => deleteQuestion(scope, q.ref)} aria-label={`Delete “${q.label}”`}>
            <i className="fas fa-trash" />
          </button>
        </div>
      </li>
    )
  }

  const questionList = (list, scope, job) =>
    list.length ? (
      <ul className="sce-qlist">{list.map((q, i) => questionRow(q, i, list, scope, job))}</ul>
    ) : (
      <div className="sce-empty">
        {scope === 'common'
          ? 'No common questions. Add one if every job needs the same answer, like the brand or who supplies parts.'
          : 'No questions yet. Add what the worker needs to know for this job.'}
      </div>
    )

  const priceLine = (job) => {
    if (job.model === 'CUSTOM_QUOTE') {
      return <div className="sce-priceline"><i className="fas fa-circle-info" /> Custom quote. The worker inspects first, then sends a price for the client to approve.</div>
    }
    if (!usesCount(job.model)) {
      return (
        <div className="sce-priceline">
          <i className="fas fa-calculator" />
          <span>Flat price <b>{formatPeso(job.price)}</b>{job.unit ? ` per ${job.unit}` : ''}. Workers charge {formatPeso(job.minPrice)}–{formatPeso(job.maxPrice)}.</span>
        </div>
      )
    }
    const count = countQuestionFor(draft, job)
    if (!count) {
      return (
        <div className="sce-priceline sce-priceline--bad">
          <i className="fas fa-triangle-exclamation" />
          <span>Priced per {job.unit || 'unit'}, but no question sets the count. Add a Number question and tick <b>This number sets the price</b>.</span>
        </div>
      )
    }
    return (
      <div className="sce-priceline">
        <i className="fas fa-calculator" />
        <span>
          Price = <b>{formatPeso(job.price)}</b> × the answer to <b>“{count.label}”</b>
          {draft.common.includes(count) ? ' (a common question)' : ''}. Workers charge {formatPeso(job.minPrice)}–{formatPeso(job.maxPrice)} per {job.unit}.
          {job.model === 'TIERED' ? ' Each worker sets their own price steps.' : ''}
        </span>
      </div>
    )
  }

  const jobRow = (job, index) => {
    const isOpen = open.has(job.ref)
    const missingCount = usesCount(job.model) && !countQuestionFor(draft, job)
    const others = draft.jobs.filter((o) => o.ref !== job.ref && o.questions.length)
    return (
      <div key={job.ref} className={`sce-job ${isOpen ? 'sce-job--open' : ''} ${job.isActive ? '' : 'sce-job--inactive'}`}>
        <div
          className="sce-job__head"
          role="button"
          tabIndex={0}
          aria-expanded={isOpen}
          onClick={() => toggleOpen(job.ref)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              toggleOpen(job.ref)
            }
          }}
        >
          <i className="fas fa-chevron-right sce-chev" aria-hidden="true" />
          <span className="sce-job__name">{job.name}</span>
          <span className="sce-job__unit">{job.unit ? `per ${job.unit}` : '—'}</span>
          <span className="sce-job__price sce-r">{job.model === 'CUSTOM_QUOTE' ? 'Quote' : formatPeso(job.price)}</span>
          <span className="sce-job__qs sce-r">
            {!job.isActive ? (
              <span className="sce-chip sce-chip--off">Inactive</span>
            ) : missingCount ? (
              <span className="sce-chip sce-chip--warn">Needs count</span>
            ) : (
              <span className="sce-chip">{job.questions.length} question{job.questions.length === 1 ? '' : 's'}</span>
            )}
          </span>
          <span className="sce-job__acts" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
            <button type="button" className="sce-ib" onClick={() => moveJob(job.ref, -1)} disabled={index === 0} aria-label={`Move ${job.name} up`}>
              <i className="fas fa-chevron-up" />
            </button>
            <button type="button" className="sce-ib" onClick={() => moveJob(job.ref, 1)} disabled={index === draft.jobs.length - 1} aria-label={`Move ${job.name} down`}>
              <i className="fas fa-chevron-down" />
            </button>
            <button type="button" className="sce-ib" onClick={() => setModal({ kind: 'job', jobRef: job.ref })} aria-label={`Edit ${job.name}`}>
              <i className="fas fa-pen" />
            </button>
            <button
              type="button"
              className={`sce-ib ${job.isActive || !job.id ? 'sce-ib--danger' : ''}`}
              onClick={() => removeOrToggleJob(job)}
              title={!job.id ? 'Remove' : job.isActive ? 'Deactivate' : 'Activate'}
              aria-label={`${!job.id ? 'Remove' : job.isActive ? 'Deactivate' : 'Activate'} ${job.name}`}
            >
              <i className={`fas ${!job.id ? 'fa-trash' : job.isActive ? 'fa-ban' : 'fa-rotate-left'}`} />
            </button>
          </span>
        </div>
        {isOpen && (
          <div className="sce-job__body">
            {priceLine(job)}
            {questionList(job.questions, job.ref, job)}
            <div className="sce-addrow">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setModal({ kind: 'q', scope: job.ref })}>
                <i className="fas fa-plus" /> Add question
              </button>
              {others.length > 0 && (
                <select
                  className="sce-input sce-input--sm"
                  value=""
                  onChange={(e) => e.target.value && copyQuestions(job.ref, e.target.value)}
                  aria-label={`Copy questions into ${job.name} from another job`}
                >
                  <option value="">Copy questions from another job…</option>
                  {others.map((o) => (
                    <option key={o.ref} value={o.ref}>{o.name} ({o.questions.length})</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // --- modal wiring -------------------------------------------------------------
  let modalEl = null
  if (modal?.kind === 'q') {
    const job = modal.scope === 'common' ? null : jobIn(draft, modal.scope)
    const initial = modal.qRef ? listIn(draft, modal.scope).find((q) => q.ref === modal.qRef) : null
    const currentCount = job ? countQuestionFor(draft, job) : null
    modalEl = (
      <QuestionModal
        initial={initial}
        job={job}
        isCount={!!job && !!initial && job.quantityRef === initial.ref}
        currentCountLabel={currentCount && currentCount.ref !== initial?.ref ? currentCount.label : null}
        library={library}
        onSave={(q, setsPrice) => saveQuestion(modal.scope, modal.qRef, q, setsPrice)}
        onClose={() => setModal(null)}
      />
    )
  } else if (modal?.kind === 'job') {
    const job = modal.jobRef ? jobIn(draft, modal.jobRef) : null
    const numberQuestions = [
      ...draft.common.filter((q) => q.type === 'NUMBER').map((q) => ({ ...q, common: true })),
      ...(job ? job.questions.filter((q) => q.type === 'NUMBER') : []),
    ]
    modalEl = (
      <JobModal
        initial={job ? { ...job, questions: undefined } : null}
        numberQuestions={numberQuestions}
        doleRef={DOLE_REF}
        onSave={(values) => saveJob(modal.jobRef, values)}
        onClose={() => setModal(null)}
      />
    )
  }

  return (
    <>
      <PageHeader
        title={isNew ? 'Add service' : `Edit service: ${d.name || 'Untitled'}`}
        subtitle="Set up the job order matrix and the booking questions for each job."
        actions={(
          <Link to="/service-catalog" className="btn btn-outline" onClick={onBack}>
            <i className="fas fa-arrow-left" /> Back to catalog
          </Link>
        )}
      />

      <div className="sce-layout">
        <div className="sce-stack">
          {draft.splitCount > 0 && (
            <div className="sce-note sce-note--warn">
              <i className="fas fa-circle-info" />
              <span>
                {draft.splitCount} question{draft.splitCount === 1 ? ' was' : 's were'} shared by several jobs. Each job now has its own
                copy, so you can edit them separately. Saving stores the copies. Worker “match” choices stay on the first job's copy only.
              </span>
            </div>
          )}

          <section className="sce-card">
            <div className="sce-card__head">
              <div>
                <h2>Details</h2>
                <p>{isNew ? 'Name the category, then add its jobs and questions.' : isActive ? 'Active. Clients can book this category.' : 'Inactive. Clients can’t book this category.'}</p>
              </div>
            </div>
            <div className="sce-details">
              <label className="sce-field">
                <span>Name</span>
                <input className="sce-input" value={d.name} onChange={(e) => change((x) => { x.details.name = e.target.value })} placeholder="e.g. Home Appliance & Aircon Repair" />
              </label>
              <label className="sce-field">
                <span>Description</span>
                <input className="sce-input" value={d.description} onChange={(e) => change((x) => { x.details.description = e.target.value })} placeholder="Shown to clients when browsing services" />
              </label>
              <label className="sce-field">
                <span>Starting price (₱)</span>
                <input className="sce-input" type="number" min="0" value={d.basePrice} onChange={(e) => change((x) => { x.details.basePrice = e.target.value })} />
                <small style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Shown on the category tile before a job is picked.</small>
              </label>
              <div className="sce-field">
                <span>Icon</span>
                <IconPicker value={d.icon} onChange={(icon) => change((x) => { x.details.icon = icon })} />
              </div>
              <label className="sce-check sce-span">
                <input type="checkbox" checked={d.requiresCertification} onChange={(e) => change((x) => { x.details.requiresCertification = e.target.checked })} />
                <span>
                  Licensed trade: requires an admin-approved certification
                  <small>A worker can't add this category until an admin approves a certification tagged to it.</small>
                </span>
              </label>
            </div>
            <div className="sce-stats">
              {draft.jobs.length} job{draft.jobs.length === 1 ? '' : 's'} · {draft.common.length} common question{draft.common.length === 1 ? '' : 's'} · {jobQuestionCount} job question{jobQuestionCount === 1 ? '' : 's'}
            </div>
          </section>

          <section className="sce-card">
            <div className="sce-card__head">
              <div>
                <h2>Common questions</h2>
                <p>Asked for every job in this category, before the job's own questions.</p>
              </div>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setModal({ kind: 'q', scope: 'common' })}>
                <i className="fas fa-plus" /> Add question
              </button>
            </div>
            <div className="sce-card__body">{questionList(draft.common, 'common', null)}</div>
          </section>

          <section className="sce-card">
            <div className="sce-card__head">
              <div>
                <h2>Jobs</h2>
                <p>The job order matrix. Open a job to set up its own questions.</p>
              </div>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setModal({ kind: 'job' })}>
                <i className="fas fa-plus" /> Add job
              </button>
            </div>
            {draft.jobs.length > 0 && (
              <div className="sce-matrix-head" aria-hidden="true">
                <span />
                <span>Job order</span>
                <span>Unit</span>
                <span className="sce-r">Price</span>
                <span className="sce-r">Questions</span>
                <span />
              </div>
            )}
            {draft.jobs.length ? draft.jobs.map(jobRow) : (
              <div className="sce-card__body"><div className="sce-empty">No jobs yet. Add the first row of the matrix.</div></div>
            )}
          </section>

          <div className="sce-savebar">
            <span className={`sce-savebar__note ${saveError ? 'is-error' : ''}`} role={saveError ? 'alert' : undefined}>
              {saveError || (dirty ? (<><span className="sce-dot" />Unsaved changes. Clients see the last saved version.</>) : 'All changes saved.')}
            </span>
            <button type="button" className="btn btn-outline" onClick={onDiscard} disabled={!dirty || saving || isNew}>Discard changes</button>
            <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving || (!dirty && !isNew)}>
              {saving ? 'Saving…' : isNew ? 'Add service' : 'Save service'}
            </button>
          </div>
        </div>

        <ClientPreview draft={draft} jobRef={previewJob} onJobChange={setPreviewJob} />
      </div>

      {modalEl}

      {undo && (
        <div className="sce-undo" role="status">
          <span>{undo.text}</span>
          <button
            type="button"
            onClick={() => {
              setDraft(undo.before)
              setUndo(null)
            }}
          >
            Undo
          </button>
        </div>
      )}
    </>
  )
}

