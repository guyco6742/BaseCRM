import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { parseCSV, mapClientRows, buildClientTemplate } from '../../lib/csv'
import { dedupWithinFile } from '../../lib/importDedup'
import { useToast } from '../../context/ToastContext'
import Modal from '../ui/Modal'
import Button from '../ui/Button'

// ייבוא לקוחות מקובץ CSV: בחירה → בדיקת כפילויות → תצוגה מקדימה → אישור → ייבוא.
// כפילות = שם מנורמל תואם לקוח קיים (לא בארכיון) + (אימייל תואם או טלפון תואם) —
// ר' src/lib/importDedup.js ו-supabase/migration_018_import_dedup.sql (F7).
export default function ImportClientsModal({ open, onClose, orgId, statuses, clientFields = [], existingCount, onImported }) {
  const { toast } = useToast()
  const [stage, setStage] = useState('pick') // pick | checking | preview | importing | done
  const [records, setRecords] = useState([]) // שורות שייובאו בפועל (אחרי כל הדה-דופ)
  const [skippedList, setSkippedList] = useState([]) // [{name, reason}] לתצוגת ה-details
  const [dupeError, setDupeError] = useState('') // הודעה כשבדיקת הכפילויות מול השרת נכשלה
  const [warnings, setWarnings] = useState([])
  const [importedCount, setImportedCount] = useState(0)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  function reset() {
    setStage('pick')
    setRecords([])
    setSkippedList([])
    setDupeError('')
    setWarnings([])
    setImportedCount(0)
    setError('')
  }

  function handleClose() {
    reset()
    onClose?.()
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setDupeError('')
    try {
      const text = await file.text()
      const rows = parseCSV(text)
      const { records: recs, unknownHeaders, skipped } = mapClientRows(rows, clientFields)
      if (recs.length === 0) {
        setError('לא נמצאו שורות תקינות. ודאו שיש עמודת "שם" ושורת כותרות בראש הקובץ.')
        return
      }
      const warns = []
      if (unknownHeaders.length > 0) warns.push(`עמודות שלא זוהו (ידולגו): ${unknownHeaders.join(', ')}`)
      if (skipped > 0) warns.push(`${skipped} שורות ללא שם ידולגו.`)
      setWarnings(warns)

      // דה-דופ תוך-קובצי (JS טהור, בלי קריאת רשת) — לפני בדיקת השרת
      const { unique, skipped: fileDupes } = dedupWithinFile(recs)

      setStage('checking')
      try {
        const { data, error: rpcError } = await supabase.rpc('find_import_duplicates', {
          p_org_id: orgId,
          p_rows: unique.map((r) => ({ i: r.i, name: r.name || '', email: r.email || '', phone: r.phone || '' })),
        })
        if (rpcError) throw rpcError

        const matchByIndex = new Map((data || []).map((m) => [m.i, m.matched_on]))
        const newRows = unique.filter((r) => !matchByIndex.has(r.i))
        const existingDupeRows = unique.filter((r) => matchByIndex.has(r.i))

        setRecords(newRows)
        setSkippedList([
          ...fileDupes.map((r) => ({ name: r.name, reason: 'כפילות בקובץ' })),
          ...existingDupeRows.map((r) => ({
            name: r.name,
            reason: matchByIndex.get(r.i) === 'email' ? 'אימייל' : 'טלפון',
          })),
        ])
        setDupeError('')
        setStage('preview')
      } catch {
        // בדיקת הכפילויות מול השרת נכשלה — לא חוסמים את הייבוא, אבל דורשים
        // אישור מפורש דרך כפתור ייעודי ("ייבוא ללא בדיקת כפילויות"). הדה-דופ
        // התוך-קובצי (JS, ללא רשת) עדיין חל.
        setRecords(unique)
        setSkippedList(fileDupes.map((r) => ({ name: r.name, reason: 'כפילות בקובץ' })))
        setDupeError('בדיקת כפילויות מול לקוחות קיימים נכשלה. אפשר לייבא ללא הבדיקה, או לבטל ולנסות שוב.')
        setStage('preview')
      }
    } catch {
      setError('קריאת הקובץ נכשלה. ודאו שזה קובץ CSV תקין.')
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleImport(rowsToImport) {
    setStage('importing')
    try {
      // התאמת שם סטטוס מהקובץ לשלב בפייפליין (לא נמצא → השלב הראשון)
      const statusByLabel = new Map(statuses.map((s) => [s.label.trim(), s.id]))
      const defaultStatus = statuses[0]?.id ?? null

      const payload = rowsToImport.map((r, i) => ({
        org_id: orgId,
        name: r.name,
        phone: r.phone ?? null,
        email: r.email ?? null,
        company_number: r.company_number ?? null,
        address: r.address ?? null,
        website: r.website ?? null,
        notes: r.notes ?? null,
        status_id: r.status ? (statusByLabel.get(r.status.trim()) ?? defaultStatus) : defaultStatus,
        custom_values: r.custom && Object.keys(r.custom).length ? r.custom : {},
        position: existingCount + i,
      }))

      // הכנסה במנות של 100
      let count = 0
      for (let i = 0; i < payload.length; i += 100) {
        const chunk = payload.slice(i, i + 100)
        const { error } = await supabase.from('clients').insert(chunk)
        if (error) throw error
        count += chunk.length
      }
      setImportedCount(count)
      setStage('done')
      onImported?.()
      toast(`יובאו ${count} לקוחות`)
    } catch {
      setError('הייבוא נכשל. נסו שוב.')
      setStage('preview')
      toast('הייבוא נכשל.', 'error')
    }
  }

  function downloadTemplate() {
    const blob = new Blob([buildClientTemplate(clientFields)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'clients-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const previewCols = ['name', 'phone', 'email', 'status']
  const colLabels = { name: 'שם', phone: 'טלפון', email: 'אימייל', status: 'סטטוס' }

  return (
    <Modal open={open} onClose={handleClose} title="ייבוא לקוחות מ-CSV" size="lg" testid="import-clients-modal">
      {stage === 'pick' && (
        <div className="space-y-4">
          <p className="text-sm text-text-muted">
            בחרו קובץ CSV עם שורת כותרות. עמודת <b className="text-text">שם</b> חובה; נתמכות גם:
            טלפון, אימייל, ח.פ, כתובת, אתר, הערות, סטטוס (לפי שם השלב בפייפליין).
            {clientFields.length > 0 && (
              <>
                {' '}
                כותרות התואמות לשדות המותאמים ימופו אוטומטית:{' '}
                <b className="text-text">{clientFields.map((f) => f.name).join(', ')}</b>.
              </>
            )}
          </p>
          <div className="flex gap-2">
            <Button onClick={() => inputRef.current?.click()} data-testid="import-pick-file">
              בחירת קובץ CSV
            </Button>
            <Button variant="ghost" onClick={downloadTemplate} data-testid="import-download-template">
              ⬇ הורדת תבנית לדוגמה
            </Button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFile}
            className="hidden"
            data-testid="import-file-input"
          />
          {error && <p className="text-sm text-status-red" data-testid="import-error">{error}</p>}
        </div>
      )}

      {stage === 'checking' && (
        <p className="py-6 text-center text-text-muted">בודק כפילויות מול לקוחות קיימים...</p>
      )}

      {stage === 'preview' && (
        <div className="space-y-4" data-testid="import-preview">
          <p className="text-sm text-text">
            <b className="text-status-green" data-testid="import-new-count">
              {records.length}
            </b>{' '}
            שורות חדשות ייווספו,{' '}
            <b className="text-status-orange" data-testid="import-dupe-count">
              {skippedList.length}
            </b>{' '}
            כפילויות ידולגו.
          </p>
          {dupeError && (
            <p className="text-sm text-status-red" data-testid="import-dupe-error">
              ⚠ {dupeError}
            </p>
          )}
          {warnings.map((w, i) => (
            <p key={i} className="text-xs text-status-orange">
              ⚠ {w}
            </p>
          ))}
          {skippedList.length > 0 && (
            <details className="rounded-md border border-border p-2 text-sm">
              <summary className="cursor-pointer text-text-muted">
                הצגת הכפילויות שידולגו ({skippedList.length})
              </summary>
              <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs text-text-dim">
                {skippedList.map((s, i) => (
                  <li key={i}>
                    {s.name} — {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="max-h-56 overflow-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-sidebar text-xs text-text-muted">
                  {previewCols.map((c) => (
                    <th key={c} className="px-3 py-2 text-start font-medium">
                      {colLabels[c]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.slice(0, 8).map((r, i) => (
                  <tr key={i} className="border-t border-border bg-surface">
                    {previewCols.map((c) => (
                      <td key={c} className="truncate px-3 py-1.5 text-text-muted">
                        {r[c] || '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {records.length > 8 && (
              <p className="border-t border-border bg-surface px-3 py-1.5 text-xs text-text-dim">
                ...ועוד {records.length - 8} שורות
              </p>
            )}
          </div>
          {error && <p className="text-sm text-status-red">{error}</p>}
          <div className="flex justify-start gap-2">
            {dupeError ? (
              <Button onClick={() => handleImport(records)} data-testid="import-confirm">
                ייבוא ללא בדיקת כפילויות
              </Button>
            ) : (
              <Button onClick={() => handleImport(records)} data-testid="import-confirm">
                ייבוא {records.length} לקוחות
              </Button>
            )}
            <Button variant="ghost" onClick={reset} data-testid="import-cancel">
              ביטול
            </Button>
          </div>
        </div>
      )}

      {stage === 'importing' && (
        <p className="py-6 text-center text-text-muted">מייבא {records.length} לקוחות...</p>
      )}

      {stage === 'done' && (
        <div className="space-y-4 py-4 text-center">
          <p className="text-lg text-status-green" data-testid="import-success">
            ✓ יובאו {importedCount} לקוחות בהצלחה!
          </p>
          <Button onClick={handleClose}>סגירה</Button>
        </div>
      )}
    </Modal>
  )
}
