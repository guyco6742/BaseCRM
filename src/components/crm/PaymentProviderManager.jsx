import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'
import Button from '../ui/Button'
import Input from '../ui/Input'
import { handleEnterAsTab } from '../../lib/formNav'

// חיבור חשבון סליקה (Cardcom) — אדמינים בלבד, מוצג בהגדרות הארגון
export default function PaymentProviderManager({ orgId }) {
  const { toast } = useToast()
  const [account, setAccount] = useState(null)
  const [loading, setLoading] = useState(true)
  const [terminal, setTerminal] = useState('')
  const [apiName, setApiName] = useState('')
  const [apiPassword, setApiPassword] = useState('')
  const [autoInvoice, setAutoInvoice] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testUrl, setTestUrl] = useState('')

  async function load() {
    const { data } = await supabase.from('payment_provider_accounts')
      .select('*').eq('org_id', orgId).eq('is_archived', false)
      .eq('provider', 'cardcom').limit(1).maybeSingle()
    if (data) {
      setAccount(data)
      setTerminal(data.credentials?.terminal_number ?? '')
      setApiName(data.credentials?.api_name ?? '')
      setApiPassword(data.credentials?.api_password ?? '')
      setAutoInvoice(data.settings?.auto_invoice !== false)
    }
    setLoading(false)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [orgId])

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    const payload = {
      org_id: orgId, provider: 'cardcom', display_name: 'Cardcom',
      credentials: { terminal_number: terminal.trim(), api_name: apiName.trim(), api_password: apiPassword.trim() },
      settings: { auto_invoice: autoInvoice, document_type: 'invoice_receipt', language: 'he' },
    }
    const q = account
      ? supabase.from('payment_provider_accounts').update(payload).eq('id', account.id)
      : supabase.from('payment_provider_accounts').insert(payload)
    const { error } = await q
    setSaving(false)
    if (error) { toast('שמירת החיבור נכשלה.', 'error'); return }
    toast('חיבור הסליקה נשמר')
    await load()
  }

  async function toggleActive() {
    if (!account) return
    const { error } = await supabase.from('payment_provider_accounts')
      .update({ is_active: !account.is_active }).eq('id', account.id)
    if (error) { toast('העדכון נכשל.', 'error'); return }
    await load()
  }

  // בדיקת חיבור: יוצרים לינק אמיתי על ₪1 ללקוח לא-קיים? לא — צריך לקוח. משתמשים בלקוח הראשון בארגון.
  async function testConnection() {
    setTesting(true)
    setTestUrl('')
    try {
      const { data: client } = await supabase.from('clients')
        .select('id').eq('org_id', orgId).eq('is_archived', false).limit(1).maybeSingle()
      if (!client) { toast('נדרש לפחות לקוח אחד בארגון לבדיקה.', 'error'); return }
      const { data, error } = await supabase.functions.invoke('create-payment-link', {
        body: { org_id: orgId, client_id: client.id, amount: 1, description: 'בדיקת חיבור — נא לא לשלם' },
      })
      if (error || data?.error) throw new Error(data?.error || error.message)
      setTestUrl(data.url)
      // מארכבים את תשלום-הבדיקה מיד כדי שלא יזהם את היומן
      const { error: archiveError } = await supabase.from('payments').update({ is_archived: true }).eq('id', data.payment_id)
      if (archiveError) {
        toast('החיבור תקין, אך ניקוי תשלום הבדיקה נכשל — ארכבו אותו ידנית מדף התשלומים.', 'error')
      } else {
        toast('החיבור תקין ✓')
      }
    } catch {
      toast('בדיקת החיבור נכשלה — בדקו את פרטי ה-API.', 'error')
    } finally {
      setTesting(false)
    }
  }

  if (loading) return null

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="payment-provider-manager">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-text">תשלומים וסליקה (Cardcom)</h2>
        {account && (
          <button type="button" onClick={toggleActive}
            className={`rounded-full border px-2 py-0.5 text-xs ${account.is_active ? 'border-emerald-500/30 text-emerald-400' : 'border-border text-text-dim'}`}
            data-testid="provider-active-toggle">
            {account.is_active ? 'פעיל' : 'כבוי'}
          </button>
        )}
      </div>
      <form onSubmit={save} onKeyDown={handleEnterAsTab} className="space-y-3">
        <Input label="מספר טרמינל" value={terminal} onChange={(e) => setTerminal(e.target.value)} dir="ltr" data-testid="provider-terminal-input" required />
        <Input label="API Name" value={apiName} onChange={(e) => setApiName(e.target.value)} dir="ltr" data-testid="provider-apiname-input" required />
        <Input label="API Password" type="password" value={apiPassword} onChange={(e) => setApiPassword(e.target.value)} dir="ltr" data-testid="provider-apipassword-input" />
        <label className="flex items-center gap-2 text-sm text-text">
          <input type="checkbox" checked={autoInvoice} onChange={(e) => setAutoInvoice(e.target.checked)} data-testid="provider-autoinvoice-checkbox" />
          הפקת חשבונית מס/קבלה אוטומטית בכל תשלום
        </label>
        <div className="flex gap-2">
          <Button type="submit" loading={saving} data-testid="provider-save-btn">שמירה</Button>
          {account && (
            <Button type="button" variant="secondary" loading={testing} onClick={testConnection} data-testid="provider-test-btn">
              בדוק חיבור
            </Button>
          )}
        </div>
        {testUrl && (
          <p className="text-xs text-text-muted" data-testid="provider-test-url">
            נוצר לינק בדיקה בהצלחה: <a className="text-accent hover:underline" href={testUrl} target="_blank" rel="noreferrer">צפייה (אין לשלם)</a>
          </p>
        )}
      </form>
    </section>
  )
}
