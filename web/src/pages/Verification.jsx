import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SectionCard from '../components/common/SectionCard'
import FilterTabs from '../components/common/FilterTabs'
import SearchBar from '../components/common/SearchBar'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import Pagination from '../components/common/Pagination'
import { fetchVerifications } from '../services/verification'
import { usePolling } from '../hooks/usePolling'
import { humanizeEnum, humanizeList } from '../utils/verificationLabels'

const TYPE_MAP = { All: 'all', Clients: 'client', Workers: 'worker' }
const POLL_INTERVAL_MS = 8000
const PAGE_SIZE = 10

export default function Verification() {
  const [filterTab, setFilterTab] = useState('All')
  const [search, setSearch] = useState('')
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [page, setPage] = useState(1)

  // `silent` skips the loading flag so the 8s background poll refresh
  // doesn't yank the table out and flash the spinner over an already
  // -rendered list every cycle.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const data = await fetchVerifications({
        status: 'PENDING',
        type: TYPE_MAP[filterTab] || 'all',
        search,
      })
      setRecords(data)
    } catch (err) {
      if (!silent) {
        setError(err.message || 'Failed to load verifications')
        setRecords([])
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [filterTab, search])

  useEffect(() => {
    load()
  }, [load])

  usePolling(() => load(true), POLL_INTERVAL_MS)

  useEffect(() => {
    setPage(1)
  }, [filterTab, search])

  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pagedRecords = useMemo(
    () => records.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [records, currentPage]
  )

  return (
    <>
      <PageHeader title="Verification Management" subtitle="Pending account verifications" />
      <div className="toolbar" style={{ marginBottom: '1rem' }}>
        <SearchBar
          placeholder="Search by name or email..."
          value={search}
          onChange={setSearch}
        />
        <FilterTabs
          tabs={['All', 'Clients', 'Workers']}
          activeTab={filterTab}
          onTabChange={setFilterTab}
        />
      </div>
      <SectionCard>
        {loading && <LoadingState message="Loading verifications..." />}
        {error && <ErrorState message={error} onRetry={load} />}
        {!loading && !error && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Applicant</th>
                  <th>Email</th>
                  <th>Type</th>
                  <th>Services / Reason</th>
                  <th>Submitted</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      No pending verifications found.
                    </td>
                  </tr>
                ) : (
                  pagedRecords.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{row.email}</td>
                      <td>{humanizeEnum(row.type)}</td>
                      <td>{humanizeList(row.services)}</td>
                      <td>{row.submitted}</td>
                      <td>
                        <div className="row-actions">
                          <Link
                            to={`/verification/detail/${row.id}`}
                            className="action-btn view"
                            title="Review"
                            aria-label={`Review verification for ${row.name}`}
                          >
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
        )}
        {!loading && !error && records.length > 0 && (
          <Pagination
            info={`Showing ${pagedRecords.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0}-${
              (currentPage - 1) * PAGE_SIZE + pagedRecords.length
            } of ${records.length} verifications`}
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
