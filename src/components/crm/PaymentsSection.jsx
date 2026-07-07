import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'
import { PAYMENT_STATUSES, PAYMENT_METHODS, formatAmount, sumByStatus } from '../../lib/payments'
import Button from '../ui/Button'
import AddPaymentModal from './AddPaymentModal'

export function PaymentStatusChip({ status }) {
  const s = PAYMENT_STATUSES[status] || { label: status, chipClass: '' }
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${s.chipClass}`}
      data-testid={`payment-status-${status}`}>{s.label}</span>
  )
}

// היסטוריית תשלומים בכרטיס לקוח
export default function PaymentsSection({ orgId, clientId }) {
  const { toast } = useToast()
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('client_id', clientId)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
    if (error) toast('טעינת התשלומים נכשלה (ודאו שמיגרציה 014 רצה).', 'error')
    else setPayments(data || [])
    setLoading(false)
  }, [clientId, toast])

  useEffect(() => { load() }, [load])

  async function markPaid(p) {
    const { error } = await supabase.from('payments')
      .update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', p.id)
    if (error) { toast('העדכון נכשל.', 'error'); return }
    await load()
  }

  async function archivePayment(p) {
    const { error } = await supabase.from('payments').update({ is_archived: true }).eq('id', p.id)
    if (error) { toast('הארכוב נכשל.', 'error'); return }
    await load()
  }

  const totals = sumByStatus(payments)

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="client-payments">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-text">תשלומים</h2>
        <Button size="sm" variant="secondary" onClick={() => setAddOpen(true)} data-testid="payment-add-btn">
          + הוסף תשלום
        </Button>
      </div>
      <div className="mb-3 flex gap-4 text-sm text-text-muted" data-testid="payments-totals">
        <span>שולם: <b className="text-text">{formatAmount(totals.paid)}</b></span>
        <span>ממתין: <b className="text-text">{formatAmount(totals.pending)}</b></span>
      </div>
      {loading ? (
        <p className="text-sm text-text-dim">טוען…</p>
      ) : payments.length === 0 ? (
        <p className="text-sm text-text-dim" data-testid="payments-empty">אין תשלומים עדיין.</p>
      ) : (
        <ul className="divide-y divide-border">
          {payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 py-2" data-testid={`payment-row-${p.id}`}>
              <span className="text-sm text-text-dim">{new Date(p.created_at).toLocaleDateString('he-IL')}</span>
              <span className="font-medium text-text">{formatAmount(p.amount)}</span>
              <span className="flex-1 truncate text-sm text-text-muted">{p.description}</span>
              {p.method && <span className="text-xs text-text-dim">{PAYMENT_METHODS[p.method]?.label}</span>}
              <PaymentStatusChip status={p.status} />
              {p.invoice_url && (
                <a href={p.invoice_url} target="_blank" rel="noreferrer"
                  className="text-xs text-accent hover:underline" data-testid={`payment-invoice-${p.id}`}>חשבונית</a>
              )}
              {p.status === 'pending' && !p.provider_ref && (
                <button type="button" onClick={() => markPaid(p)}
                  className="text-xs text-emerald-400 hover:underline" data-testid={`payment-markpaid-${p.id}`}>
                  סמן כשולם
                </button>
              )}
              <button type="button" onClick={() => archivePayment(p)}
                className="text-xs text-text-dim hover:text-status-red" data-testid={`payment-archive-${p.id}`}>
                ארכב
              </button>
            </li>
          ))}
        </ul>
      )}
      <AddPaymentModal open={addOpen} onClose={() => setAddOpen(false)}
        orgId={orgId} clientId={clientId} onSaved={load} />
    </section>
  )
}
