// לוגיקה טהורה לטבלת הלקוחות: בניית העמודות, מיון וסינון.
// מבודד מה-UI כדי שיהיה קל להבין ולבדוק.

// עמודות הבסיס (שדות המובנים של לקוח). כל אחת עם kind שקובע איך שולפים/ממיינים.
export const BASE_COLUMNS = [
  { key: 'name', label: 'שם', kind: 'name' },
  { key: 'status', label: 'סטטוס', kind: 'status' },
  { key: 'phone', label: 'טלפון', kind: 'phone' },
  { key: 'email', label: 'אימייל', kind: 'email' },
  { key: 'contacts', label: 'אנשי קשר', kind: 'contacts' },
]

// בונה את רשימת העמודות: בסיס + שדה מותאם לכל field (שכבר סונן ל"גלוי").
export function buildColumns(fields) {
  const custom = (fields || []).map((f) => ({
    key: `f:${f.id}`,
    label: f.name,
    kind: 'custom',
    field: f,
  }))
  return [...BASE_COLUMNS, ...custom]
}

// רשימת התוויות/אפשרויות של שדה בחירה (status או dropdown).
function choiceList(field) {
  const s = field?.settings || {}
  return field?.type === 'status' ? s.labels || [] : s.options || []
}

function choiceLabel(field, value) {
  return choiceList(field).find((o) => o.id === value)?.label ?? ''
}

// האם העמודה היא "בחירה" (סינון לפי ערך מרשימה, לא לפי טקסט חופשי).
export function isChoiceColumn(col) {
  if (!col) return false
  if (col.kind === 'status') return true
  if (col.kind === 'custom') return ['status', 'dropdown', 'person'].includes(col.field.type)
  return false
}

// מזהה הערך הגולמי בעמודת בחירה (id של סטטוס / תווית / אפשרות / משתמש).
export function getChoiceId(client, col) {
  if (col.kind === 'status') return client.status_id ?? null
  if (col.kind === 'custom') return client.custom_values?.[col.field.id] ?? null
  return null
}

// האפשרויות לסינון בעמודת בחירה → [{ value, label, color? }] או null לשדה טקסט.
export function filterOptionsFor(col, ctx = {}) {
  if (!col) return null
  if (col.kind === 'status') {
    return (ctx.statuses || []).map((s) => ({ value: s.id, label: s.label, color: s.color }))
  }
  if (col.kind === 'custom') {
    const f = col.field
    if (f.type === 'status') return (f.settings?.labels || []).map((l) => ({ value: l.id, label: l.label, color: l.color }))
    if (f.type === 'dropdown') return (f.settings?.options || []).map((o) => ({ value: o.id, label: o.label }))
    if (f.type === 'person') return (ctx.members || []).map((m) => ({ value: m.user_id, label: m.full_name || m.email }))
  }
  return null // טקסט/מספר/תאריך → סינון "מכיל"
}

// ערך להשוואה במיון (מספר או מחרוזת). מחזיר '' לערך ריק.
export function getSortValue(client, col, ctx = {}) {
  switch (col.kind) {
    case 'name':
      return client.name || ''
    case 'phone':
      return client.phone || ''
    case 'email':
      return client.email || ''
    case 'status': {
      const st = (ctx.statuses || []).find((s) => s.id === client.status_id)
      return st?.label || ''
    }
    case 'contacts':
      return client.contacts?.[0]?.count ?? 0
    case 'custom': {
      const f = col.field
      const v = client.custom_values?.[f.id]
      if (v == null || v === '') return ''
      switch (f.type) {
        case 'status':
        case 'dropdown':
          return choiceLabel(f, v)
        case 'person': {
          const m = (ctx.members || []).find((x) => x.user_id === v)
          return m?.full_name || m?.email || ''
        }
        case 'number':
          return Number(v)
        case 'checkbox':
          return v ? 1 : 0
        case 'date':
          return v // ISO — ממוין כרונולוגית כמחרוזת
        default:
          return String(v)
      }
    }
    default:
      return ''
  }
}

// טקסט התא לצורך סינון "מכיל".
export function getCellText(client, col, ctx = {}) {
  const v = getSortValue(client, col, ctx)
  return v === '' || v == null ? '' : String(v)
}

function isEmpty(v) {
  return v === '' || v == null
}

function compare(a, b, dir) {
  let r
  if (typeof a === 'number' && typeof b === 'number') r = a - b
  else r = String(a).localeCompare(String(b), 'he', { numeric: true, sensitivity: 'base' })
  return dir === 'desc' ? -r : r
}

// ממיין עותק של הרשימה. ערכים ריקים תמיד בסוף (בשני הכיוונים).
export function sortClients(clients, sort, ctx = {}) {
  if (!sort || !sort.key) return clients
  const col = (ctx.columns || []).find((c) => c.key === sort.key)
  if (!col) return clients
  const dir = sort.dir === 'desc' ? 'desc' : 'asc'
  return clients
    .map((c) => ({ c, v: getSortValue(c, col, ctx) }))
    .sort((x, y) => {
      const ex = isEmpty(x.v)
      const ey = isEmpty(y.v)
      if (ex && ey) return 0
      if (ex) return 1
      if (ey) return -1
      return compare(x.v, y.v, dir)
    })
    .map((w) => w.c)
}

// בדיקה אם לקוח עומד בכל הסינונים (וגם). filter = { key, value }.
export function matchesFilters(client, filters, ctx = {}) {
  return (filters || []).every((f) => {
    const col = (ctx.columns || []).find((c) => c.key === f.key)
    if (!col) return true
    if (isChoiceColumn(col)) return getChoiceId(client, col) === f.value
    // טקסט/מספר → "מכיל" (לא תלוי רישיות)
    return getCellText(client, col, ctx).toLowerCase().includes(String(f.value).toLowerCase())
  })
}

// תיאור סינון לצ'יפ: "עמודה: ערך".
export function describeFilter(f, ctx = {}) {
  const col = (ctx.columns || []).find((c) => c.key === f.key)
  if (!col) return ''
  if (isChoiceColumn(col)) {
    const opt = (filterOptionsFor(col, ctx) || []).find((o) => o.value === f.value)
    return `${col.label}: ${opt?.label ?? f.value}`
  }
  return `${col.label}: "${f.value}"`
}
