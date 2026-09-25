import { useEffect, useMemo, useState } from 'react'
import PageHeader from '../components/common/PageHeader'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { useToast } from '../context/ToastContext'
import { fetchServiceTypes } from '../services/serviceTypes'
import {
  fetchPromoBanners,
  createPromoBanner,
  updatePromoBanner,
  deletePromoBanner,
  reorderPromoBanners,
  uploadPromoBannerImage,
} from '../services/promoBanners'

const TITLE_MAX = 60
const SUBTITLE_MAX = 120
const EMPTY_FORM = { title: '', subtitle: '', imageUrl: '', linkServiceTypeId: '', startsAt: '', endsAt: '', isActive: true }

// What the client app does with a banner right now.
function bannerStatus(banner, now = new Date()) {
  if (!banner.isActive) return { key: 'hidden', label: 'Hidden' }
  if (banner.endsAt && new Date(banner.endsAt) <= now) return { key: 'ended', label: 'Ended' }
  if (banner.startsAt && new Date(banner.startsAt) > now) return { key: 'scheduled', label: 'Scheduled' }
  return { key: 'live', label: 'Live' }
}

// <input type="datetime-local"> works in local time without a zone.
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null)

function formatWhen(iso) {
  return new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** How the banner will look on the client home screen (same text-over-image style). */
function BannerPreview({ imageUrl, title, subtitle }) {
  return (
    <div className="promo-preview" style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}>
      {!imageUrl && <span className="promo-preview__placeholder"><i className="fas fa-image" /> Upload an image</span>}
      <div className="promo-preview__text">
        <div className="promo-preview__title">{title || 'Banner title'}</div>
        {subtitle && <div className="promo-preview__subtitle">{subtitle}</div>}
      </div>
    </div>
  )
}

function BannerForm({ initial, serviceTypes, onCancel, onSaved }) {
  const { showError } = useToast()
  const [form, setForm] = useState(() =>
    initial
      ? {
          title: initial.title,
          subtitle: initial.subtitle ?? '',
          imageUrl: initial.imageUrl,
          linkServiceTypeId: initial.linkServiceTypeId ?? '',
          startsAt: toLocalInput(initial.startsAt),
          endsAt: toLocalInput(initial.endsAt),
          isActive: initial.isActive,
        }
      : EMPTY_FORM,
  )
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const handleImage = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadPromoBannerImage(file)
      setForm((f) => ({ ...f, imageUrl: url }))
    } catch (err) {
      showError(err.message || 'Image upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = {
        title: form.title,
        subtitle: form.subtitle || null,
        imageUrl: form.imageUrl,
        linkServiceTypeId: form.linkServiceTypeId || null,
        startsAt: fromLocalInput(form.startsAt),
        endsAt: fromLocalInput(form.endsAt),
        isActive: form.isActive,
      }
      const saved = initial ? await updatePromoBanner(initial.id, payload) : await createPromoBanner(payload)
      onSaved(saved, !initial)
    } catch (err) {
      showError(err.message || 'Could not save the banner')
    } finally {
      setSaving(false)
    }
  }

  const canSave = form.title.trim() && form.imageUrl && !uploading && !saving

  return (
    <div className="modal-backdrop" onClick={onCancel} role="presentation">
      <form className="modal modal--landscape promo-form" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit} role="dialog" aria-modal="true" aria-labelledby="promo-form-title">
        <h2 className="modal-title" id="promo-form-title">{initial ? 'Edit banner' : 'New banner'}</h2>

        <BannerPreview imageUrl={form.imageUrl} title={form.title} subtitle={form.subtitle} />
        <label className="btn btn-outline btn-sm promo-form__upload">
          <i className={`fas ${uploading ? 'fa-spinner fa-spin' : 'fa-upload'}`} />
          {uploading ? 'Uploading…' : form.imageUrl ? 'Replace image' : 'Upload image'}
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImage} hidden disabled={uploading} />
        </label>
        <p className="form-hint">Wide images work best (about 3:1, e.g. 1200 × 400). JPEG, PNG or WebP, up to 5 MB.</p>

        <div className="promo-form__grid">
          <div className="form-field">
            <label htmlFor="promo-title">Title</label>
            <input id="promo-title" value={form.title} onChange={set('title')} maxLength={TITLE_MAX} required placeholder="e.g. Rainy-season deep clean" />
          </div>
          <div className="form-field">
            <label htmlFor="promo-subtitle">Subtitle (optional)</label>
            <input id="promo-subtitle" value={form.subtitle} onChange={set('subtitle')} maxLength={SUBTITLE_MAX} placeholder="One short line" />
          </div>
          <div className="form-field">
            <label htmlFor="promo-link">Opens (optional)</label>
            <select id="promo-link" value={form.linkServiceTypeId} onChange={set('linkServiceTypeId')}>
              <option value="">Nothing, display only</option>
              {serviceTypes.map((st) => (
                <option key={st.id} value={st.id}>{st.name}</option>
              ))}
            </select>
          </div>
          <label className="promo-form__toggle">
            <input type="checkbox" checked={form.isActive} onChange={set('isActive')} />
            Show in the app
          </label>
          <div className="form-field">
            <label htmlFor="promo-starts">Starts (optional)</label>
            <input id="promo-starts" type="datetime-local" value={form.startsAt} onChange={set('startsAt')} />
          </div>
          <div className="form-field">
            <label htmlFor="promo-ends">Ends (optional)</label>
            <input id="promo-ends" type="datetime-local" value={form.endsAt} onChange={set('endsAt')} />
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!canSave}>
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Create banner'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default function PromoBanners() {
  const { showSuccess, showError } = useToast()
  const [banners, setBanners] = useState(null)
  const [serviceTypes, setServiceTypes] = useState([])
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null) // null | 'new' | banner
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = async () => {
    setError(null)
    try {
      const [list, types] = await Promise.all([fetchPromoBanners(), fetchServiceTypes().catch(() => [])])
      setBanners(list)
      setServiceTypes(types ?? [])
    } catch (err) {
      setError(err.message || 'Failed to load banners')
    }
  }

  useEffect(() => {
    load()
  }, [])

  const categoryName = useMemo(() => Object.fromEntries(serviceTypes.map((st) => [st.id, st.name])), [serviceTypes])

  const move = async (index, delta) => {
    const next = [...banners]
    const [item] = next.splice(index, 1)
    next.splice(index + delta, 0, item)
    const previous = banners
    setBanners(next)
    try {
      await reorderPromoBanners(next.map((b) => b.id))
    } catch (err) {
      setBanners(previous)
      showError(err.message || 'Could not reorder')
    }
  }

  const toggleActive = async (banner) => {
    setBusyId(banner.id)
    try {
      const saved = await updatePromoBanner(banner.id, { isActive: !banner.isActive })
      setBanners((list) => list.map((b) => (b.id === saved.id ? saved : b)))
    } catch (err) {
      showError(err.message || 'Could not update the banner')
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async () => {
    const banner = confirmDelete
    setConfirmDelete(null)
    setBusyId(banner.id)
    try {
      await deletePromoBanner(banner.id)
      setBanners((list) => list.filter((b) => b.id !== banner.id))
      showSuccess('Banner deleted')
    } catch (err) {
      showError(err.message || 'Could not delete the banner')
    } finally {
      setBusyId(null)
    }
  }

  const handleSaved = (saved, isNew) => {
    setBanners((list) => (isNew ? [...list, saved] : list.map((b) => (b.id === saved.id ? saved : b))))
    setEditing(null)
    showSuccess(isNew ? 'Banner created' : 'Banner saved')
  }

  if (error && !banners) return <ErrorState message={error} onRetry={load} />

  return (
    <>
      <PageHeader
        title="Promo Banners"
        subtitle="The carousel at the top of the client app's home screen. Live banners show in this order; with none live, the carousel is hidden."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')} disabled={!banners}>
            <i className="fas fa-plus" /> New banner
          </button>
        }
      />

      {!banners ? (
        <LoadingState message="Loading banners..." rows={3} />
      ) : banners.length === 0 ? (
        <div className="promo-empty">
          <i className="fas fa-images" />
          <p>No banners yet. The client home screen shows no carousel until you add one.</p>
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>Create the first banner</button>
        </div>
      ) : (
        <ul className="promo-list">
          {banners.map((banner, index) => {
            const status = bannerStatus(banner)
            return (
              <li key={banner.id} className={`promo-row ${busyId === banner.id ? 'is-busy' : ''}`}>
                <div className="promo-row__order">
                  <button type="button" className="icon-btn" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${banner.title} up`}>
                    <i className="fas fa-chevron-up" />
                  </button>
                  <span>{index + 1}</span>
                  <button type="button" className="icon-btn" onClick={() => move(index, 1)} disabled={index === banners.length - 1} aria-label={`Move ${banner.title} down`}>
                    <i className="fas fa-chevron-down" />
                  </button>
                </div>
                <div className="promo-row__thumb" style={{ backgroundImage: `url(${banner.imageUrl})` }} />
                <div className="promo-row__info">
                  <div className="promo-row__title">
                    {banner.title}
                    <span className={`promo-status promo-status--${status.key}`}>{status.label}</span>
                  </div>
                  {banner.subtitle && <div className="text-muted text-small">{banner.subtitle}</div>}
                  <div className="promo-row__meta">
                    <span><i className="fas fa-link" /> {banner.linkServiceTypeId ? (categoryName[banner.linkServiceTypeId] ?? 'Missing category') : 'Display only'}</span>
                    {(banner.startsAt || banner.endsAt) && (
                      <span>
                        <i className="fas fa-calendar" /> {banner.startsAt ? formatWhen(banner.startsAt) : 'Now'} – {banner.endsAt ? formatWhen(banner.endsAt) : 'no end'}
                      </span>
                    )}
                  </div>
                </div>
                <div className="promo-row__actions">
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => toggleActive(banner)}>
                    <i className={`fas ${banner.isActive ? 'fa-eye-slash' : 'fa-eye'}`} /> {banner.isActive ? 'Hide' : 'Show'}
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(banner)}>
                    <i className="fas fa-pen" /> Edit
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(banner)} aria-label={`Delete ${banner.title}`}>
                    <i className="fas fa-trash" />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {editing && (
        <BannerForm
          initial={editing === 'new' ? null : editing}
          serviceTypes={serviceTypes}
          onCancel={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => setConfirmDelete(null)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
            <h2 className="modal-title">Delete “{confirmDelete.title}”?</h2>
            <p className="modal-body">It disappears from the app right away and its image is removed. To take it down temporarily, use Hide instead.</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button type="button" className="btn btn-danger" onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
