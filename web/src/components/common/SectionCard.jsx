export default function SectionCard({ title, children, style, className }) {
  return (
    <div className={`section-card ${className || ''}`} style={style}>
      {title && <h3>{title}</h3>}
      {children}
    </div>
  )
}
