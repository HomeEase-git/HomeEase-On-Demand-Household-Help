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
import { fetchClients } from '../services/users'

const STATUS_MAP = { All: 'all', Active: 'active', Suspended: 'suspended' }

export default function Users() {
  const fetchFn = useCallback(
    (params) =>
      fetchClients({
        page: params.page || 1,
        limit: 10,
        search: params.search || '',
        status: STATUS_MAP[params.statusTab] || 'all',
      }),
    []
  )

  const {
    data: clients,
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
      <PageHeader title="Client List" subtitle="All registered clients" />
      <div className="toolbar">
        <SearchBar
          placeholder="Search by name, email, or phone..."
          value={params.search || ''}
          onChange={setSearch}
        />
        <FilterTabs
          tabs={['All', 'Active', 'Suspended']}
          activeTab={params.statusTab || 'All'}
          onTabChange={(tab) => setFilter('statusTab', tab)}
        />
      </div>
      <SectionCard>
        {loading && <LoadingState message="Loading clients..." />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>User ID</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Status</th>
                    <th>Bookings</th>
                    <th>Total Spent</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                        No clients found.
                      </td>
                    </tr>
                  ) : (
                    clients.map((user) => (
                      <tr key={user.id}>
                        <td>{user.displayId}</td>
                        <td>{user.name}</td>
                        <td>{user.email}</td>
                        <td>{user.phone}</td>
                        <td>
                          <Badge variant={user.status === 'active' ? 'active' : 'suspended'}>
                            {user.status}
                          </Badge>
                        </td>
                        <td>{user.bookings}</td>
                        <td>{user.spent}</td>
                        <td>
                          <div className="row-actions">
                            <Link to={`/users/client/${user.id}`} className="action-btn view" title="View">
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
              info={`Showing ${clients.length} of ${meta.total} clients`}
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
