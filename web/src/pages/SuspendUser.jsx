import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import SectionCard from '../components/common/SectionCard'
import { updateUserStatus } from '../services/users'

export default function SuspendUser() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [reason, setReason] = useState('Violation of terms')
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const userId = useMemo(() => searchParams.get('userId') || '', [searchParams])

  const handleSubmit = async () => {
    if (!userId) {
      setError('No user selected.')
      return
    }

    setIsSubmitting(true)
    setError('')
    setSuccess('')

    try {
      await updateUserStatus(userId, 'SUSPENDED', reason, notes)
      setSuccess('User suspended successfully.')
      window.setTimeout(() => navigate('/users'), 800)
    } catch (err) {
      setError(err.message || 'Unable to suspend user.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Suspend / Ban User"
        subtitle="Suspend or permanently ban a user account"
        actions={<Link to="/users" className="btn btn-outline">Back to Users</Link>}
      />
      <SectionCard style={{ maxWidth: 480 }}>
        <h3>Reason for suspension</h3>
        <p className="page-subtitle" style={{ marginBottom: '1rem' }}>
          Select a reason and add optional notes.
        </p>
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>Reason</label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: 8, fontSize: '0.9375rem' }}
          >
            <option>Violation of terms</option>
            <option>Fraudulent activity</option>
            <option>Harassment</option>
            <option>Other</option>
          </select>
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>Notes (optional)</label>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: 8, fontSize: '0.9375rem' }}
          />
        </div>
        {error && <div className="form-error" style={{ marginBottom: '1rem' }}>{error}</div>}
        {success && <div className="form-success" style={{ marginBottom: '1rem' }}>{success}</div>}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" className="btn btn-danger" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'Processing...' : 'Suspend User'}
          </button>
          <Link to="/users" className="btn btn-outline">Cancel</Link>
        </div>
      </SectionCard>
    </>
  )
}
