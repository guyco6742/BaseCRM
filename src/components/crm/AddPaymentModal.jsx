import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { PAYMENT_METHODS, PAYMENT_PROVIDERS } from '../../lib/payments'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import Input from '../ui/Input'
import { handleEnterAsTab } from '../../lib/formNav'

// מצב "רישום ידני" — תשלום שנגבה מחוץ למערכת (מזומן/העברה/צ׳ק)
// מצב "קישור לתשלום" — יצירת קישור סליקה (Cardcom) לשליחה ללקוח
export default function AddPaymentModal({ open, onClose, orgId, clientId, clientPhone, onSaved }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const [mode, setMode] = useState('manual')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [method, setMethod] = useState('cash')
  const [alreadyPaid, setAlreadyPaid] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [maxInstallments, setMaxInstallments] = useState(1)
  const [createdLink, setCreatedLink] = useState('')
  const [providers, setProviders] = useState([])   // ספקים פעילים של הארגון
  const [provider, setProvider] = useState('')

  useEffect(() => {
    if (!open) return
    supabase.from('payment_provider_accounts_safe')
      .select('provider').eq('org_id', orgId).eq('is_archived', false).eq('is_active', true)
      .then(({ data }) => {
        const list = (data ?? []).map((a) => a.provider)
        setProviders(list)
        setProvider(list.includes('cardcom') ? 'cardcom' : (list[0] ?? ''))
      })
  }, [open, orgId])

  function handleClose() {
    setCreatedLink('')
    setError('')
    onClose()
  }

  async function createLink(e) {
    e.preventDefault()
    const amt = Number(amount)
    if (!amt || amt <= 0) { setError('יש להזין סכום חיובי.'); return }
    setSaving(true); setError('')
    const { data, error: err } = await supabase.functions.invoke('create-payment-link', {
      body: {
        org_id: orgId, client_id: clientId, amount: amt, description: description.trim(),
        max_installments: Number(maxInstallments) || 1,
        ...(providers.length > 1 ? { provider } : {}),
      },
    })
    setSaving(false)
    if (err || data?.error) {
      const code = data?.error
      setError(
        code === 'no active provider' ? 'אין חשבון סליקה פעיל — חברו ספק בהגדרות הארגון.'
        : code === 'client_phone_required' ? 'ללקוח אין מספר טלפון נייד תקין — נדרש עבור סליקה ב-Grow. עדכנו את כרטיס הלקוח.'
        : code === 'provider_required' ? 'יש לבחור ספק סליקה.'
        : 'יצירת הקישור נכשלה.')
      return
    }
    setCreatedLink(data.url)
    onSaved?.()
  }

  async function save(e) {
    e.preventDefault()
    const amt = Number(amount)
    if (!amt || amt <= 0) { setError('יש להזין סכום חיובי.'); return }
    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('payments').insert({
      org_id: orgId,
      client_id: clientId,
      amount: amt,
      description: description.trim() || null,
      method,
      status: alreadyPaid ? 'paid' : 'pending',
      paid_at: alreadyPaid ? new Date().toISOString() : null,
      created_by: user?.id ?? null,
    })
    setSaving(false)
    if (err) { setError('שמירת התשלום נכשלה.'); return }
    toast('התשלום נשמר')
    setAmount(''); setDescription(''); setMethod('cash'); setAlreadyPaid(true)
    onSaved?.()
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="הוספת תשלום" testid="add-payment-modal">
      <div className="mb-3 flex gap-1 rounded-md border border-border p-1 text-sm">
        {[['manual', 'רישום ידני'], ['link', 'קישור לתשלום']].map(([m, label]) => (
          <button key={m} type="button" onClick={() => { setMode(m); setError(''); setCreatedLink('') }}
            className={`flex-1 rounded px-2 py-1 ${mode === m ? 'bg-accent text-white' : 'text-text-muted hover:bg-surface-2'}`}
            data-testid={`payment-mode-${m}`}>{label}</button>
        ))}
      </div>

      {mode === 'manual' ? (
        <form onSubmit={save} onKeyDown={handleEnterAsTab} className="space-y-3">
          <Input label="סכום (₪)" type="number" step="0.01" min="0" value={amount}
            onChange={(e) => setAmount(e.target.value)} data-testid="payment-amount-input" required />
          <Input label="תיאור" value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="למשל: חוג ג׳ודו — יולי" data-testid="payment-description-input" />
          <label className="block">
            <span className="mb-1 block text-sm text-text-muted">אמצעי תשלום</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)}
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text outline-none focus:border-accent"
              data-testid="payment-method-select">
              {Object.entries(PAYMENT_METHODS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={alreadyPaid} onChange={(e) => setAlreadyPaid(e.target.checked)}
              data-testid="payment-already-paid-checkbox" />
            התשלום כבר בוצע
          </label>
          {error && <p className="text-sm text-status-red" data-testid="payment-error">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={handleClose}>ביטול</Button>
            <Button type="submit" loading={saving} data-testid="payment-save-btn">שמירה</Button>
          </div>
        </form>
      ) : (
        <form onSubmit={createLink} onKeyDown={handleEnterAsTab} className="space-y-3">
          <Input label="סכום (₪)" type="number" step="0.01" min="0" value={amount}
            onChange={(e) => setAmount(e.target.value)} data-testid="payment-amount-input" required />
          <Input label="תיאור" value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="למשל: חוג ג׳ודו — יולי" data-testid="payment-description-input" />
          {providers.length > 1 && (
            <label className="block">
              <span className="mb-1 block text-sm text-text-muted">ספק סליקה</span>
              <select value={provider} onChange={(e) => setProvider(e.target.value)}
                className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text outline-none focus:border-accent"
                data-testid="payment-provider-select">
                {providers.map((pr) => (
                  <option key={pr} value={pr}>{PAYMENT_PROVIDERS[pr]?.label || pr}</option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-sm text-text-muted">מספר תשלומים מקסימלי</span>
            <select value={maxInstallments} onChange={(e) => setMaxInstallments(e.target.value)}
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text outline-none focus:border-accent"
              data-testid="payment-installments-select">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          {error && <p className="text-sm text-status-red" data-testid="payment-error">{error}</p>}

          {createdLink && (
            <div className="space-y-2 rounded-md border border-border bg-bg p-3">
              <input readOnly dir="ltr" value={createdLink} onFocus={(e) => e.target.select()}
                className="w-full truncate rounded-md border border-border bg-surface px-2 py-1.5 text-xs" data-testid="payment-link-url" />
              <div className="flex gap-2">
                <Button size="sm" type="button" variant="secondary"
                  onClick={() => navigator.clipboard.writeText(createdLink)} data-testid="payment-link-copy">העתק</Button>
                {clientPhone && (
                  <a className="inline-flex items-center rounded-md bg-emerald-600 px-2.5 py-1 text-sm text-white hover:bg-emerald-500"
                    target="_blank" rel="noreferrer" data-testid="payment-link-whatsapp"
                    href={`https://wa.me/${clientPhone.replace(/\D/g, '').replace(/^0/, '972')}?text=${encodeURIComponent(`שלום, לתשלום עבור "${description}" בסך ₪${amount}: ${createdLink}`)}`}>
                    שליחה בוואטסאפ
                  </a>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={handleClose}>סגירה</Button>
            {!createdLink && (
              <Button type="submit" loading={saving} data-testid="payment-link-create-btn">יצירת קישור</Button>
            )}
          </div>
        </form>
      )}
    </Modal>
  )
}
