export default function Pagination({ info, onPrev, onNext, hasPrev = false, hasNext = true }) {
  return (
    <div className="pagination-wrap">
      <span className="info">{info}</span>
      <div className="pagination-btns">
        <button type="button" disabled={!hasPrev} onClick={onPrev}>
          Previous
        </button>
        <button type="button" disabled={!hasNext} onClick={onNext}>
          Next
        </button>
      </div>
    </div>
  )
}
