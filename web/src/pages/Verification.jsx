import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SectionCard from '../components/common/SectionCard'
import FilterTabs from '../components/common/FilterTabs'
import SearchBar from '../components/common/SearchBar'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { fetchVerifications } from '../services/verification'

const TYPE_MAP = { All: 'all', Clients: 'client', Workers: 'worker' }

export default function Verification() {
  const [filterTab, setFilterTab] = useState('All')
  const [search, setSearch] = useState('')
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchVerifications({
        status: 'PENDING',
        type: TYPE_MAP[filterTab] || 'all',
        search,
      })
      setRecords(data)
    } catch (err) {
      setError(err.message || 'Failed to load verifications')
      setRecords([])
    } finally {
      setLoading(false)
    }
  }, [filterTab, search])

  useEffect(() => {
    load()
  }, [load])

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
                  records.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{row.email}</td>
                      <td style={{ textTransform: 'capitalize' }}>{row.type}</td>
                      <td>{row.services}</td>
                      <td>{row.submitted}</td>
                      <td>
                        <div className="row-actions">
                          <Link to={`/verification/detail/${row.id}`} className="action-btn view" title="Review">
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
      </SectionCard>
    </>
  )
}
