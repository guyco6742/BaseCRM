export default function Card({ className = '', children, ...props }) {
  return (
    <div
      className={`rounded-lg border border-border bg-surface p-4 ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}
