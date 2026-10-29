import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import IconPicker from '../components/common/IconPicker'
import { fetchServiceTypes, saveServiceCatalog, uploadServiceBackground } from '../services/serviceTypes'
import { useToast } from '../context/ToastContext'
import { getHighestDoleWageReference } from '../constants/doleWageReference'
import ClientPreview from '../components/serviceCatalog/ClientPreview'
import JobModal from '../components/serviceCatalog/JobModal'
import {
  countRange,
  draftToPayload,
  emptyDraft,
  formatPeso,
  newKey,
  serviceToDraft,
  usesCount,
  validateDraft,
} from '../components/serviceCatalog/catalogModel'
import '../components/serviceCatalog/serviceCatalogEditor.css'

// A job's price applies platform-wide (no city), so it's checked
// against the single highest regional DOLE floor, same as the backend.
const DOLE_REF = getHighestDoleWageReference()

const clone = (v) => JSON.parse(JSON.stringify(v))
const snapshotOf = (draft) => JSON.stringify(draft)

/**
 * Service Catalog → Add/Edit service: the category's details and its job
 * order matrix, saved together in one request
 * (PUT /admin/service-types/:id/catalog). The phone on the right shows what a
 * client sees after picking a job.
 */
export default function ServiceCatalogEditor() {
  const { id } = useParams()
  const isNew = !id
  const navigate = useNavigate()
  const { showSuccess, showError } = useToast()
  const [uploadingBg, setUploadingBg] = useState(false)

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [draft, setDraft] = useState(emptyDraft)
  const [baseline, setBaseline] = useState(() => snapshotOf(emptyDraft()))
  const [isActive, setIsActive] = useState(true)
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
      if (isNew) {
        const d = emptyDraft()
        setDraft(d)
        setBaseline(snapshotOf(d))
      } else {
        const service = all.find((s) => s.id === id)
        if (!service) throw new Error('This service no longer exists.')
        const d = serviceToDraft(service)
        setBaseline(snapshotOf(d))
        setDraft(d)
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

  const dirty = snapshotOf(draft) !== baseline

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
  const jobIn = (d, ref) => d.jobs.find((j) => j.ref === ref)

  const saveJob = (originalRef, values) => {
    change((d) => {
      if (originalRef) {
        Object.assign(jobIn(d, originalRef), values)
      } else {
        const job = { ...values, ref: newKey('j'), id: undefined, isActive: true }
        d.jobs.push(job)
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
      const d = serviceToDraft(saved)
      setDraft(d)
      setBaseline(snapshotOf(d))
      const previewName = draft.jobs.find((j) => j.ref === previewJob)?.name
      setPreviewJob(d.jobs.find((j) => j.name === previewName)?.ref ?? d.jobs[0]?.ref ?? null)
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
  const priceLine = (job) => {
    if (!usesCount(job.model)) {
      return (
        <div className="sce-priceline">
          <i className="fas fa-calculator" />
          <span>Flat price <b>{formatPeso(job.price)}</b>{job.unit ? ` per ${job.unit}` : ''}, the same for every worker.</span>
        </div>
      )
    }
    const range = countRange(job)
    return (
      <div className="sce-priceline">
        <i className="fas fa-calculator" />
        <span>
          Price = <b>{formatPeso(job.price)}</b> × how many {job.unit || 'units'} the client books
          {range ? ` (${range})` : ''}, the same for every worker.
        </span>
      </div>
    )
  }

  const jobRow = (job, index) => {
    const isPreviewed = previewJob === job.ref
    return (
      <div key={job.ref} className={`sce-job ${isPreviewed ? 'sce-job--open' : ''} ${job.isActive ? '' : 'sce-job--inactive'}`}>
        <div
          className="sce-job__head"
          role="button"
          tabIndex={0}
          aria-pressed={isPreviewed}
          onClick={() => setPreviewJob(job.ref)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setPreviewJob(job.ref)
            }
          }}
        >
          <i className="fas fa-chevron-right sce-chev" aria-hidden="true" />
          <span className="sce-job__name">
            {job.name}
            {job.allowsFollowUp && (
              <span className="sce-chip" style={{ marginLeft: '0.5rem' }} title="Allows a follow-up job">
                Follow-up
              </span>
            )}
          </span>
          <span className="sce-job__unit">{job.unit ? `per ${job.unit}` : '—'}</span>
          <span className="sce-job__price sce-r">{Number(job.price) > 0 ? formatPeso(job.price) : 'No price'}</span>
          <span className="sce-job__qs sce-r">
            {!job.isActive ? (
              <span className="sce-chip sce-chip--off">Inactive</span>
            ) : usesCount(job.model) ? (
              <span className="sce-chip">{countRange(job) || 'Any count'}</span>
            ) : (
              <span className="sce-chip">Flat</span>
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
        {isPreviewed && <div className="sce-job__body">{priceLine(job)}</div>}
      </div>
    )
  }

  // --- modal wiring -------------------------------------------------------------
  let modalEl = null
  if (modal?.kind === 'job') {
    const job = modal.jobRef ? jobIn(draft, modal.jobRef) : null
    modalEl = (
      <JobModal
        initial={job}
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
        subtitle="Set up the job order matrix and each job's price."
        actions={(
          <Link to="/service-catalog" className="btn btn-outline" onClick={onBack}>
            <i className="fas fa-arrow-left" /> Back to catalog
          </Link>
        )}
      />

      <div className="sce-layout">
        <div className="sce-stack">
          <section className="sce-card">
            <div className="sce-card__head">
              <div>
                <h2>Details</h2>
                <p>{isNew ? 'Name the category, then add its jobs.' : isActive ? 'Active. Clients can book this category.' : 'Inactive. Clients can’t book this category.'}</p>
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
              <div className="sce-field sce-span">
                <span>Background photo (optional)</span>
                {d.backgroundImageUrl && (
                  <img src={d.backgroundImageUrl} alt="Service background" style={{ width: 240, height: 120, objectFit: 'cover', borderRadius: 8, filter: 'blur(2px)' }} />
                )}
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={uploadingBg}
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (!file) return
                      setUploadingBg(true)
                      try {
                        const url = await uploadServiceBackground(file)
                        change((x) => { x.details.backgroundImageUrl = url })
                      } catch (err) {
                        showError(err.message || 'Upload failed')
                      } finally {
                        setUploadingBg(false)
                      }
                    }}
                  />
                  {d.backgroundImageUrl && (
                    <button type="button" className="btn btn-outline" onClick={() => change((x) => { x.details.backgroundImageUrl = null })}>
                      Remove
                    </button>
                  )}
                </div>
                <small style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  {uploadingBg ? 'Uploading...' : 'A photo related to this service. The app shows it slightly blurred behind the list of workers. Saved when you save the service.'}
                </small>
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
              {draft.jobs.length} job{draft.jobs.length === 1 ? '' : 's'}
            </div>
          </section>

          <section className="sce-card">
            <div className="sce-card__head">
              <div>
                <h2>Jobs</h2>
                <p>The job order matrix. Pick a job to see it in the client preview.</p>
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
                <span className="sce-r">Count</span>
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

