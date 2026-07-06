// הגדרת 11 סוגי העמודות (השדות המותאמים) הנתמכים בבורד

export const COLUMN_TYPES = {
  text: { label: 'טקסט', icon: 'T' },
  long_text: { label: 'טקסט ארוך', icon: '¶' },
  status: { label: 'סטטוס', icon: '●' },
  number: { label: 'מספר', icon: '#' },
  date: { label: 'תאריך', icon: '📅' },
  checkbox: { label: 'תיבת סימון', icon: '✓' },
  person: { label: 'אחראי', icon: '👤' },
  dropdown: { label: 'בחירה מרשימה', icon: '▾' },
  link: { label: 'קישור', icon: '🔗' },
  email: { label: 'אימייל', icon: '✉' },
  phone: { label: 'טלפון', icon: '📞' },
  files: { label: 'קבצים מצורפים', icon: '📎' },
  client: { label: 'לקוח (CRM)', icon: '🤝' },
  // עמודת מערכת — נוצרת אוטומטית בכל בורד, קריאה בלבד, לא נבחרת ידנית
  created_at: { label: 'נוצר בתאריך', icon: '🕒', system: true },
}

// רשימת הסוגים שניתן לבחור ידנית (ללא עמודות מערכת)
export const COLUMN_TYPE_LIST = Object.entries(COLUMN_TYPES)
  .filter(([, meta]) => !meta.system)
  .map(([value, meta]) => ({ value, ...meta }))

// פורמט תאריך ושעה בעברית
export function formatDateTime(value) {
  if (!value) return ''
  try {
    return new Date(value).toLocaleString('he-IL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

// צבעי ברירת המחדל לתגיות סטטוס / בחירה
export const LABEL_COLORS = [
  '#00c875', // ירוק
  '#fdab3d', // כתום
  '#e2445c', // אדום
  '#579bfc', // כחול
  '#a25ddc', // סגול
  '#0073ea', // כחול כהה
  '#66ccff', // תכלת
  '#c4c4c4', // אפור
]

// טקסט תצוגה לערך עמודה בבורד (לפי סוג) — משמש לייצוא CSV.
// ctx: { members, clients }
export function formatColumnValue(column, value, ctx = {}) {
  if (value == null || value === '') return ''
  const s = column.settings || {}
  switch (column.type) {
    case 'created_at':
      return formatDateTime(value)
    case 'client': {
      const c = (ctx.clients || []).find((x) => x.id === value)
      return c?.name || ''
    }
    case 'files':
      return Array.isArray(value) ? value.map((f) => f.name).join('; ') : ''
    case 'checkbox':
      return value ? 'כן' : 'לא'
    case 'status':
      return (s.labels || []).find((l) => l.id === value)?.label || ''
    case 'dropdown':
      return (s.options || []).find((o) => o.id === value)?.label || ''
    case 'person': {
      const m = (ctx.members || []).find((x) => x.user_id === value)
      return m?.full_name || m?.email || ''
    }
    case 'number':
      return `${value}${s.unit ? ' ' + s.unit : ''}`
    default:
      return String(value)
  }
}

// ברירות מחדל ל-settings לפי סוג עמודה חדשה
export function defaultSettings(type) {
  switch (type) {
    case 'status':
      return {
        labels: [
          { id: crypto.randomUUID(), label: 'בעבודה', color: '#fdab3d' },
          { id: crypto.randomUUID(), label: 'הושלם', color: '#00c875' },
          { id: crypto.randomUUID(), label: 'תקוע', color: '#e2445c' },
        ],
      }
    case 'dropdown':
      return { options: [{ id: crypto.randomUUID(), label: 'אפשרות 1' }] }
    case 'number':
      return { unit: '', decimals: 0 }
    default:
      return {}
  }
}
