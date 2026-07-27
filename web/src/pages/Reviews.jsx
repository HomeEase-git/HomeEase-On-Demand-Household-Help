import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SubNav from '../components/common/SubNav'
import SearchBar from '../components/common/SearchBar'
import FilterTabs from '../components/common/FilterTabs'
import SectionCard from '../components/common/SectionCard'
import Pagination from '../components/common/Pagination'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { useListQuery } from '../hooks/useListQuery'
import { fetchReviews } from '../services/reviews'

const SUB_NAV = [
  { to: '/reviews', label: 'All Reviews' },
  { to: '/reviews/flagged', label: 'Flagged Reviews' }
]

export default function Reviews() {
  const [filterTab, setFilterTab] = useState('All')

  const fetchFn = useCallback(
    (params) =>
      fetchReviews({
        page: params.page || 1,
        limit: 10,
        search: params.search || '',
      }),
    []
  )

  const {
    data: reviews,
    meta,
    params,
    loading,
    error,
    reload,
    setSearch,
    goToPage,
  } = useListQuery(fetchFn, {
    initialParams: { page: 1 },
  })

  const filteredReviews = reviews.filter((r) => {
    const rating = parseFloat(r.rating)
    if (Number.isNaN(rating)) return true

    if (filterTab === '5 Star') return rating >= 5
    if (filterTab === '1-2 Star') return rating >= 1 && rating <= 2

    return true
  })

  return (
    <>
      <PageHeader title="Ratings & Reviews Management" subtitle="All reviews" />
      <SubNav items={SUB_NAV} />
      <div className="toolbar">
        <SearchBar placeholder="Search reviews..." value={params.search || ''} onChange={setSearch} />
        <FilterTabs tabs={['All', '5 Star', '1-2 Star']} activeTab={filterTab} onTabChange={setFilterTab} />
      </div>
      <SectionCard>
        {loading && <LoadingState message="Loading reviews..." />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Review ID</th><th>Booking</th><th>Client</th><th>Worker</th><th>Rating</th><th>Comment</th><th>Date</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReviews.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                        No reviews found.
                      </td>
                    </tr>
                  ) : (
                    filteredReviews.map((r) => (
                      <tr key={r.id}>
                        <td>{r.displayId}</td>
                        <td>{r.booking}</td>
                        <td>{r.client}</td>
                        <td>{r.worker}</td>
                        <td>★ {r.rating}</td>
                        <td>{r.comment}</td>
                        <td>{r.createdAt}</td>
                        <td>
                          <Link to={`/reviews/detail/${r.id}`} className="action-btn view" title="View"><i className="fas fa-eye" /></Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              info={`Showing ${filteredReviews.length} of ${meta.total} reviews`}
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
