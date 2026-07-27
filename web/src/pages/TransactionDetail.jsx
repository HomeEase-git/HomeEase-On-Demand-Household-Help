import { Link, Navigate, useParams } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SubNav from '../components/common/SubNav'
import Badge from '../components/common/Badge'
import LoadingState from '../components/common/LoadingState'
import ErrorState from '../components/common/ErrorState'
import { useDetailQuery } from '../hooks/useListQuery'
import { fetchPaymentById } from '../services/payments'
import { formatPeso } from '../data/payments'

const SUB_NAV = [
  { to: '/payments', label: 'All Transactions' },
]

export default function TransactionDetail() {
  const { id } = useParams()
  const { data: tx, loading, error, reload } = useDetailQuery(fetchPaymentById, id)

  if (loading) {
    return <LoadingState message="Loading transaction details..." />
  }

  if (error) {
    return <ErrorState message={error} onRetry={reload} />
  }

  if (!tx) {
    return <Navigate to="/payments" replace />
  }

  const details = [
    { label: 'Transaction ID', value: tx.id },
    { label: 'Booking', value: tx.booking },
    { label: 'Client', value: tx.client },
    { label: 'Worker', value: tx.worker },
    { label: 'Amount (Client Paid)', value: formatPeso(tx.userAmount) },
    { label: 'Worker Earnings', value: formatPeso(tx.workerAmount) },
    { label: 'Platform Commission', value: formatPeso(tx.platformFee) },
    { label: 'Method', value: tx.method },
    {
      label: 'Status',
      value: <Badge variant={tx.status === 'Completed' ? 'approved' : 'pending'}>{tx.status}</Badge>,
    },
    { label: 'Date', value: tx.date },
  ]

  return (
    <>
      <PageHeader
        title="Transaction Detail"
        subtitle={`Transaction ${tx.id}`}
        actions={<Link to="/payments" className="btn btn-outline">Back</Link>}
      />
      <div className="detail-grid">
        {details.map(({ label, value }) => (
          <div key={label} className="detail-block">
            <label>{label}</label>
            <div className="value">{value}</div>
          </div>
        ))}
      </div>
      <SubNav items={SUB_NAV} />
    </>
  )
}
