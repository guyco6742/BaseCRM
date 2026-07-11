// src/lib/importDedup.js
//
// תאום JS ל-normalize_phone / find_import_duplicates ב-
// supabase/migration_018_import_dedup.sql — כל שינוי בכלל הכפילות כאן חייב
// שינוי מקביל שם (ולהפך). שני הצדדים מיושמים זה מול זה בהערות למטה.
//
// כלל הכפילות (זהה בשני הצדדים, ר' גם §7 Item 6 בספק):
//   norm(name) תואם  AND  (norm(email) תואם  OR  norm(phone) תואם)
//
//   norm(name):  JS  normalizeName  — lower(trim), רווחים פנימיים מכווצים לרווח בודד.
//                SQL normalize_phone-adjacent inline expr in find_import_duplicates —
//                lower(regexp_replace(trim(name), '\s+', ' ', 'g')).
//   norm(email): JS  normalizeEmail — lower(trim); מחרוזת ריקה => null.
//                SQL nullif(lower(trim(email)), '').
//   norm(phone): JS  normalizePhone — ספרות בלבד, 9 הספרות האחרונות; פחות מ-7
//                ספרות (כולל ריק) => null — הסף הזה כלול בתוך ה-JS twin.
//                SQL public.normalize_phone(text) הוא נורמליזר גנרי טהור שכן
//                *לא* כולל את הסף (משמש גם ב-search_org עתידי); find_import_duplicates
//                אוכף את סף 7-הספרות בנפרד לפני שהוא משווה normalize_phone משני הצדדים.
//                תוצאת ה-JS וה-SQL זהה בכל מקרה שנבדק בפועל (שני הצדדים לא-ריקים).
//
// null/ריק לעולם לא "תואם" — גם לא מול null/ריק אחר (נאכף מפורשות למטה,
// לא רק על ידי === בין שני null-ים).

export function normalizeName(s) {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function normalizeEmail(s) {
  const v = (s ?? '').trim().toLowerCase()
  return v === '' ? null : v
}

export function normalizePhone(s) {
  const digits = (s ?? '').replace(/\D/g, '')
  if (digits.length < 7) return null
  return digits.slice(-9)
}

// מפתח דה-דופ קריא (לדיבוג/לוגים) — לא משמש להשוואה בפועל, כי "טלפון תואם"
// דורש ששני הצדדים לא-ריקים (לא רק שהמפתחות שווים).
export function rowKey(row) {
  return `${normalizeName(row.name)}|${normalizeEmail(row.email) ?? ''}|${normalizePhone(row.phone) ?? ''}`
}

// שתי שורות הן כפילות זו-של-זו לפי הכלל: אותו שם מנורמל (לא ריק) וגם
// (אותו אימייל מנורמל, שני הצדדים לא-null) OR (אותו טלפון מנורמל, שני הצדדים לא-null).
function isDuplicateRow(a, b) {
  const nameA = normalizeName(a.name)
  const nameB = normalizeName(b.name)
  if (!nameA || nameA !== nameB) return false

  const emailA = normalizeEmail(a.email)
  const emailB = normalizeEmail(b.email)
  if (emailA && emailB && emailA === emailB) return true

  const phoneA = normalizePhone(a.phone)
  const phoneB = normalizePhone(b.phone)
  if (phoneA && phoneB && phoneA === phoneB) return true

  return false
}

// דה-דופ בתוך הקובץ עצמו (לפני קריאת ה-RPC לבדיקה מול לקוחות קיימים):
// שומר את המופע הראשון של כל שורה; כל שורה עוקבת שתואמת כפילות של שורה
// שכבר נשמרה (לפי isDuplicateRow, אותו כלל בדיוק) נספרת ומופיעה ב-skipped.
// row: {name, email, phone, ...שדות נוספים}. מוסיף i = האינדקס המקורי
// (0-based) בקובץ, כדי ש-ImportClientsModal יוכל לשלוח אותו ל-RPC
// ולמפות תשובות (find_import_duplicates) בחזרה לשורה הנכונה.
export function dedupWithinFile(rows) {
  const unique = []
  const skipped = []
  let intraFileDupes = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const isDup = unique.some((u) => isDuplicateRow(u, row))
    if (isDup) {
      intraFileDupes++
      skipped.push({ ...row, i })
    } else {
      unique.push({ ...row, i })
    }
  }

  return { unique, intraFileDupes, skipped }
}
