// לוגיקה טהורה של מודול התשלומים — ללא תלות ב-React/Supabase (ניתן לבדיקה ביחידה)

export const PAYMENT_STATUSES = {
  pending:  { label: 'ממתין לתשלום', chipClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  paid:     { label: 'שולם',          chipClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  failed:   { label: 'נכשל',          chipClass: 'bg-red-500/15 text-red-400 border-red-500/30' },
  canceled: { label: 'בוטל',          chipClass: 'bg-red-500/15 text-red-400 border-red-500/30' },
  refunded: { label: 'זוכה',          chipClass: 'bg-gray-500/15 text-gray-400 border-gray-500/30' },
}

export const PAYMENT_METHODS = {
  credit_card:   { label: 'כרטיס אשראי' },
  bit:           { label: 'ביט' },
  cash:          { label: 'מזומן' },
  bank_transfer: { label: 'העברה בנקאית' },
  check:         { label: 'צ׳ק' },
  other:         { label: 'אחר' },
}

export const PAYMENT_PROVIDERS = {
  cardcom: { label: 'Cardcom' },
  grow:    { label: 'Grow' },
}

export function formatAmount(amount, currency = 'ILS') {
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency, minimumFractionDigits: 2 }).format(Number(amount) || 0)
}

export function sumByStatus(payments) {
  const acc = { pending: 0, paid: 0 }
  for (const p of payments || []) {
    if (p.is_archived) continue
    if (p.status === 'pending') acc.pending += Number(p.amount) || 0
    if (p.status === 'paid') acc.paid += Number(p.amount) || 0
  }
  return acc
}

export function filterPayments(payments, { status, clientId, from, to } = {}) {
  return (payments || []).filter((p) => {
    if (status && p.status !== status) return false
    if (clientId && p.client_id !== clientId) return false
    const t = new Date(p.created_at).getTime()
    if (from && t < new Date(from + 'T00:00:00').getTime()) return false
    if (to && t > new Date(to + 'T23:59:59').getTime()) return false
    return true
  })
}

export const PAYMENT_CSV_HEADERS = ['תאריך', 'לקוח', 'תיאור', 'סכום', 'אמצעי', 'סטטוס', 'שולם בתאריך', 'מס׳ חשבונית']

export function paymentToCSVRow(p, clientName) {
  const d = (v) => (v ? new Date(v).toLocaleDateString('he-IL') : '')
  return [
    d(p.created_at),
    clientName || '',
    p.description || '',
    String(p.amount ?? ''),
    p.method ? PAYMENT_METHODS[p.method]?.label || p.method : '',
    PAYMENT_STATUSES[p.status]?.label || p.status,
    d(p.paid_at),
    p.invoice_number || '',
  ]
}
