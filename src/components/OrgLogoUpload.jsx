import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import OrgLogo from './OrgLogo'
import Button from './ui/Button'

// העלאת לוגו לארגון — לאדמין/סופר-אדמין בלבד (נאכף גם ב-RLS וב-RPC)
export default function OrgLogoUpload({ org, onUploaded }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    if (!file.type.startsWith('image/')) {
      setError('יש לבחור קובץ תמונה.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('הקובץ גדול מדי (מקסימום 2MB).')
      return
    }
    setBusy(true)
    try {
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'png'
      const path = `${org.id}/logo-${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage.from('logos').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('logos').getPublicUrl(path)
      const { error: rpcErr } = await supabase.rpc('set_org_logo', {
        p_org_id: org.id,
        p_logo_url: data.publicUrl,
      })
      if (rpcErr) throw rpcErr
      onUploaded?.(data.publicUrl)
    } catch {
      setError('העלאת הלוגו נכשלה.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="flex items-center gap-4" data-testid="org-logo-upload">
      <OrgLogo org={org} size={56} testid="org-logo-preview" />
      <div>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          data-testid="org-logo-upload-btn"
        >
          {busy ? 'מעלה...' : org?.logo_url ? 'החלף לוגו' : 'העלה לוגו'}
        </Button>
        <p className="mt-1 text-xs text-text-dim">PNG/JPG, עד 2MB</p>
        {error && <p className="mt-1 text-xs text-status-red" data-testid="org-logo-error">{error}</p>}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={handleFile}
          className="hidden"
          data-testid="org-logo-file-input"
        />
      </div>
    </div>
  )
}
