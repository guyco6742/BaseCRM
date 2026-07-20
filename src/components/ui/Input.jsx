export default function Input({ label, className = '', error, id, ...props }) {
  const errorId = error ? `${id || props.name || 'input'}-error` : undefined
  return (
    <label className="block">
      {label && <span className="mb-1 block text-sm text-text-muted">{label}</span>}
      <input
        id={id}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`w-full rounded-md border ${error ? 'border-status-red' : 'border-border'} bg-bg px-3 py-2 text-text placeholder:text-text-dim outline-none focus:border-accent focus:ring-2 focus:ring-accent/50 transition-colors ${className}`}
        {...props}
      />
      {error && (
        <span id={errorId} role="alert" className="mt-1 block text-sm text-status-red">
          {error}
        </span>
      )}
    </label>
  )
}
