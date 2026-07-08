import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useTitle } from '../lib/useTitle'
import { PAYMENT_STATUSES, PAYMENT_METHODS, formatAmount, sumByStatus, filterPayments, paymentToCSVRow, PAYMENT_CSV_HEADERS } from '../lib/payments'
import { exportRowsToCSV, downloadCSV } from '../lib/csv'
import { PaymentStatusChip } from '../components/crm/PaymentsSection'
import Button from '../components/ui/Button'
import LoadingSpinner from '../components/ui/LoadingSpinner'

export default function PaymentsPage() {
  const { orgId } = useParams()
  useTitle('תשלומים')
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('payments')
        .select('*, clients:client_id(id, name)')
        .eq('org_id', orgId)
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
      setPayments(data || [])
      setLoading(false)
    })()
  }, [orgId])

  const filtered = useMemo(
    () => filterPayments(payments, { status: status || undefined, from: from || undefined, to: to || undefined }),
    [payments, status, from, to],
  )
  const totals = sumByStatus(filtered)

  function exportCSV() {
    const rows = filtered.map((p) => paymentToCSVRow(p, p.clients?.name))
    downloadCSV('payments.csv', exportRowsToCSV(PAYMENT_CSV_HEADERS, rows))
  }

  if (loading) return <div className="p-6"><LoadingSpinner label="טוען תשלומים..." /></div>

  return (
    <div className="mx-auto max-w-6xl p-6" data-testid="payments-page">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-text">תשלומים</h1>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text"
            data-testid="payments-status-filter">
            <option value="">כל הסטטוסים</option>
            {Object.entries(PAYMENT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-text" data-testid="payments-from" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-text" data-testid="payments-to" />
          <Button size="sm" variant="secondary" onClick={exportCSV} data-testid="payments-export-btn">⬇ ייצוא CSV</Button>
        </div>
      </div>
      <div className="mb-4 flex gap-6 text-sm text-text-muted" data-testid="payments-page-totals">
        <span>שולם: <b className="text-text">{formatAmount(totals.paid)}</b></span>
        <span>ממתין: <b className="text-text">{formatAmount(totals.pending)}</b></span>
        <span>{filtered.length} תשלומים</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-right text-text-muted">
              <th className="p-3 font-medium">תאריך</th>
              <th className="p-3 font-medium">לקוח</th>
              <th className="p-3 font-medium">תיאור</th>
              <th className="p-3 font-medium">סכום</th>
              <th className="p-3 font-medium">אמצעי</th>
              <th className="p-3 font-medium">סטטוס</th>
              <th className="p-3 font-medium">חשבונית</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} className="border-b border-border/50" data-testid={`payments-page-row-${p.id}`}>
                <td className="p-3 text-text-dim">{new Date(p.created_at).toLocaleDateString('he-IL')}</td>
                <td className="p-3">
                  <Link to={`/org/${orgId}/clients/${p.client_id}`} className="text-accent hover:underline">
                    {p.clients?.name || '—'}
                  </Link>
                </td>
                <td className="p-3 text-text-muted">{p.description}</td>
                <td className="p-3 font-medium text-text">{formatAmount(p.amount)}</td>
                <td className="p-3 text-text-dim">{p.method ? PAYMENT_METHODS[p.method]?.label : ''}</td>
                <td className="p-3"><PaymentStatusChip status={p.status} /></td>
                <td className="p-3">
                  {p.invoice_url && <a className="text-accent hover:underline" href={p.invoice_url} target="_blank" rel="noreferrer">צפייה</a>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-text-dim" data-testid="payments-page-empty">אין תשלומים תואמים.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
