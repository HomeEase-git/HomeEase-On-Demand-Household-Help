import { Link } from 'react-router-dom'

export default function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header">
      <div className="title-group">
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}
