// src/lib/orgStorage.js
// מפתחות localStorage מבודדים פר-ארגון + מיגרציה חד-פעמית ממפתח גלובלי ישן (F15).
//
// למה: העדפות תצוגה (מיון/תצוגה) נשמרו תחת מפתח גלובלי אחד, כך שמשתמש בכמה
// ארגונים "גרר" העדפה מארגון אחד למשנהו. הפתרון: מפתח לכל ארגון, עם אימוץ
// חד-פעמי של הערך הישן לארגון הנוכחי בלבד (ואז מחיקתו) — כדי לא לאבד העדפות
// קיימות בשדרוג.

/** בונה מפתח localStorage מבודד לארגון עבור שם העדפה נתון. */
export function orgKey(orgId, name) {
  return `basecrm.${orgId}.${name}`
}

/**
 * קורא העדפה מבודדת-ארגון. אם קיים ערך תחת המפתח החדש — הוא המנצח.
 * אחרת, אם סופק legacyKey וקיים בו ערך — הוא מאומץ (חד-פעמית) לארגון הנוכחי
 * (נכתב תחת המפתח החדש) והמפתח הישן נמחק. אם אין דבר בשום מקום — מוחזר null.
 */
export function readOrgPref(orgId, name, legacyKey = null) {
  const key = orgKey(orgId, name)
  const v = localStorage.getItem(key)
  if (v !== null) return v
  if (legacyKey) {
    const legacy = localStorage.getItem(legacyKey)
    if (legacy !== null) {
      localStorage.setItem(key, legacy) // אימוץ חד-פעמי לארגון הנוכחי
      localStorage.removeItem(legacyKey)
      return legacy
    }
  }
  return null
}

/** כותב העדפה תחת המפתח המבודד-ארגון. */
export function writeOrgPref(orgId, name, value) {
  localStorage.setItem(orgKey(orgId, name), value)
}
