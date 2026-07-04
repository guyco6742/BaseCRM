// ניתוח CSV בסיסי — תומך במרכאות, פסיקים בתוך שדות, שורות CRLF ו-BOM של Excel

export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // BOM
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"' && field === '') {
      // מרכאות פותחות שדה מצוטט רק בתחילתו; מרכאות באמצע (גרשיים עבריים
      // כמו בע"מ / אחה"צ) נחשבות תו רגיל ולא שוברות את הפרסור
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else if (ch !== '\r') {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  // מסננים שורות ריקות לחלוטין
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

// מיפוי כותרות (עברית/אנגלית) לשדות הבסיס של הלקוח
const HEADER_MAP = {
  'שם': 'name',
  'שם הלקוח': 'name',
  'שם לקוח': 'name',
  'שם הורים': 'name',
  'שם ההורים': 'name',
  'name': 'name',
  'טלפון': 'phone',
  'נייד': 'phone',
  'phone': 'phone',
  'אימייל': 'email',
  'מייל': 'email',
  'email': 'email',
  'ח.פ': 'company_number',
  'ח״פ': 'company_number',
  'חפ': 'company_number',
  'ע.מ': 'company_number',
  'ח.פ / ע.מ': 'company_number',
  'company_number': 'company_number',
  'כתובת': 'address',
  'address': 'address',
  'אתר': 'website',
  'website': 'website',
  'הערות': 'notes',
  'notes': 'notes',
  'סטטוס': 'status',
  'שלב': 'status',
  'status': 'status',
}

const norm = (s) => (s ?? '').trim().toLowerCase()

// המרת ערך CSV לפי סוג השדה המותאם
function convertValue(type, settings, raw) {
  const v = (raw ?? '').trim()
  if (v === '') return undefined
  if (type === 'number') {
    const n = Number(v.replace(/[^\d.-]/g, ''))
    return Number.isNaN(n) ? undefined : n
  }
  if (type === 'checkbox') {
    return ['true', '1', 'כן', 'v', '✓', 'x'].includes(v.toLowerCase())
  }
  if (type === 'status' || type === 'dropdown') {
    // התאמה לפי תווית האפשרות; אם אין התאמה — מדלגים
    const opts = settings?.labels || settings?.options || []
    const match = opts.find((o) => norm(o.label) === norm(v))
    return match ? match.id : undefined
  }
  return v // text / long_text / link / email / phone / date וכו' — כמחרוזת
}

// ממיר שורות CSV לרשומות לקוח.
// clientFields — שדות מותאמים של הארגון: [{ id, name, type, settings }]
// מחזיר { records, unknownHeaders, skipped }.
// כל record: { name, phone, email, company_number, address, website, notes, status, custom: {fieldId: value} }
export function mapClientRows(rows, clientFields = []) {
  if (rows.length === 0) return { records: [], unknownHeaders: [], skipped: 0 }

  const fieldsByName = new Map(clientFields.map((f) => [norm(f.name), f]))
  const headers = rows[0].map((h) => norm(h))

  // כל כותרת: שדה בסיס, שדה מותאם, או לא מזוהה
  const targets = headers.map((h) => {
    if (HEADER_MAP[h]) return { kind: 'base', key: HEADER_MAP[h] }
    const f = fieldsByName.get(h)
    if (f) return { kind: 'custom', field: f }
    return { kind: 'unknown' }
  })
  const unknownHeaders = headers.filter((_, i) => targets[i].kind === 'unknown')

  const records = []
  let skipped = 0
  for (const row of rows.slice(1)) {
    const rec = { custom: {} }
    targets.forEach((t, i) => {
      const raw = row[i]
      if (raw == null || raw.trim() === '') return
      if (t.kind === 'base') {
        rec[t.key] = raw.trim()
      } else if (t.kind === 'custom') {
        const val = convertValue(t.field.type, t.field.settings, raw)
        if (val !== undefined) rec.custom[t.field.id] = val
      }
    })
    if (rec.name) records.push(rec)
    else skipped++ // שורה בלי שם — מדלגים
  }
  return { records, unknownHeaders, skipped }
}

// תבנית CSV להורדה (עם BOM כדי ש-Excel יציג עברית תקין).
// כוללת עמודות בסיס + שמות השדות המותאמים של הארגון.
export function buildClientTemplate(clientFields = []) {
  const baseHeaders = ['שם', 'טלפון', 'אימייל', 'סטטוס', 'הערות']
  const customHeaders = clientFields.map((f) => f.name)
  const headers = [...baseHeaders, ...customHeaders]
  const example = ['ישראל ישראלי', '050-1234567', 'israel@example.com', '', 'לקוח לדוגמה', ...customHeaders.map(() => '')]
  const csv = [headers, example]
    .map((r) => r.map((c) => (c.includes(',') || c.includes('"') ? `"${c.replaceAll('"', '""')}"` : c)).join(','))
    .join('\r\n')
  return '﻿' + csv
}
