export default function Pagination({ info, onPrev, onNext, hasPrev = false, hasNext = true, page, totalPages }) {
  return (
    <div className="pagination-wrap">
      <span className="info">{info}</span>
      <div className="pagination-btns">
        <button type="button" disabled={!hasPrev} onClick={onPrev}>
          Previous
        </button>
        {page && totalPages > 1 && <span className="pagination-page">Page {page} of {totalPages}</span>}
        <button type="button" disabled={!hasNext} onClick={onNext}>
          Next
        </button>
      </div>
    </div>
  )
}
