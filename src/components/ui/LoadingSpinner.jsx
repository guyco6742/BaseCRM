export default function LoadingSpinner({ className = '', label }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 p-8 ${className}`}>
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
      {label && <span className="text-sm text-text-muted">{label}</span>}
    </div>
  )
}
