import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SearchBar from '../components/common/SearchBar'
import FilterTabs from '../components/common/FilterTabs'
import SectionCard from '../components/common/SectionCard'
import Pagination from '../components/common/Pagination'
import Badge from '../components/common/Badge'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { useListQuery } from '../hooks/useListQuery'
import { fetchWorkers } from '../services/workers'

const STATUS_MAP = { All: 'all', Verified: 'verified', Pending: 'pending' }

export default function Workers() {
  const fetchFn = useCallback(
    (params) =>
      fetchWorkers({
        page: params.page || 1,
        limit: 10,
        search: params.search || '',
        status: STATUS_MAP[params.statusTab] || 'all',
      }),
    []
  )

  const {
    data: workers,
    meta,
    params,
    loading,
    error,
    reload,
    setSearch,
    setFilter,
    goToPage,
  } = useListQuery(fetchFn, {
    initialParams: { page: 1, statusTab: 'All' },
  })

  return (
    <>
      <PageHeader title="Workers" subtitle="Manage all registered workers" />
      <div className="toolbar">
        <SearchBar placeholder="Search workers..." value={params.search || ''} onChange={setSearch} />
        <FilterTabs
          tabs={['All', 'Verified', 'Pending']}
          activeTab={params.statusTab || 'All'}
          onTabChange={(tab) => setFilter('statusTab', tab)}
        />
      </div>
      <SectionCard>
        {loading && <LoadingState message="Loading workers..." />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Worker ID</th>
                    <th>Name</th>
                    <th>Services</th>
                    <th>Rating</th>
                    <th>Status</th>
                    <th>Earnings</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {workers.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                        No workers found.
                      </td>
                    </tr>
                  ) : (
                    workers.map((worker) => (
                      <tr key={worker.id}>
                        <td>{worker.displayId}</td>
                        <td>{worker.name}</td>
                        <td>{worker.services}</td>
                        <td>★ {worker.rating}</td>
                        <td>
                          <Badge variant={worker.status === 'Verified' ? 'approved' : 'pending'}>
                            {worker.status}
                          </Badge>
                        </td>
                        <td>{worker.earnings}</td>
                        <td>
                          <div className="row-actions">
                            <Link to={`/workers/${worker.id}`} className="action-btn view" title="View">
                              <i className="fas fa-eye" />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              info={`Showing ${workers.length} of ${meta.total} workers`}
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
