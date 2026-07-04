export default function Input({ label, className = '', ...props }) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-sm text-text-muted">{label}</span>}
      <input
        className={`w-full rounded-md border border-border bg-bg px-3 py-2 text-text placeholder:text-text-dim outline-none focus:border-accent transition-colors ${className}`}
        {...props}
      />
    </label>
  )
}
