// src/lib/validation.js
//
// אימות טפסים (F19): פורמט אימייל + פורמט טלפון ישראלי, לשימוש בטופס יצירת
// לקוח (ClientsPage). שני השדות אופציונליים — מחרוזת ריקה תמיד תקינה; רק
// ערך לא-ריק בפורמט שגוי נדחה.

// רגקס אימייל פשוט וסביר (לא RFC5322 מלא — מספיק כדי לתפוס טעויות הקלדה
// נפוצות: חסר @, חסרה נקודה בדומיין, רווחים).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(s) {
  const v = (s ?? '').trim()
  if (v === '') return true
  return EMAIL_RE.test(v)
}

// טלפון ישראלי: משתמש ב-normalizePhone (src/lib/importDedup.js) כדי לקבל
// צורה קנונית (ללא אפסים מובילים/קידומת 972+), ואז בודק אורך — נייד: 9
// ספרות (מתחיל ב-5), קווי-קרקע: 8 ספרות. פרגמטי: לא בודקים את הספרה
// הראשונה בפועל, רק את טווח האורך [8,9] — תואם את דרישת הספק.
import { normalizePhone } from './importDedup'

export function isValidIsraeliPhone(s) {
  const v = (s ?? '').trim()
  if (v === '') return true
  const normalized = normalizePhone(v)
  if (normalized === null) return false
  return normalized.length >= 8 && normalized.length <= 9
}
