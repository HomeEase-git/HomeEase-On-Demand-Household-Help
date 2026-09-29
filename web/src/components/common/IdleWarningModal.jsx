export default function IdleWarningModal({ secondsLeft, onStay, onSignOut }) {
  const minutes = Math.floor(secondsLeft / 60)
  const seconds = String(secondsLeft % 60).padStart(2, '0')

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="idle-warning-title" aria-describedby="idle-warning-body">
        <h2 className="modal-title" id="idle-warning-title">Still there?</h2>
        <p className="modal-body" id="idle-warning-body">
          You&rsquo;ll be signed out in <strong>{minutes}:{seconds}</strong> because you haven&rsquo;t been active.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={onSignOut}>
            Sign out now
          </button>
          <button type="button" className="btn btn-primary" onClick={onStay} autoFocus>
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  )
}
