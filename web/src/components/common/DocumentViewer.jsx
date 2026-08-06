import { useState } from 'react'
import Badge from './Badge'

const STATUS_BADGE_VARIANT = {
  APPROVED: 'approved',
  REJECTED: 'flagged',
  PENDING: 'pending',
}

export default function DocumentViewer({ documents = [], onApproveDocument, onRejectDocument }) {
  const [rejectingId, setRejectingId] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [busyId, setBusyId] = useState(null)

  if (!documents.length) {
    return (
      <div className="document-viewer document-viewer--empty">
        No documents uploaded yet.
      </div>
    )
  }

  const canModerate = Boolean(onApproveDocument && onRejectDocument)

  const handleApprove = async (doc) => {
    setBusyId(doc.id)
    try {
      await onApproveDocument(doc.id)
    } finally {
      setBusyId(null)
    }
  }

  const startReject = (doc) => {
    setRejectingId(doc.id)
    setRejectReason('')
  }

  const confirmReject = async (doc) => {
    if (!rejectReason.trim()) return
    setBusyId(doc.id)
    try {
      await onRejectDocument(doc.id, rejectReason.trim())
      setRejectingId(null)
      setRejectReason('')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="document-viewer">
      {documents.map((doc) => {
        const isImage = doc.mimeType?.startsWith('image/')
        const isPdf = doc.mimeType === 'application/pdf'

        return (
          <div key={doc.id || doc.name} className="document-viewer__item">
            <div className="document-viewer__header">
              <span className="document-viewer__name">{doc.name}</span>
              {doc.status && (
                <Badge variant={STATUS_BADGE_VARIANT[doc.status] ?? 'pending'}>{doc.status}</Badge>
              )}
              <a href={doc.url} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">
                Open
              </a>
            </div>
            {isImage && (
              <img src={doc.url} alt={doc.name} className="document-viewer__preview" />
            )}
            {isPdf && (
              <iframe
                src={doc.url}
                title={doc.name}
                className="document-viewer__iframe"
              />
            )}
            {!isImage && !isPdf && (
              <div className="document-viewer__fallback">
                Preview not available for this file type.
              </div>
            )}
            {doc.status === 'REJECTED' && doc.rejectionReason && (
              <div className="form-error" style={{ marginTop: '0.5rem' }}>
                Rejected: {doc.rejectionReason}
              </div>
            )}
            {canModerate && doc.status === 'PENDING' && (
              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-success btn-sm"
                  onClick={() => handleApprove(doc)}
                  disabled={busyId === doc.id}
                >
                  Approve Document
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => startReject(doc)}
                  disabled={busyId === doc.id}
                >
                  Reject Document
                </button>
              </div>
            )}
            {rejectingId === doc.id && (
              <div style={{ marginTop: '0.5rem' }}>
                <textarea
                  className="form-textarea"
                  rows={2}
                  placeholder="Reason for rejecting this document"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
                <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => setRejectingId(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => confirmReject(doc)}
                    disabled={!rejectReason.trim() || busyId === doc.id}
                  >
                    {busyId === doc.id ? 'Rejecting...' : 'Confirm Reject'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
