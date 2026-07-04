// תצוגת לוגו ארגון — תמונה אם קיימת, אחרת ריבוע עם האות הראשונה
export default function OrgLogo({ org, size = 40, className = '', testid }) {
  const common = {
    width: size,
    height: size,
    borderRadius: size * 0.22,
  }
  if (org?.logo_url) {
    return (
      <img
        src={org.logo_url}
        alt={org.name}
        data-testid={testid}
        className={`shrink-0 object-cover ${className}`}
        style={common}
      />
    )
  }
  return (
    <div
      data-testid={testid}
      className={`flex shrink-0 items-center justify-center bg-accent font-bold text-white ${className}`}
      style={{ ...common, fontSize: size * 0.45 }}
    >
      {org?.name?.[0]?.toUpperCase() || '?'}
    </div>
  )
}
