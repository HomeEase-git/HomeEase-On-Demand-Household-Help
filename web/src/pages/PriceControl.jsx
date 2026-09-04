import { useCallback, useEffect, useMemo, useState } from 'react'
import PageHeader from '../components/common/PageHeader'
import SectionCard from '../components/common/SectionCard'
import SearchBar from '../components/common/SearchBar'
import FilterTabs from '../components/common/FilterTabs'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import Pagination from '../components/common/Pagination'
import { fetchPricingRules, createPricingRule, updatePricingRule, deletePricingRule } from '../services/pricingRules'
import { useToast } from '../context/ToastContext'
import { useListQuery } from '../hooks/useListQuery'

const PAGE_SIZE = 10

function formatPeso(amount) {
  const num = typeof amount === 'number' ? amount : Number(amount)
  if (Number.isNaN(num)) return '—'
  return `₱${num.toLocaleString()}`
}

export default function PriceControl() {
  const [query, setQuery] = useState('')
  const [serviceTab, setServiceTab] = useState('All')
  const [page, setPage] = useState(1)

  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState('add') // 'add' | 'edit'
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ city: '', serviceType: '', minPrice: '', maxPrice: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const { showSuccess, showError } = useToast()

  const fetchFn = useCallback(() => fetchPricingRules(), [])
  const { data: rules, loading, error: loadError, reload: loadRules, setData: setRules } = useListQuery(fetchFn)

  const serviceTypes = useMemo(() => {
    const types = Array.from(new Set(rules.map((r) => r.serviceType))).sort()
    return ['All', ...types]
  }, [rules])

  const filteredRules = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rules.filter((r) => {
      const matchesService = serviceTab === 'All' ? true : r.serviceType === serviceTab
      const matchesQuery = !q
        ? true
        : `${r.city} ${r.serviceType}`.toLowerCase().includes(q)
      return matchesService && matchesQuery
    })
  }, [rules, query, serviceTab])

  useEffect(() => {
    setPage(1)
  }, [query, serviceTab])

  const totalPages = Math.max(1, Math.ceil(filteredRules.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pagedRules = filteredRules.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const closeModal = () => {
    setOpen(false)
    setMode('add')
    setEditingId(null)
    setForm({ city: '', serviceType: '', minPrice: '', maxPrice: '' })
    setError('')
  }

  const openAdd = () => {
    setMode('add')
    setEditingId(null)
    setForm({ city: '', serviceType: '', minPrice: '', maxPrice: '' })
    setError('')
    setOpen(true)
  }

  const openEdit = (rule) => {
    setMode('edit')
    setEditingId(rule.id)
    setForm({
      city: rule.city,
      serviceType: rule.serviceType,
      minPrice: String(rule.minPrice),
      maxPrice: String(rule.maxPrice),
    })
    setError('')
    setOpen(true)
  }

  const onSave = async (e) => {
    e.preventDefault()
    setError('')

    const city = form.city.trim()
    const serviceType = form.serviceType.trim()
    const minPrice = Number(form.minPrice)
    const maxPrice = Number(form.maxPrice)

    if (!city || !serviceType) return setError('City and Service Type are required.')
    if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice)) return setError('Min and Max price must be valid numbers.')
    if (minPrice < 0 || maxPrice < 0) return setError('Prices cannot be negative.')
    if (minPrice > maxPrice) return setError('Min price cannot be greater than Max price.')

    setSaving(true)
    try {
      if (mode === 'add') {
        const created = await createPricingRule({ city, serviceType, minPrice, maxPrice })
        setRules((prev) => [created, ...prev])
        showSuccess('Pricing rule added.')
      } else {
        const updated = await updatePricingRule(editingId, { city, serviceType, minPrice, maxPrice })
        setRules((prev) => prev.map((r) => (r.id === editingId ? updated : r)))
        showSuccess('Pricing rule updated.')
      }
      closeModal()
    } catch (err) {
      setError(err.message || 'Failed to save pricing rule')
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async () => {
    if (!deleteTarget) return

    setDeleting(true)
    try {
      await deletePricingRule(deleteTarget.id)
      setRules((prev) => prev.filter((r) => r.id !== deleteTarget.id))
      showSuccess('Pricing rule deleted.')
      setDeleteTarget(null)
    } catch (err) {
      showError(err.message || 'Failed to delete pricing rule')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Price Control"
        subtitle="Set min/max pricing rules by city and service type."
        actions={(
          <button type="button" className="btn btn-primary" onClick={openAdd}>
            <i className="fas fa-plus" /> Add Rule
          </button>
        )}
      />

      <div className="toolbar">
        <SearchBar placeholder="Search city or service..." value={query} onChange={setQuery} />
        <FilterTabs tabs={serviceTypes} activeTab={serviceTab} onTabChange={setServiceTab} />
      </div>

      <SectionCard title="Pricing Matrix">
        {loading && <LoadingState message="Loading pricing rules..." />}
        {loadError && <ErrorState message={loadError} onRetry={loadRules} />}
        {!loading && !loadError && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>City / Location</th>
                  <th>Service Type</th>
                  <th>Min Price (₱)</th>
                  <th>Max Price (₱)</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedRules.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.city}</strong></td>
                    <td>{r.serviceType}</td>
                    <td>{formatPeso(r.minPrice)}</td>
                    <td>{formatPeso(r.maxPrice)}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="action-btn view"
                          title="Edit"
                          aria-label={`Edit pricing rule for ${r.city} / ${r.serviceType}`}
                          onClick={() => openEdit(r)}
                        >
                          <i className="fas fa-pen" />
                        </button>
                        <button
                          type="button"
                          className="action-btn delete"
                          title="Delete"
                          aria-label={`Delete pricing rule for ${r.city} / ${r.serviceType}`}
                          onClick={() => setDeleteTarget(r)}
                        >
                          <i className="fas fa-trash" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredRules.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--text-muted)', padding: '1rem' }}>
                      No pricing rules found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !loadError && filteredRules.length > 0 && (
          <Pagination
            info={`Showing ${pagedRules.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0}-${
              (currentPage - 1) * PAGE_SIZE + pagedRules.length
            } of ${filteredRules.length} rules`}
            hasPrev={currentPage > 1}
            hasNext={currentPage < totalPages}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
          />
        )}
      </SectionCard>

      {open && (
        <div className="modal-backdrop" onClick={closeModal} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">{mode === 'add' ? 'Add Pricing Rule' : 'Edit Pricing Rule'}</h2>
            <p className="modal-body">Define the allowed price range for a service in a location.</p>

            <form onSubmit={onSave} className="auth-form" style={{ gap: '0.75rem' }}>
              <div className="form-field">
                <label htmlFor="pc-city">City / Location</label>
                <input
                  id="pc-city"
                  type="text"
                  value={form.city}
                  onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))}
                  placeholder="e.g. Malolos"
                />
              </div>

              <div className="form-field">
                <label htmlFor="pc-service">Service Type</label>
                <input
                  id="pc-service"
                  type="text"
                  value={form.serviceType}
                  onChange={(e) => setForm((p) => ({ ...p, serviceType: e.target.value }))}
                  placeholder="e.g. Plumbing"
                />
              </div>

              <div className="detail-grid" style={{ marginBottom: 0 }}>
                <div className="detail-block">
                  <label htmlFor="pc-min">Min Price (₱)</label>
                  <input
                    id="pc-min"
                    type="number"
                    min="0"
                    value={form.minPrice}
                    onChange={(e) => setForm((p) => ({ ...p, minPrice: e.target.value }))}
                    style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 8 }}
                  />
                </div>
                <div className="detail-block">
                  <label htmlFor="pc-max">Max Price (₱)</label>
                  <input
                    id="pc-max"
                    type="number"
                    min="0"
                    value={form.maxPrice}
                    onChange={(e) => setForm((p) => ({ ...p, maxPrice: e.target.value }))}
                    style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 8 }}
                  />
                </div>
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

      {deleteTarget && (
        <div className="modal-backdrop" onClick={() => !deleting && setDeleteTarget(null)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal-title">Delete Pricing Rule</h2>
            <p className="modal-body">
              Delete the pricing rule for <strong>{deleteTarget.city}</strong> /{' '}
              <strong>{deleteTarget.serviceType}</strong>? This cannot be undone.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={onDelete} disabled={deleting}>
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
