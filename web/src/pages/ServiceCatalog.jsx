import { useEffect, useMemo, useState } from 'react'
import PageHeader from '../components/common/PageHeader'
import SectionCard from '../components/common/SectionCard'
import SearchBar from '../components/common/SearchBar'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import {
  fetchServiceTypes,
  createServiceType,
  updateServiceType,
  toggleServiceTypeActive,
} from '../services/serviceTypes'
import { useToast } from '../context/ToastContext'

const FIELD_TYPE_LABELS = {
  TEXT: 'Text',
  SELECT: 'Single choice',
  MULTI_SELECT: 'Multiple choice',
}

function formatPeso(amount) {
  const num = typeof amount === 'number' ? amount : Number(amount)
  if (Number.isNaN(num)) return '—'
  return `₱${num.toLocaleString()}`
}

function emptyField() {
  return { label: '', fieldType: 'TEXT', required: true, options: [] }
}

function emptyForm() {
  return {
    name: '',
    description: '',
    basePrice: '',
    scopeType: 'ROOM_BASED',
    hasCondition: true,
    fields: [],
  }
}

function serviceToForm(service) {
  return {
    name: service.name,
    description: service.description || '',
    basePrice: String(service.basePrice),
    scopeType: service.scopeType,
    hasCondition: service.hasCondition,
    fields: (service.scopeFields || []).map((f) => ({
      label: f.label,
      fieldType: f.fieldType,
      required: f.required,
      options: (f.options || []).map((o) => o.label),
    })),
  }
}

export default function ServiceCatalog() {
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [query, setQuery] = useState('')

  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState('add') // 'add' | 'edit'
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [togglingId, setTogglingId] = useState(null)
  const { showSuccess, showError } = useToast()

  const loadServices = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await fetchServiceTypes()
      setServices(data)
    } catch (err) {
      setLoadError(err.message || 'Failed to load service catalog')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadServices()
  }, [])

  const filteredServices = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return services
    return services.filter((s) => s.name.toLowerCase().includes(q))
  }, [services, query])

  const closeModal = () => {
    setOpen(false)
    setMode('add')
    setEditingId(null)
    setForm(emptyForm())
    setError('')
  }

  const openAdd = () => {
    setMode('add')
    setEditingId(null)
    setForm(emptyForm())
    setError('')
    setOpen(true)
  }

  const openEdit = (service) => {
    setMode('edit')
    setEditingId(service.id)
    setForm(serviceToForm(service))
    setError('')
    setOpen(true)
  }

  const addField = () => {
    setForm((p) => ({ ...p, fields: [...p.fields, emptyField()] }))
  }

  const removeField = (index) => {
    setForm((p) => ({ ...p, fields: p.fields.filter((_, i) => i !== index) }))
  }

  const updateField = (index, patch) => {
    setForm((p) => ({
      ...p,
      fields: p.fields.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    }))
  }

  const addOption = (fieldIndex) => {
    setForm((p) => ({
      ...p,
      fields: p.fields.map((f, i) => (i === fieldIndex ? { ...f, options: [...f.options, ''] } : f)),
    }))
  }

  const updateOption = (fieldIndex, optionIndex, value) => {
    setForm((p) => ({
      ...p,
      fields: p.fields.map((f, i) =>
        i === fieldIndex ? { ...f, options: f.options.map((o, oi) => (oi === optionIndex ? value : o)) } : f
      ),
    }))
  }

  const removeOption = (fieldIndex, optionIndex) => {
    setForm((p) => ({
      ...p,
      fields: p.fields.map((f, i) =>
        i === fieldIndex ? { ...f, options: f.options.filter((_, oi) => oi !== optionIndex) } : f
      ),
    }))
  }

  const onSave = async (e) => {
    e.preventDefault()
    setError('')

    const name = form.name.trim()
    const basePrice = Number(form.basePrice)

    if (!name) return setError('Name is required.')
    if (!Number.isFinite(basePrice) || basePrice < 0) return setError('Base price must be a non-negative number.')

    if (form.scopeType === 'CUSTOM') {
      if (form.fields.length === 0) return setError('Add at least one custom field, or switch to Room-based.')
      for (const f of form.fields) {
        if (!f.label.trim()) return setError('Every custom field needs a label.')
        if ((f.fieldType === 'SELECT' || f.fieldType === 'MULTI_SELECT') && f.options.filter((o) => o.trim()).length === 0) {
          return setError(`Field "${f.label}" needs at least one option.`)
        }
      }
    }

    const payload = {
      name,
      description: form.description.trim() || undefined,
      basePrice,
      scopeType: form.scopeType,
      hasCondition: form.hasCondition,
      scopeFields:
        form.scopeType === 'CUSTOM'
          ? form.fields.map((f) => ({
              label: f.label.trim(),
              fieldType: f.fieldType,
              required: f.required,
              options: f.options.map((o) => o.trim()).filter(Boolean),
            }))
          : undefined,
    }

    setSaving(true)
    try {
      if (mode === 'add') {
        const created = await createServiceType(payload)
        setServices((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
        showSuccess('Service added.')
      } else {
        const updated = await updateServiceType(editingId, payload)
        setServices((prev) => prev.map((s) => (s.id === editingId ? updated : s)))
        showSuccess('Service updated.')
      }
      closeModal()
    } catch (err) {
      setError(err.message || 'Failed to save service')
    } finally {
      setSaving(false)
    }
  }

  const onToggleActive = async (service) => {
    setTogglingId(service.id)
    try {
      const updated = await toggleServiceTypeActive(service.id, !service.isActive)
      setServices((prev) => prev.map((s) => (s.id === service.id ? updated : s)))
      showSuccess(updated.isActive ? 'Service activated.' : 'Service deactivated.')
    } catch (err) {
      showError(err.message || 'Failed to update service')
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Service Catalog"
        subtitle="Register services and configure what the booking flow asks clients for each one."
        actions={(
          <button type="button" className="btn btn-primary" onClick={openAdd}>
            <i className="fas fa-plus" /> Add Service
          </button>
        )}
      />

      <div className="toolbar">
        <SearchBar placeholder="Search services..." value={query} onChange={setQuery} />
      </div>

      <SectionCard title="Services">
        {loading && <LoadingState message="Loading service catalog..." />}
        {loadError && <ErrorState message={loadError} onRetry={loadServices} />}
        {!loading && !loadError && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Base Price (₱)</th>
                  <th>Scope</th>
                  <th>Condition Question</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredServices.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.name}</strong></td>
                    <td>{formatPeso(s.basePrice)}</td>
                    <td>
                      <span className={`badge ${s.scopeType === 'CUSTOM' ? 'badge-pending' : 'badge-approved'}`}>
                        {s.scopeType === 'CUSTOM' ? 'Custom fields' : 'Room-based'}
                      </span>
                    </td>
                    <td>{s.hasCondition ? 'Yes' : 'No'}</td>
                    <td>
                      <span className={`badge ${s.isActive ? 'badge-active' : 'badge-suspended'}`}>
                        {s.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="action-btn view"
                          title="Edit"
                          aria-label={`Edit ${s.name}`}
                          onClick={() => openEdit(s)}
                        >
                          <i className="fas fa-pen" />
                        </button>
                        <button
                          type="button"
                          className="action-btn"
                          title={s.isActive ? 'Deactivate' : 'Activate'}
                          aria-label={`${s.isActive ? 'Deactivate' : 'Activate'} ${s.name}`}
                          disabled={togglingId === s.id}
                          onClick={() => onToggleActive(s)}
                        >
                          <i className={`fas ${s.isActive ? 'fa-ban' : 'fa-check'}`} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredServices.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ color: 'var(--text-muted)', padding: '1rem' }}>
                      No services found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {open && (
        <div className="modal-backdrop" onClick={closeModal} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">{mode === 'add' ? 'Add Service' : 'Edit Service'}</h2>
            <p className="modal-body">
              Register a service and decide what the booking flow asks clients for it.
            </p>

            <form onSubmit={onSave} className="auth-form" style={{ gap: '0.75rem' }}>
              <div className="form-field">
                <label htmlFor="sc-name">Name</label>
                <input
                  id="sc-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Appliance Repair"
                />
              </div>

              <div className="form-field">
                <label htmlFor="sc-description">Description</label>
                <input
                  id="sc-description"
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Shown to clients when browsing services"
                />
              </div>

              <div className="form-field">
                <label htmlFor="sc-price">Base Price (₱)</label>
                <input
                  id="sc-price"
                  type="number"
                  min="0"
                  value={form.basePrice}
                  onChange={(e) => setForm((p) => ({ ...p, basePrice: e.target.value }))}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 8 }}
                />
              </div>

              <div className="form-field">
                <label htmlFor="sc-scope-type">Booking scope</label>
                <select
                  id="sc-scope-type"
                  value={form.scopeType}
                  onChange={(e) => setForm((p) => ({ ...p, scopeType: e.target.value }))}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 8 }}
                >
                  <option value="ROOM_BASED">Room-based (client picks rooms, e.g. Cleaning)</option>
                  <option value="CUSTOM">Custom fields (e.g. Appliance Repair, Pest Control)</option>
                </select>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={form.hasCondition}
                  onChange={(e) => setForm((p) => ({ ...p, hasCondition: e.target.checked }))}
                />
                Ask client for job condition (Tidy/Normal/Heavy)
              </label>

              {form.scopeType === 'CUSTOM' && (
                <div className="form-field">
                  <label>Custom fields</label>
                  {form.fields.map((field, fieldIndex) => (
                    <div
                      key={fieldIndex}
                      style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.75rem', marginBottom: '0.5rem' }}
                    >
                      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <input
                          type="text"
                          value={field.label}
                          onChange={(e) => updateField(fieldIndex, { label: e.target.value })}
                          placeholder="Field label, e.g. Appliance Type"
                          style={{ flex: 1, padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 8 }}
                        />
                        <select
                          value={field.fieldType}
                          onChange={(e) => updateField(fieldIndex, { fieldType: e.target.value })}
                          style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 8 }}
                        >
                          {Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                        <button type="button" className="action-btn" title="Remove field" onClick={() => removeField(fieldIndex)}>
                          <i className="fas fa-trash" />
                        </button>
                      </div>

                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(e) => updateField(fieldIndex, { required: e.target.checked })}
                        />
                        Required
                      </label>

                      {(field.fieldType === 'SELECT' || field.fieldType === 'MULTI_SELECT') && (
                        <div>
                          {field.options.map((option, optionIndex) => (
                            <div key={optionIndex} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem' }}>
                              <input
                                type="text"
                                value={option}
                                onChange={(e) => updateOption(fieldIndex, optionIndex, e.target.value)}
                                placeholder="Option label"
                                style={{ flex: 1, padding: '0.4rem 0.6rem', border: '1px solid var(--border)', borderRadius: 8 }}
                              />
                              <button
                                type="button"
                                className="action-btn"
                                title="Remove option"
                                onClick={() => removeOption(fieldIndex, optionIndex)}
                              >
                                <i className="fas fa-xmark" />
                              </button>
                            </div>
                          ))}
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => addOption(fieldIndex)}>
                            <i className="fas fa-plus" /> Add option
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  <button type="button" className="btn btn-outline btn-sm" onClick={addField}>
                    <i className="fas fa-plus" /> Add field
                  </button>
                </div>
              )}

              {error && <div className="form-error">{error}</div>}

              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={closeModal}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving...' : mode === 'add' ? 'Add' : 'Update'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
