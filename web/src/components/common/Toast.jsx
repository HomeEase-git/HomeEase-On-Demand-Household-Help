const ICONS = {
  success: 'fa-circle-check',
  error: 'fa-circle-exclamation',
  info: 'fa-circle-info',
}

export default function ToastViewport({ toasts, onDismiss }) {
  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.type}`} role="status">
          <i className={`fas ${ICONS[toast.type] || ICONS.info}`} />
          <span className="toast__message">{toast.message}</span>
          <button
            type="button"
            className="toast__dismiss"
            aria-label="Dismiss notification"
            onClick={() => onDismiss(toast.id)}
          >
            <i className="fas fa-xmark" />
          </button>
        </div>
      ))}
    </div>
  )
}