export default function LoadingState({ message = 'Loading...' }) {
  return (
    <div className="state-message state-message--loading">
      <i className="fas fa-spinner fa-spin" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
