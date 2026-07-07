import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { PAYMENT_METHODS } from '../../lib/payments'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import Input from '../ui/Input'
import { handleEnterAsTab } from '../../lib/formNav'

// מצב "רישום ידני" — תשלום שנגבה מחוץ למערכת (מזומן/העברה/צ׳ק)
export default function AddPaymentModal({ open, onClose, orgId, clientId, onSaved }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [method, setMethod] = useState('cash')
  const [alreadyPaid, setAlreadyPaid] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

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
    <Modal open={open} onClose={onClose} title="הוספת תשלום" testid="add-payment-modal">
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
          <Button type="button" variant="ghost" onClick={onClose}>ביטול</Button>
          <Button type="submit" loading={saving} data-testid="payment-save-btn">שמירה</Button>
        </div>
      </form>
    </Modal>
  )
}
