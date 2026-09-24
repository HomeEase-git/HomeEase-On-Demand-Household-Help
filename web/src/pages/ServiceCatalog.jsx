import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SectionCard from '../components/common/SectionCard'
import SearchBar from '../components/common/SearchBar'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import Pagination from '../components/common/Pagination'
import { fetchServiceTypes, toggleServiceTypeActive } from '../services/serviceTypes'
import { useToast } from '../context/ToastContext'
import { msIconFor } from '../constants/serviceIcons'
import { useListQuery } from '../hooks/useListQuery'

const PAGE_SIZE = 10

function formatPeso(amount) {
  const num = typeof amount === 'number' ? amount : Number(amount)
  if (Number.isNaN(num)) return '—'
  return `₱${num.toLocaleString()}`
}

/**
 * Service Catalog list. Adding or editing a category (its details, job order
 * matrix and each job's booking questions) happens on ServiceCatalogEditor.
 */
export default function ServiceCatalog() {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [togglingId, setTogglingId] = useState(null)
  const { showSuccess, showError } = useToast()

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
        subtitle="Each service's job order matrix and the booking questions for every job."
        actions={(
          <Link to="/service-catalog/new" className="btn btn-primary">
            <i className="fas fa-plus" /> Add Service
          </Link>
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
                  <th>Starting price</th>
                  <th>Jobs</th>
                  <th>Questions</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedServices.map((s) => {
                  const fieldCount = (s.scopeFields || []).length
                  const matchingCount = (s.scopeFields || []).filter((f) => f.usedForMatching).length
                  const activeJobs = (s.tasks || []).filter((t) => t.isActive).length
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
                      <td>{activeJobs} active</td>
                      <td>
                        {fieldCount} question{fieldCount === 1 ? '' : 's'}
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
                          <Link
                            to={`/service-catalog/${s.id}`}
                            className="action-btn view"
                            title="Edit jobs and questions"
                            aria-label={`Edit ${s.name}`}
                          >
                            <i className="fas fa-pen" />
                          </Link>
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
                    <td colSpan={7} style={{ color: 'var(--text-muted)', padding: '1rem' }}>
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
    </>
  )
}
