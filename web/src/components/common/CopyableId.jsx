import { useState } from 'react'

export default function CopyableId({ value, title }) {
  const [copied, setCopied] = useState(false)

  if (!value) {
    return <span className="text-muted">—</span>
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={title || value}
      style={{
        fontFamily: 'monospace',
        fontSize: '0.8125rem',
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        color: copied ? 'var(--success)' : 'var(--text)',
        textDecoration: copied ? 'none' : 'underline dotted',
      }}
    >
      {copied ? 'Copied!' : value}
    </button>
  )
}
