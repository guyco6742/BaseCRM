const VARIANTS = {
  primary: 'bg-accent hover:bg-accent-hover text-white',
  secondary: 'bg-surface-2 hover:bg-border text-text border border-border',
  ghost: 'bg-transparent hover:bg-surface-2 text-text-muted',
  danger: 'bg-status-red hover:brightness-90 text-white',
}

const SIZES = {
  sm: 'px-2.5 py-1 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-base',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  disabled,
  children,
  ...props
}) {
  return (
    <button
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
