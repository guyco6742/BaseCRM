// צבע עקבי לפי הטקסט (שם/אימייל)
const COLORS = ['#0073ea', '#00c875', '#fdab3d', '#e2445c', '#a25ddc', '#579bfc']

function colorFor(text = '') {
  let sum = 0
  for (let i = 0; i < text.length; i++) sum += text.charCodeAt(i)
  return COLORS[sum % COLORS.length]
}

export default function Avatar({ name, email, size = 32 }) {
  const label = (name || email || '?').trim()
  const initials = label
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

  return (
    <span
      title={name || email}
      className="inline-flex items-center justify-center rounded-full font-semibold text-white shrink-0"
      style={{
        width: size,
        height: size,
        backgroundColor: colorFor(label),
        fontSize: size * 0.4,
      }}
    >
      {initials}
    </span>
  )
}
