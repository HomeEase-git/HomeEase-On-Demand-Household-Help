import { useState } from 'react'
import Badge from './Badge'
import { humanizeEnum } from '../../utils/verificationLabels'

const STATUS_BADGE_VARIANT = {
  APPROVED: 'approved',
  REJECTED: 'flagged',
  PENDING: 'pending',
}

export default function DocumentViewer({ documents = [], onApproveDocument, onRejectDocument }) {
  const [rejectingId, setRejectingId] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [busyId, setBusyId] = useState(null)
  // Per-document "has an admin actually opened this" gate — an admin
  // shouldn't be able to approve/reject a KYC document sight-unseen just
  // because it uploaded fine. Deliberately client-side/session-only (not
  // persisted): a page refresh re-hiding everything is the conservative
  // failure mode, forcing a fresh look rather than silently trusting a
  // stale "already viewed" flag from a different review session.
  const [viewedIds, setViewedIds] = useState(() => new Set())
  // Which single document is expanded inline. Separate from viewedIds: that
  // is the approve/reject gate (stays set once seen), this is just the
  // preview, which is collapsed by default, toggled per document and never
  // more than one at a time.
  const [previewKey, setPreviewKey] = useState(null)

  // Unique per document; never undefined, so one doc can't alias the rest.
  const keyOf = (doc) => doc.id ?? doc.url ?? doc.name

  const togglePreview = (doc) => {
    const key = keyOf(doc)
    markViewed(key)
    setPreviewKey((prev) => (prev === key ? null : key))
  }

  const markViewed = (docId) => {
    setViewedIds((prev) => {
      if (prev.has(docId)) return prev
      const next = new Set(prev)
      next.add(docId)
      return next
    })
  }

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
      setPreviewKey(null)
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
      setPreviewKey(null)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="document-viewer">
      {documents.map((doc) => {
        const isImage = doc.mimeType?.startsWith('image/')
        const isPdf = doc.mimeType === 'application/pdf'
        const key = keyOf(doc)
        const isViewed = viewedIds.has(key)
        const isPreviewing = previewKey === key

        return (
          <div key={key} className="document-viewer__item">
            <div className="document-viewer__header">
              <span className="document-viewer__name">
                {humanizeEnum(doc.documentType)}
                {doc.name && doc.name !== doc.documentType && (
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: '0.5rem' }}>
                    {doc.name}
                  </span>
                )}
              </span>
              {doc.status && (
                <Badge variant={STATUS_BADGE_VARIANT[doc.status] ?? 'pending'}>{doc.status}</Badge>
              )}
              <a
                href={doc.url}
                target="_blank"
                rel="noreferrer"
                className="btn btn-outline btn-sm"
                onClick={() => markViewed(key)}
              >
                Open
              </a>
            </div>
            {isPreviewing ? (
              <>
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
                <div className="document-viewer__fallback">
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => togglePreview(doc)}>
                    Hide Document
                  </button>
                </div>
              </>
            ) : (
              <div className="document-viewer__fallback">
                <button type="button" className="btn btn-outline btn-sm" onClick={() => togglePreview(doc)}>
                  View Document
                </button>
              </div>
            )}
            {doc.status === 'REJECTED' && doc.rejectionReason && (
              <div className="form-error" style={{ marginTop: '0.5rem' }}>
                Rejected: {doc.rejectionReason}
              </div>
            )}
            {doc.status === 'APPROVED' && doc.expiresAt && (
              <div style={{ marginTop: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                Expires {new Date(doc.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
            )}
            {canModerate && doc.status === 'PENDING' && (
              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-success btn-sm"
                  onClick={() => handleApprove(doc)}
                  disabled={busyId === doc.id || !isViewed}
                  title={isViewed ? undefined : 'View the document before approving it'}
                >
                  Approve Document
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => startReject(doc)}
                  disabled={busyId === doc.id || !isViewed}
                  title={isViewed ? undefined : 'View the document before rejecting it'}
                >
                  Reject Document
                </button>
                {!isViewed && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    View the document first
                  </span>
                )}
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
