import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'
import Button from '../ui/Button'
import Input from '../ui/Input'
import { handleEnterAsTab } from '../../lib/formNav'
import { PAYMENT_PROVIDERS } from '../../lib/payments'

// חיבור חשבונות סליקה — אדמינים בלבד, מוצג בהגדרות הארגון.
// בחירת ספק מתוך dropdown; הוספת ספק עתידי = ערך ב-PAYMENT_PROVIDERS + כרטיס ב-PROVIDER_CARDS.

// בדיקת חיבור משותפת: יוצרים לינק אמיתי על ₪1 ומארכבים מיד
async function runConnectionTest(orgId, provider, toast, setTestUrl) {
  const { data: client } = await supabase.from('clients')
    .select('id').eq('org_id', orgId).eq('is_archived', false).limit(1).maybeSingle()
  if (!client) { toast('נדרש לפחות לקוח אחד בארגון לבדיקה.', 'error'); return }
  const { data, error } = await supabase.functions.invoke('create-payment-link', {
    body: { org_id: orgId, client_id: client.id, amount: 1, description: 'בדיקת חיבור — נא לא לשלם', provider },
  })
  if (error || data?.error) throw new Error(data?.error || error.message)
  setTestUrl(data.url)
  const { error: archiveError } = await supabase.from('payments').update({ is_archived: true }).eq('id', data.payment_id)
  if (archiveError) {
    toast('החיבור תקין, אך ניקוי תשלום הבדיקה נכשל — ארכבו אותו ידנית מדף התשלומים.', 'error')
  } else {
    toast('החיבור תקין ✓')
  }
}

function ActiveToggle({ account, onToggled, testid }) {
  const { toast } = useToast()
  if (!account) return null
  async function toggle() {
    const { error } = await supabase.from('payment_provider_accounts')
      .update({ is_active: !account.is_active }).eq('id', account.id)
    if (error) { toast('העדכון נכשל.', 'error'); return }
    onToggled()
  }
  return (
    <button type="button" onClick={toggle}
      className={`rounded-full border px-2 py-0.5 text-xs ${account.is_active ? 'border-emerald-500/30 text-emerald-400' : 'border-border text-text-dim'}`}
      data-testid={testid}>
      {account.is_active ? 'פעיל' : 'כבוי'}
    </button>
  )
}

function CardcomCard({ orgId, account, reload }) {
  const { toast } = useToast()
  const [terminal, setTerminal] = useState(account?.credentials?.terminal_number ?? '')
  const [apiName, setApiName] = useState(account?.credentials?.api_name ?? '')
  const [apiPassword, setApiPassword] = useState('')
  const [autoInvoice, setAutoInvoice] = useState(account?.settings?.auto_invoice !== false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testUrl, setTestUrl] = useState('')
  const hasPassword = !!account?.has_password

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.rpc('save_payment_provider_v2', {
      p_org_id: orgId, p_provider: 'cardcom',
      p_credentials: { terminal_number: terminal.trim(), api_name: apiName.trim() },
      p_secret: apiPassword || null,
      p_settings: { auto_invoice: autoInvoice, document_type: 'invoice_receipt', language: 'he' },
    })
    setSaving(false)
    if (error) { toast('שמירת החיבור נכשלה.', 'error'); return }
    toast('חיבור הסליקה נשמר')
    setApiPassword('')
    reload()
  }

  async function test() {
    setTesting(true); setTestUrl('')
    try { await runConnectionTest(orgId, 'cardcom', toast, setTestUrl) }
    catch { toast('בדיקת החיבור נכשלה — בדקו את פרטי ה-API.', 'error') }
    finally { setTesting(false) }
  }

  return (
    <div data-testid="payment-provider-manager">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-muted">חיבור Cardcom</h3>
        <ActiveToggle account={account} onToggled={reload} testid="provider-active-toggle" />
      </div>
      <form onSubmit={save} onKeyDown={handleEnterAsTab} className="space-y-3">
        <Input label="מספר טרמינל" value={terminal} onChange={(e) => setTerminal(e.target.value)} dir="ltr" data-testid="provider-terminal-input" required />
        <Input label="API Name" value={apiName} onChange={(e) => setApiName(e.target.value)} dir="ltr" data-testid="provider-apiname-input" required />
        <Input label="API Password" type="password" value={apiPassword} onChange={(e) => setApiPassword(e.target.value)} dir="ltr"
          placeholder={hasPassword ? '•••••• — שמורה. השאירו ריק כדי לא לשנות' : ''}
          autoComplete="new-password" data-testid="provider-apipassword-input" />
        <label className="flex items-center gap-2 text-sm text-text">
          <input type="checkbox" checked={autoInvoice} onChange={(e) => setAutoInvoice(e.target.checked)} data-testid="provider-autoinvoice-checkbox" />
          הפקת חשבונית מס/קבלה אוטומטית בכל תשלום
        </label>
        <div className="flex gap-2">
          <Button type="submit" loading={saving} data-testid="provider-save-btn">שמירה</Button>
          {account && (
            <Button type="button" variant="secondary" loading={testing} onClick={test} data-testid="provider-test-btn">בדוק חיבור</Button>
          )}
        </div>
        {testUrl && (
          <p className="text-xs text-text-muted" data-testid="provider-test-url">
            נוצר לינק בדיקה בהצלחה: <a className="text-accent hover:underline" href={testUrl} target="_blank" rel="noreferrer">צפייה (אין לשלם)</a>
          </p>
        )}
      </form>
    </div>
  )
}

function GrowCard({ orgId, account, reload }) {
  const { toast } = useToast()
  const [userId, setUserId] = useState(account?.credentials?.user_id ?? '')
  const [pageCode, setPageCode] = useState(account?.credentials?.page_code ?? '')
  const [sandbox, setSandbox] = useState(account?.credentials?.sandbox !== false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testUrl, setTestUrl] = useState('')

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.rpc('save_payment_provider_v2', {
      p_org_id: orgId, p_provider: 'grow',
      p_credentials: { user_id: userId.trim(), page_code: pageCode.trim(), sandbox },
      p_secret: null, p_settings: {},
    })
    setSaving(false)
    if (error) { toast('שמירת החיבור נכשלה.', 'error'); return }
    toast('חיבור הסליקה נשמר')
    reload()
  }

  async function test() {
    setTesting(true); setTestUrl('')
    try { await runConnectionTest(orgId, 'grow', toast, setTestUrl) }
    catch (e) {
      toast(e?.message === 'client_phone_required'
        ? 'ללקוח הבדיקה אין טלפון נייד תקין — נדרש עבור Grow.'
        : 'בדיקת החיבור נכשלה — בדקו את פרטי החיבור.', 'error')
    }
    finally { setTesting(false) }
  }

  return (
    <div data-testid="payment-provider-grow">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-muted">חיבור Grow</h3>
        <ActiveToggle account={account} onToggled={reload} testid="provider-grow-active-toggle" />
      </div>
      <form onSubmit={save} onKeyDown={handleEnterAsTab} className="space-y-3">
        <Input label="User ID" value={userId} onChange={(e) => setUserId(e.target.value)} dir="ltr" data-testid="provider-grow-userid-input" required />
        <Input label="Page Code" value={pageCode} onChange={(e) => setPageCode(e.target.value)} dir="ltr" data-testid="provider-grow-pagecode-input" required />
        <label className="flex items-center gap-2 text-sm text-text">
          <input type="checkbox" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} data-testid="provider-grow-sandbox-checkbox" />
          סביבת בדיקות (Sandbox)
        </label>
        <p className="text-xs text-text-muted">חשבוניות מונפקות דרך מודול החשבוניות של Grow (מוגדר בחשבון Grow שלכם), לא דרך המערכת.</p>
        <div className="flex gap-2">
          <Button type="submit" loading={saving} data-testid="provider-grow-save-btn">שמירה</Button>
          {account && (
            <Button type="button" variant="secondary" loading={testing} onClick={test} data-testid="provider-grow-test-btn">בדוק חיבור</Button>
          )}
        </div>
        {testUrl && (
          <p className="text-xs text-text-muted" data-testid="provider-grow-test-url">
            נוצר לינק בדיקה בהצלחה: <a className="text-accent hover:underline" href={testUrl} target="_blank" rel="noreferrer">צפייה (אין לשלם)</a>
          </p>
        )}
      </form>
    </div>
  )
}

// רישום כרטיסי ההגדרות — ספק חדש נוסף כאן וב-PAYMENT_PROVIDERS ותו לא
const PROVIDER_CARDS = { cardcom: CardcomCard, grow: GrowCard }

export default function PaymentProviderManager({ orgId }) {
  const [accounts, setAccounts] = useState(null) // null = טוען
  const [selected, setSelected] = useState('')   // '' = טרם נבחר ידנית

  const load = useCallback(async () => {
    const { data } = await supabase.from('payment_provider_accounts_safe')
      .select('*').eq('org_id', orgId).eq('is_archived', false)
    setAccounts(data ?? [])
  }, [orgId])
  useEffect(() => { load() }, [load])

  if (accounts === null) return null
  const byProvider = Object.fromEntries(accounts.map((a) => [a.provider, a]))
  // ברירת מחדל: הספק המחובר הראשון לפי סדר הרישום; אין מחובר — הראשון ברשימה
  const providerKeys = Object.keys(PROVIDER_CARDS)
  const current = selected || providerKeys.find((k) => byProvider[k]) || providerKeys[0]
  const Card = PROVIDER_CARDS[current]

  function statusSuffix(key) {
    const acc = byProvider[key]
    if (!acc) return ''
    return acc.is_active ? ' — מחובר ופעיל' : ' — מחובר (כבוי)'
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4 space-y-4" data-testid="payment-provider-settings">
      <h2 className="font-semibold text-text">תשלומים וסליקה</h2>
      <label className="block">
        <span className="mb-1 block text-sm text-text-muted">ספק סליקה</span>
        <select value={current} onChange={(e) => setSelected(e.target.value)}
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text outline-none focus:border-accent"
          data-testid="settings-provider-select">
          {providerKeys.map((key) => (
            <option key={key} value={key}>{PAYMENT_PROVIDERS[key]?.label || key}{statusSuffix(key)}</option>
          ))}
        </select>
      </label>
      {/* key מאלץ רימאונט אחרי טעינה-מחדש כדי לרענן ערכים התחלתיים מהשרת */}
      <Card key={`${current}-${byProvider[current]?.id ?? 'new'}`} orgId={orgId} account={byProvider[current]} reload={load} />
    </section>
  )
}
