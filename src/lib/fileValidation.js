// src/lib/fileValidation.js
// אימות קבצים בצד הלקוח (F2) — סנן סיומות + תקרת גודל, לפני העלאה ל-storage.

export const MAX_FILE_MB = 10
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024

// רשימת סיומות מסמכי עסק סבירה
export const ALLOWED_EXTENSIONS = [
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'csv',
  'ppt',
  'pptx',
  'txt',
  'zip',
  'heic',
  'mp4',
  'mp3',
  'wav',
  'eml',
  'msg',
]

function getExtension(fileName) {
  const name = String(fileName || '')
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === name.length - 1) return ''
  return name.slice(dotIndex + 1).toLowerCase()
}

// validateFile(file) => { ok: true } | { ok: false, reason: 'type'|'size', message }
export function validateFile(file) {
  const ext = getExtension(file?.name)

  if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      ok: false,
      reason: 'type',
      message: `סוג הקובץ אינו נתמך (.${ext || '?'})`,
    }
  }

  if (typeof file?.size === 'number' && file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      reason: 'size',
      message: `הקובץ גדול מדי (מקסימום ${MAX_FILE_MB}MB)`,
    }
  }

  return { ok: true }
}
