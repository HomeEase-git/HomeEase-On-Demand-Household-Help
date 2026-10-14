import { useLocation, useNavigate } from 'react-router-dom'

// backTo: the list this page belongs to. "Back" returns to wherever the admin
// came from (keeping that list's filters, which live in the URL); on a page
// opened directly (new tab, shared link) there's no history, so it goes to backTo.
export default function PageHeader({ title, subtitle, actions, backTo }) {
  const navigate = useNavigate()
  const location = useLocation()
  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate(backTo))

  return (
    <div className="page-header">
      <div className="title-group">
        {backTo && (
          <button type="button" className="page-back" onClick={goBack}>
            <i className="fas fa-arrow-left" aria-hidden="true" /> Back
          </button>
        )}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}
