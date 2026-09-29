import { useState } from 'react'
import { Link } from 'react-router-dom'
import SectionCard from '../common/SectionCard'
import Badge from '../common/Badge'
import DocumentViewer from '../common/DocumentViewer'
import { fetchWorkerDocuments } from '../../services/workers'
import { humanizeEnum } from '../../utils/verificationLabels'

const REQUEST_STATUS_VARIANT = {
  APPROVED: 'approved',
  REJECTED: 'flagged',
  PENDING: 'pending',
  SUBMITTED: 'pending',
}

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/**
 * Every file a worker has uploaded, grouped by verification submission, plus
 * their resume and certificates. Read-only: approving or rejecting still
 * happens on the verification review (linked from each group). Loaded only
 * on request — viewing is audit-logged on the server, and the file links it
 * returns expire after an hour.
 */
export default function WorkerDocuments({ workerId }) {
  const [documents, setDocuments] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setDocuments(await fetchWorkerDocuments(workerId))
    } catch (err) {
      setError(err.message || 'Failed to load documents')
    } finally {
      setLoading(false)
    }
  }

  if (!documents) {
    return (
      <SectionCard title="Documents">
        <p className="page-subtitle" style={{ marginBottom: '1rem' }}>
          IDs, selfie, clearances, health certificate, resume and certificates this worker has uploaded. Opening them
          is recorded in the audit log.
        </p>
        {error && <div className="form-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}
        <button type="button" className="btn btn-outline" onClick={load} disabled={loading}>
          <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-folder-open'}`} /> {loading ? 'Loading…' : 'Show documents'}
        </button>
      </SectionCard>
    )
  }

  // KYC documents grouped by the submission they came in with (newest
  // first, as the server returns them); resume and certificates after.
  const submissions = []
  const bySubmission = new Map()
  const other = []
  for (const doc of documents) {
    if (doc.source !== 'KYC') {
      other.push(doc)
      continue
    }
    if (!bySubmission.has(doc.verificationId)) {
      const group = { ...doc, docs: [] }
      bySubmission.set(doc.verificationId, group)
      submissions.push(group)
    }
    bySubmission.get(doc.verificationId).docs.push(doc)
  }

  return (
    <SectionCard title="Documents">
      {documents.length === 0 && <DocumentViewer documents={[]} />}
      {submissions.map((group) => (
        <div key={group.verificationId} style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <strong>{humanizeEnum(group.verificationType)}</strong>
            <span style={{ color: 'var(--text-muted)' }}>submitted {formatDate(group.verificationSubmittedAt)}</span>
            <Badge variant={REQUEST_STATUS_VARIANT[group.verificationStatus] ?? 'pending'}>{group.verificationStatus}</Badge>
            <Link to={`/verification/detail/${group.verificationId}`} className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }}>
              Open review
            </Link>
          </div>
          <DocumentViewer documents={group.docs} />
        </div>
      ))}
      {other.length > 0 && (
        <div>
          <div style={{ marginBottom: '0.75rem' }}>
            <strong>Resume &amp; certificates</strong>
          </div>
          <DocumentViewer documents={other} />
        </div>
      )}
    </SectionCard>
  )
}
