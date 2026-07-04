import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { parseCSV, mapClientRows, buildClientTemplate } from '../../lib/csv'
import Modal from '../ui/Modal'
import Button from '../ui/Button'

// ייבוא לקוחות מקובץ CSV: בחירה → תצוגה מקדימה → אישור → ייבוא
export default function ImportClientsModal({ open, onClose, orgId, statuses, clientFields = [], existingCount, onImported }) {
  const [stage, setStage] = useState('pick') // pick | preview | importing | done
  const [records, setRecords] = useState([])
  const [warnings, setWarnings] = useState([])
  const [importedCount, setImportedCount] = useState(0)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  function reset() {
    setStage('pick')
    setRecords([])
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
      setRecords(recs)
      setWarnings(warns)
      setStage('preview')
    } catch {
      setError('קריאת הקובץ נכשלה. ודאו שזה קובץ CSV תקין.')
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleImport() {
    setStage('importing')
    try {
      // התאמת שם סטטוס מהקובץ לשלב בפייפליין (לא נמצא → השלב הראשון)
      const statusByLabel = new Map(statuses.map((s) => [s.label.trim(), s.id]))
      const defaultStatus = statuses[0]?.id ?? null

      const payload = records.map((r, i) => ({
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
    } catch {
      setError('הייבוא נכשל. נסו שוב.')
      setStage('preview')
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

      {stage === 'preview' && (
        <div className="space-y-4">
          <p className="text-sm text-text">
            נמצאו <b className="text-status-green">{records.length}</b> לקוחות לייבוא.
          </p>
          {warnings.map((w, i) => (
            <p key={i} className="text-xs text-status-orange">
              ⚠ {w}
            </p>
          ))}
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
            <Button onClick={handleImport} data-testid="import-confirm">
              ייבוא {records.length} לקוחות
            </Button>
            <Button variant="ghost" onClick={reset}>
              בחירת קובץ אחר
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
