import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import Popover from './Popover'

const BUCKET = 'attachments'

// עמודת קבצים מצורפים. הערך הוא מערך של { path, name, size }.
// הקבצים נשמרים ב-bucket פרטי; הורדה דרך קישור חתום זמני.
export default function FilesCell({ orgId, itemId, value, onChange, canEdit }) {
  const files = Array.isArray(value) ? value : []
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  async function handleUpload(e) {
    const chosen = [...e.target.files]
    if (chosen.length === 0) return
    setBusy(true)
    setError('')
    try {
      const added = []
      for (const file of chosen) {
        const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
        const path = `${orgId}/${itemId}/${crypto.randomUUID()}.${ext}`
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file)
        if (upErr) throw upErr
        added.push({ path, name: file.name, size: file.size })
      }
      onChange([...files, ...added])
    } catch {
      setError('העלאת הקובץ נכשלה.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function download(f) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(f.path, 60)
    if (error || !data) {
      setError('לא ניתן ליצור קישור הורדה.')
      return
    }
    window.open(data.signedUrl, '_blank')
  }

  // הסרת הקובץ מהפריט — משאירה את הקובץ ב-DB/אחסון (ניתן לשחזר), רק מסירה את הקישור
  function removeRef(f) {
    onChange(files.filter((x) => x.path !== f.path))
  }

  return (
    <Popover
      panelWidth={240}
      panel={() => (
        <div className="w-56 space-y-2">
          {files.length === 0 && <p className="text-sm text-text-dim">אין קבצים מצורפים.</p>}
          {files.map((f) => (
            <div key={f.path} className="flex items-center gap-2 rounded bg-bg px-2 py-1">
              <button
                onClick={() => download(f)}
                className="flex-1 truncate text-start text-sm text-accent hover:underline"
                title={f.name}
              >
                📄 {f.name}
              </button>
              {canEdit && (
                <button
                  onClick={() => removeRef(f)}
                  className="text-text-dim hover:text-status-red"
                  title="הסר קובץ"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {canEdit && (
            <>
              <button
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                className="w-full rounded-md bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
                data-testid="files-upload-btn"
              >
                {busy ? 'מעלה...' : '+ העלאת קובץ'}
              </button>
              <input
                ref={inputRef}
                type="file"
                multiple
                onChange={handleUpload}
                className="hidden"
                data-testid="files-input"
              />
            </>
          )}
          {error && <p className="text-xs text-status-red">{error}</p>}
        </div>
      )}
    >
      <div className="flex h-full items-center justify-center gap-1 px-2 text-sm text-text">
        {files.length > 0 ? (
          <span>📎 {files.length}</span>
        ) : (
          <span className="text-text-dim">📎</span>
        )}
      </div>
    </Popover>
  )
}
