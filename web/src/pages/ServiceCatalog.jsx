import { useCallback, useEffect, useMemo, useState } from 'react'
import PageHeader from '../components/common/PageHeader'
import SectionCard from '../components/common/SectionCard'
import SearchBar from '../components/common/SearchBar'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import Pagination from '../components/common/Pagination'
import {
  fetchServiceTypes,
  createServiceType,
  updateServiceType,
  toggleServiceTypeActive,
} from '../services/serviceTypes'
import { fetchTasks, createTask, updateTask, toggleTaskActive } from '../services/serviceTasks'
import { useToast } from '../context/ToastContext'
import IconPicker from '../components/common/IconPicker'
import { msIconFor } from '../constants/serviceIcons'
import { useListQuery } from '../hooks/useListQuery'
import { getHighestDoleWageReference } from '../constants/doleWageReference'

const PAGE_SIZE = 10

const FIELD_TYPE_LABELS = {
  TEXT: 'Text',
  SELECT: 'Single choice',
  MULTI_SELECT: 'Multiple choice',
  NUMBER: 'Number',
}

const OPTION_FIELD_TYPES = ['SELECT', 'MULTI_SELECT']

const PRICING_MODEL_LABELS = {
  FIXED: 'Fixed',
  PER_UNIT: 'Per-unit',
  CUSTOM_QUOTE: 'Custom quote',
}

function emptyTaskForm() {
  return {
    name: '',
    description: '',
    basePrice: '',
    pricingModel: 'FIXED',
    minPrice: '',
    maxPrice: '',
    unitLabel: '',
    quantityScopeFieldId: '',
    durationHours: '',
    overrideReason: '',
  }
}

function taskToForm(task) {
  return {
    name: task.name,
    description: task.description || '',
    basePrice: String(task.basePrice),
    pricingModel: task.pricingModel,
    minPrice: task.minPrice != null ? String(task.minPrice) : '',
    maxPrice: task.maxPrice != null ? String(task.maxPrice) : '',
    unitLabel: task.unitLabel || '',
    quantityScopeFieldId: task.quantityScopeFieldId || '',
    durationHours: task.durationHours != null ? String(task.durationHours) : '',
    overrideReason: '',
  }
}

// ServiceTask.minPrice/maxPrice applies platform-wide (no city, unlike
// PricingRule) — checked against the single highest regional DOLE floor, so
// there's no per-city lookup needed here, just this one reference value.
const HIGHEST_DOLE_REF = getHighestDoleWageReference()

function formatPeso(amount) {
  const num = typeof amount === 'number' ? amount : Number(amount)
  if (Number.isNaN(num)) return '—'
  return `₱${num.toLocaleString()}`
}

function emptyField() {
  return { label: '', fieldType: 'TEXT', required: true, options: [], minValue: '', maxValue: '', usedForMatching: false }
}

function emptyForm() {
  return {
    name: '',
    description: '',
    basePrice: '',
    icon: null,
    requiresCertification: false,
    fields: [],
  }
}

function serviceToForm(service) {
  return {
    name: service.name,
    description: service.description || '',
    basePrice: String(service.basePrice),
    icon: service.icon || null,
    requiresCertification: !!service.requiresCertification,
    fields: (service.scopeFields || []).map((f) => ({
      label: f.label,
      fieldType: f.fieldType,
      required: f.required,
      options: (f.options || []).map((o) => o.label),
      minValue: f.minValue != null ? String(f.minValue) : '',
      maxValue: f.maxValue != null ? String(f.maxValue) : '',
      usedForMatching: !!f.usedForMatching,
    })),
  }
}

export default function ServiceCatalog() {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState('add') // 'add' | 'edit'
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [togglingId, setTogglingId] = useState(null)
  const { showSuccess, showError } = useToast()

  // Tasks modal — opened per service-type row, lists that category's tasks
  // and hosts the add/edit task form (a second nested view within the same
  // modal, mirroring how the service form above toggles add/edit in place).
  const [tasksService, setTasksService] = useState(null)
  const [tasks, setTasks] = useState([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [tasksError, setTasksError] = useState('')
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  const [taskFormMode, setTaskFormMode] = useState('add')
  const [editingTaskId, setEditingTaskId] = useState(null)
  const [taskForm, setTaskForm] = useState(emptyTaskForm())
  const [taskFormError, setTaskFormError] = useState('')
  const [taskSaving, setTaskSaving] = useState(false)
  const [togglingTaskId, setTogglingTaskId] = useState(null)

  const fetchFn = useCallback(() => fetchServiceTypes(), [])
  const { data: services, loading, error: loadError, reload: loadServices, setData: setServices } = useListQuery(fetchFn)

  const filteredServices = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return services
    return services.filter((s) => s.name.toLowerCase().includes(q))
  }, [services, query])

  useEffect(() => {
    setPage(1)
  }, [query])

  const totalPages = Math.max(1, Math.ceil(filteredServices.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pagedServices = filteredServices.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

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
      fields: p.fields.map((f, i) => {
        if (i !== index) return f
        const next = { ...f, ...patch }
        // Matching only makes sense against a fixed option set, and min/max
        // only against a number — clear whichever no longer applies when the
        // field type changes.
        if (!OPTION_FIELD_TYPES.includes(next.fieldType)) next.usedForMatching = false
        if (next.fieldType !== 'NUMBER') {
          next.minValue = ''
          next.maxValue = ''
        }
        return next
      }),
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

    for (const f of form.fields) {
      if (!f.label.trim()) return setError('Every field needs a label.')
      if (OPTION_FIELD_TYPES.includes(f.fieldType) && f.options.filter((o) => o.trim()).length === 0) {
        return setError(`Field "${f.label}" needs at least one option.`)
      }
      if (f.fieldType === 'NUMBER' && f.minValue !== '' && f.maxValue !== '' && Number(f.minValue) > Number(f.maxValue)) {
        return setError(`Field "${f.label}"'s minimum can't be greater than its maximum.`)
      }
    }

    const payload = {
      name,
      description: form.description.trim() || undefined,
      basePrice,
      icon: form.icon,
      requiresCertification: form.requiresCertification,
      scopeFields: form.fields.map((f) => ({
        label: f.label.trim(),
        fieldType: f.fieldType,
        required: f.required,
        options: OPTION_FIELD_TYPES.includes(f.fieldType) ? f.options.map((o) => o.trim()).filter(Boolean) : [],
        minValue: f.fieldType === 'NUMBER' && f.minValue !== '' ? Number(f.minValue) : null,
        maxValue: f.fieldType === 'NUMBER' && f.maxValue !== '' ? Number(f.maxValue) : null,
        usedForMatching: OPTION_FIELD_TYPES.includes(f.fieldType) ? f.usedForMatching : false,
      })),
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

  const numberFieldsFor = (service) => (service?.scopeFields || []).filter((f) => f.fieldType === 'NUMBER')

  const openTasks = async (service) => {
    setTasksService(service)
    setTasksError('')
    setTasksLoading(true)
    try {
      const data = await fetchTasks(service.id)
      setTasks(data)
    } catch (err) {
      setTasksError(err.message || 'Failed to load tasks')
    } finally {
      setTasksLoading(false)
    }
  }

  const closeTasks = () => {
    setTasksService(null)
    setTasks([])
    setTaskFormOpen(false)
  }

  const openTaskAdd = () => {
    setTaskFormMode('add')
    setEditingTaskId(null)
    setTaskForm(emptyTaskForm())
    setTaskFormError('')
    setTaskFormOpen(true)
  }

  const openTaskEdit = (task) => {
    setTaskFormMode('edit')
    setEditingTaskId(task.id)
    setTaskForm(taskToForm(task))
    setTaskFormError('')
    setTaskFormOpen(true)
  }

  const closeTaskForm = () => {
    setTaskFormOpen(false)
    setTaskFormError('')
  }

  const onSaveTask = async (e) => {
    e.preventDefault()
    setTaskFormError('')

    const name = taskForm.name.trim()
    const basePrice = Number(taskForm.basePrice)
    const { pricingModel } = taskForm

    if (!name) return setTaskFormError('Name is required.')
    if (!Number.isFinite(basePrice) || basePrice < 0) return setTaskFormError('Base price must be a non-negative number.')

    const payload = {
      name,
      description: taskForm.description.trim() || undefined,
      basePrice,
      pricingModel,
      durationHours: pricingModel === 'CUSTOM_QUOTE' || taskForm.durationHours === '' ? null : Number(taskForm.durationHours),
    }

    if (pricingModel === 'CUSTOM_QUOTE') {
      payload.minPrice = null
      payload.maxPrice = null
      payload.unitLabel = null
      payload.quantityScopeFieldId = null
    } else {
      const minPrice = Number(taskForm.minPrice)
      const maxPrice = Number(taskForm.maxPrice)
      if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || minPrice < 0 || minPrice > maxPrice) {
        return setTaskFormError('Min/max price are required and min must be <= max.')
      }
      // This is a platform-wide bound (no city), so it's checked against the
      // single highest regional DOLE floor — the backend re-checks and
      // rejects without a reason either way; this just avoids a round trip.
      const overrideReason = taskForm.overrideReason.trim()
      if (minPrice < HIGHEST_DOLE_REF.hourlyWage && !overrideReason) {
        return setTaskFormError(
          `Min price is below the DOLE ${HIGHEST_DOLE_REF.label} hourly wage floor (₱${HIGHEST_DOLE_REF.hourlyWage.toFixed(2)}/hr). Enter an override reason to save it anyway.`
        )
      }
      payload.minPrice = minPrice
      payload.maxPrice = maxPrice
      payload.overrideReason = overrideReason || undefined

      if (pricingModel === 'PER_UNIT') {
        if (!taskForm.unitLabel.trim()) return setTaskFormError('Unit label is required for a per-unit task (e.g. "kilo").')
        if (!taskForm.quantityScopeFieldId) return setTaskFormError('Pick which number field supplies the quantity.')
        payload.unitLabel = taskForm.unitLabel.trim()
        payload.quantityScopeFieldId = taskForm.quantityScopeFieldId
      } else {
        payload.unitLabel = null
        payload.quantityScopeFieldId = null
      }
    }

    setTaskSaving(true)
    try {
      if (taskFormMode === 'add') {
        const created = await createTask(tasksService.id, payload)
        setTasks((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
        showSuccess('Task added.')
      } else {
        const updated = await updateTask(tasksService.id, editingTaskId, payload)
        setTasks((prev) => prev.map((t) => (t.id === editingTaskId ? updated : t)))
        showSuccess('Task updated.')
      }
      closeTaskForm()
    } catch (err) {
      setTaskFormError(err.message || 'Failed to save task')
    } finally {
      setTaskSaving(false)
    }
  }

  const onToggleTaskActive = async (task) => {
    setTogglingTaskId(task.id)
    try {
      const updated = await toggleTaskActive(tasksService.id, task.id, !task.isActive)
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)))
      showSuccess(updated.isActive ? 'Task activated.' : 'Task deactivated.')
    } catch (err) {
      showError(err.message || 'Failed to update task')
    } finally {
      setTogglingTaskId(null)
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
                  <th></th>
                  <th>Name</th>
                  <th>Base Price (₱)</th>
                  <th>Fields</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedServices.map((s) => {
                  const fieldCount = (s.scopeFields || []).length
                  const matchingCount = (s.scopeFields || []).filter((f) => f.usedForMatching).length
                  return (
                    <tr key={s.id}>
                      <td>
                        <span className="icon-picker-trigger__swatch" style={{ width: 32, height: 32 }}>
                          <span className="msym" style={{ fontSize: 18 }}>{s.icon ? msIconFor(s.icon) : 'help_outline'}</span>
                        </span>
                      </td>
                      <td>
                        <strong>{s.name}</strong>
                        {s.requiresCertification && (
                          <span className="badge badge-pending" style={{ marginLeft: '0.4rem' }} title="Requires an admin-approved certification">
                            Licensed
                          </span>
                        )}
                      </td>
                      <td>{formatPeso(s.basePrice)}</td>
                      <td>
                        {fieldCount} field{fieldCount === 1 ? '' : 's'}
                        {matchingCount > 0 && (
                          <span className="badge badge-pending" style={{ marginLeft: '0.4rem' }}>
                            {matchingCount} match{matchingCount === 1 ? '' : 'es'} workers
                          </span>
                        )}
                      </td>
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
                            title="Manage tasks"
                            aria-label={`Manage tasks for ${s.name}`}
                            onClick={() => openTasks(s)}
                          >
                            <i className="fas fa-list-check" />
                          </button>
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
                            className={`action-btn ${s.isActive ? 'delete' : 'approve'}`}
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
                  )
                })}
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
        {!loading && !loadError && filteredServices.length > 0 && (
          <Pagination
            info={`Showing ${pagedServices.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0}-${
              (currentPage - 1) * PAGE_SIZE + pagedServices.length
            } of ${filteredServices.length} services`}
            hasPrev={currentPage > 1}
            hasNext={currentPage < totalPages}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
          />
        )}
      </SectionCard>

      {open && (
        <div className="modal-backdrop" onClick={closeModal} role="presentation">
          <div className="modal modal--landscape" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
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
                  placeholder="e.g. House Painting"
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
                <label>Icon</label>
                <IconPicker value={form.icon} onChange={(icon) => setForm((p) => ({ ...p, icon }))} />
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
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={form.requiresCertification}
                    onChange={(e) => setForm((p) => ({ ...p, requiresCertification: e.target.checked }))}
                  />
                  Licensed trade — requires an admin-approved certification
                </label>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
                  A worker can't add this category until they upload a certification tagged to it and an admin
                  approves it (see a worker's detail page).
                </p>
              </div>

              <div className="form-field">
                <label>Booking fields</label>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
                  What the client fills in when booking this service. For a single- or multi-choice field, turn on
                  "Use to match workers" only when different pros genuinely handle different options (e.g. which
                  appliance) — not for a field like paint color that every pro can do.
                </p>
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
                        aria-label={`Field ${fieldIndex + 1} label`}
                        style={{ flex: 1, padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 8 }}
                      />
                      <select
                        value={field.fieldType}
                        onChange={(e) => updateField(fieldIndex, { fieldType: e.target.value })}
                        aria-label={`Field ${fieldIndex + 1} type`}
                        style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 8 }}
                      >
                        {Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="action-btn delete"
                        title="Remove field"
                        aria-label={`Remove field ${fieldIndex + 1}`}
                        onClick={() => removeField(fieldIndex)}
                      >
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

                    {field.fieldType === 'NUMBER' && (
                      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <input
                          type="number"
                          value={field.minValue}
                          onChange={(e) => updateField(fieldIndex, { minValue: e.target.value })}
                          placeholder="Min (optional)"
                          aria-label={`Field ${fieldIndex + 1} minimum value`}
                          style={{ flex: 1, padding: '0.4rem 0.6rem', border: '1px solid var(--border)', borderRadius: 8 }}
                        />
                        <input
                          type="number"
                          value={field.maxValue}
                          onChange={(e) => updateField(fieldIndex, { maxValue: e.target.value })}
                          placeholder="Max (optional)"
                          aria-label={`Field ${fieldIndex + 1} maximum value`}
                          style={{ flex: 1, padding: '0.4rem 0.6rem', border: '1px solid var(--border)', borderRadius: 8 }}
                        />
                      </div>
                    )}

                    {OPTION_FIELD_TYPES.includes(field.fieldType) && (
                      <>
                        <div>
                          {field.options.map((option, optionIndex) => (
                            <div key={optionIndex} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem' }}>
                              <input
                                type="text"
                                value={option}
                                onChange={(e) => updateOption(fieldIndex, optionIndex, e.target.value)}
                                placeholder="Option label"
                                aria-label={`Field ${fieldIndex + 1} option ${optionIndex + 1}`}
                                style={{ flex: 1, padding: '0.4rem 0.6rem', border: '1px solid var(--border)', borderRadius: 8 }}
                              />
                              <button
                                type="button"
                                className="action-btn delete"
                                title="Remove option"
                                aria-label={`Remove field ${fieldIndex + 1} option ${optionIndex + 1}`}
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

                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.6rem' }}>
                          <input
                            type="checkbox"
                            checked={field.usedForMatching}
                            onChange={(e) => updateField(fieldIndex, { usedForMatching: e.target.checked })}
                          />
                          Use to match workers — only show pros who've declared they handle the client's chosen option
                        </label>
                      </>
                    )}
                  </div>
                ))}
                <button type="button" className="btn btn-outline btn-sm" onClick={addField}>
                  <i className="fas fa-plus" /> Add field
                </button>
              </div>

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

      {tasksService && (
        <div className="modal-backdrop" onClick={closeTasks} role="presentation">
          <div className="modal modal--landscape" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">Tasks — {tasksService.name}</h2>
            <p className="modal-body">
              Each task is a specific job under this category a worker can price on their own, within the range you set here.
            </p>

            {tasksLoading && <LoadingState message="Loading tasks..." />}
            {tasksError && <ErrorState message={tasksError} onRetry={() => openTasks(tasksService)} />}

            {!tasksLoading && !tasksError && (
              <>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Pricing</th>
                        <th>Range (₱)</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map((t) => (
                        <tr key={t.id}>
                          <td><strong>{t.name}</strong></td>
                          <td>{PRICING_MODEL_LABELS[t.pricingModel]}</td>
                          <td>
                            {t.pricingModel === 'CUSTOM_QUOTE'
                              ? '—'
                              : `${formatPeso(t.minPrice)}–${formatPeso(t.maxPrice)}${t.pricingModel === 'PER_UNIT' ? `/${t.unitLabel}` : ''}`}
                          </td>
                          <td>
                            <span className={`badge ${t.isActive ? 'badge-active' : 'badge-suspended'}`}>
                              {t.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td>
                            <div className="row-actions">
                              <button
                                type="button"
                                className="action-btn view"
                                title="Edit"
                                aria-label={`Edit ${t.name}`}
                                onClick={() => openTaskEdit(t)}
                              >
                                <i className="fas fa-pen" />
                              </button>
                              <button
                                type="button"
                                className={`action-btn ${t.isActive ? 'delete' : 'approve'}`}
                                title={t.isActive ? 'Deactivate' : 'Activate'}
                                aria-label={`${t.isActive ? 'Deactivate' : 'Activate'} ${t.name}`}
                                disabled={togglingTaskId === t.id}
                                onClick={() => onToggleTaskActive(t)}
                              >
                                <i className={`fas ${t.isActive ? 'fa-ban' : 'fa-check'}`} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {tasks.length === 0 && (
                        <tr>
                          <td colSpan={5} style={{ color: 'var(--text-muted)', padding: '1rem' }}>
                            No tasks yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <button type="button" className="btn btn-outline btn-sm" onClick={openTaskAdd} style={{ marginTop: '0.75rem' }}>
                  <i className="fas fa-plus" /> Add task
                </button>
              </>
            )}

            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={closeTasks}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {taskFormOpen && (
        <div className="modal-backdrop" onClick={closeTaskForm} role="presentation">
          <div className="modal modal--landscape" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">{taskFormMode === 'add' ? 'Add Task' : 'Edit Task'}</h2>

            <form onSubmit={onSaveTask} className="auth-form" style={{ gap: '0.75rem' }}>
              <div className="form-field">
                <label htmlFor="tk-name">Name</label>
                <input
                  id="tk-name"
                  type="text"
                  value={taskForm.name}
                  onChange={(e) => setTaskForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Toilet Repair"
                />
              </div>

              <div className="form-field">
                <label htmlFor="tk-description">Description</label>
                <input
                  id="tk-description"
                  type="text"
                  value={taskForm.description}
                  onChange={(e) => setTaskForm((p) => ({ ...p, description: e.target.value }))}
                />
              </div>

              <div className="form-field">
                <label htmlFor="tk-base-price">Suggested Price (₱)</label>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0 0 0.4rem' }}>
                  Shown as the typical price before a client picks a worker. Not what a client is actually charged
                  once a worker sets their own price below.
                </p>
                <input
                  id="tk-base-price"
                  type="number"
                  min="0"
                  value={taskForm.basePrice}
                  onChange={(e) => setTaskForm((p) => ({ ...p, basePrice: e.target.value }))}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 8 }}
                />
              </div>

              <div className="form-field">
                <label htmlFor="tk-pricing-model">Pricing model</label>
                <select
                  id="tk-pricing-model"
                  value={taskForm.pricingModel}
                  onChange={(e) => setTaskForm((p) => ({ ...p, pricingModel: e.target.value }))}
                  style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 8 }}
                >
                  <option value="FIXED">Fixed</option>
                  <option value="PER_UNIT">Per-unit</option>
                  <option value="CUSTOM_QUOTE">Custom quote</option>
                </select>
              </div>

              {taskForm.pricingModel === 'CUSTOM_QUOTE' && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  Worker will quote after inspecting — no upfront range or duration to set.
                </p>
              )}

              {taskForm.pricingModel !== 'CUSTOM_QUOTE' && (
                <div className="form-field">
                  <label>{taskForm.pricingModel === 'PER_UNIT' ? 'Allowed rate range (₱/unit)' : 'Allowed price range (₱)'}</label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      type="number"
                      min="0"
                      value={taskForm.minPrice}
                      onChange={(e) => setTaskForm((p) => ({ ...p, minPrice: e.target.value }))}
                      placeholder="Min"
                      aria-label="Minimum price"
                      style={{ flex: 1, padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 8 }}
                    />
                    <input
                      type="number"
                      min="0"
                      value={taskForm.maxPrice}
                      onChange={(e) => setTaskForm((p) => ({ ...p, maxPrice: e.target.value }))}
                      placeholder="Max"
                      aria-label="Maximum price"
                      style={{ flex: 1, padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 8 }}
                    />
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.35rem' }}>
                    DOLE wage floor for reference (highest region — this range applies platform-wide, not per city):{' '}
                    ₱{HIGHEST_DOLE_REF.hourlyWage.toFixed(2)}/hr ({HIGHEST_DOLE_REF.label}, {HIGHEST_DOLE_REF.wageOrder})
                  </p>
                  {Number.isFinite(Number(taskForm.minPrice)) &&
                    taskForm.minPrice !== '' &&
                    Number(taskForm.minPrice) < HIGHEST_DOLE_REF.hourlyWage && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <p style={{ color: 'var(--warning)', fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                          Min price is below the DOLE {HIGHEST_DOLE_REF.label} hourly wage floor (₱
                          {HIGHEST_DOLE_REF.hourlyWage.toFixed(2)}/hr, {HIGHEST_DOLE_REF.wageOrder}) — this is a soft
                          guardrail, not a legal requirement for independent contractors.
                        </p>
                        <textarea
                          className="form-input"
                          rows={2}
                          value={taskForm.overrideReason}
                          onChange={(e) => setTaskForm((p) => ({ ...p, overrideReason: e.target.value }))}
                          placeholder="Why this price is intentionally below the DOLE reference"
                          style={{ width: '100%', resize: 'vertical' }}
                        />
                      </div>
                    )}
                </div>
              )}

              {taskForm.pricingModel === 'PER_UNIT' && (
                <>
                  <div className="form-field">
                    <label htmlFor="tk-unit-label">Unit label</label>
                    <input
                      id="tk-unit-label"
                      type="text"
                      value={taskForm.unitLabel}
                      onChange={(e) => setTaskForm((p) => ({ ...p, unitLabel: e.target.value }))}
                      placeholder="e.g. kilo, sq.m., linear meter"
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="tk-quantity-field">Quantity comes from</label>
                    {numberFieldsFor(tasksService).length === 0 ? (
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        Add a Number scope field to this category first (Edit Service → Booking fields), then pick it here.
                      </p>
                    ) : (
                      <select
                        id="tk-quantity-field"
                        value={taskForm.quantityScopeFieldId}
                        onChange={(e) => setTaskForm((p) => ({ ...p, quantityScopeFieldId: e.target.value }))}
                        style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 8 }}
                      >
                        <option value="">Select a field...</option>
                        {numberFieldsFor(tasksService).map((f) => (
                          <option key={f.id} value={f.id}>{f.label}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </>
              )}

              {taskForm.pricingModel !== 'CUSTOM_QUOTE' && (
                <div className="form-field">
                  <label htmlFor="tk-duration">Duration (hours, optional)</label>
                  <input
                    id="tk-duration"
                    type="number"
                    min="0"
                    step="0.5"
                    value={taskForm.durationHours}
                    onChange={(e) => setTaskForm((p) => ({ ...p, durationHours: e.target.value }))}
                    style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 8 }}
                  />
                </div>
              )}

              {taskFormError && <div className="form-error">{taskFormError}</div>}

              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={closeTaskForm}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={taskSaving}>
                  {taskSaving ? 'Saving...' : taskFormMode === 'add' ? 'Add' : 'Update'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
