export default function ErrorState({ message, onRetry }) {
  return (
    <div className="state-message state-message--error">
      <i className="fas fa-circle-exclamation" aria-hidden="true" />
      <span>{message || 'Something went wrong'}</span>
      {onRetry && (
        <button type="button" className="btn btn-outline btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
