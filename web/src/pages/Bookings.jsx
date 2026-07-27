import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SubNav from '../components/common/SubNav'
import SearchBar from '../components/common/SearchBar'
import FilterTabs from '../components/common/FilterTabs'
import SectionCard from '../components/common/SectionCard'
import Pagination from '../components/common/Pagination'
import Badge from '../components/common/Badge'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { useListQuery } from '../hooks/useListQuery'
import { fetchBookings } from '../services/bookings'

const SUB_NAV = [
  { to: '/bookings', label: 'All Bookings' },
  { to: '/bookings/dispute', label: 'Booking Dispute' },
]

const STATUS_MAP = {
  All: 'all',
  Pending: 'pending',
  Completed: 'completed',
  Cancelled: 'cancelled',
}

export default function Bookings() {
  const fetchFn = useCallback(
    (params) =>
      fetchBookings({
        page: params.page || 1,
        limit: 10,
        search: params.search || '',
        status: STATUS_MAP[params.statusTab] || 'all',
      }),
    []
  )

  const {
    data: bookings,
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
      <PageHeader title="Booking Management" subtitle="All bookings" />
      <SubNav items={SUB_NAV} />
      <div className="toolbar">
        <SearchBar placeholder="Search bookings..." value={params.search || ''} onChange={setSearch} />
        <FilterTabs
          tabs={['All', 'Pending', 'Completed', 'Cancelled']}
          activeTab={params.statusTab || 'All'}
          onTabChange={(tab) => setFilter('statusTab', tab)}
        />
      </div>
      <SectionCard>
        {loading && <LoadingState message="Loading bookings..." />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Booking ID</th><th>Client</th><th>Worker</th><th>Service</th><th>Date</th><th>Amount</th><th>Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No bookings found.</td>
                    </tr>
                  ) : (
                    bookings.map((b) => (
                      <tr key={b.id}>
                        <td>{b.displayId}</td>
                        <td>{b.client}</td>
                        <td>{b.worker}</td>
                        <td>{b.service}</td>
                        <td>{b.date}</td>
                        <td>{b.amount}</td>
                        <td>
                          <Badge variant={b.status === 'Completed' ? 'approved' : 'pending'}>{b.status}</Badge>
                        </td>
                        <td>
                          <Link to={`/bookings/detail/${b.id}`} className="action-btn view" title="View">
                            <i className="fas fa-eye" />
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              info={`Showing ${bookings.length} of ${meta.total} bookings`}
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
