import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useTitle } from '../lib/useTitle'
import { PAYMENT_STATUSES, PAYMENT_METHODS, formatAmount, paymentToCSVRow, PAYMENT_CSV_HEADERS } from '../lib/payments'
import { exportRowsToCSV, downloadCSV } from '../lib/csv'
import { PaymentStatusChip } from '../components/crm/PaymentsSection'
import Button from '../components/ui/Button'
import Pagination from '../components/Pagination'
import { usePagedQuery } from '../hooks/usePagedQuery'

// invoice_url מגיע מ-webhook של ספק תשלומים חיצוני (Cardcom/Grow) — לא לתת בו
// אמון עיוור. מחזיר את ה-URL רק אם הוא http/https (חוסם javascript:, data: וכו')
// כדי לא לרנדר href מסוכן; אחרת null → מוצג טקסט רגיל במקום קישור.
function safeHttpUrl(url) {
  if (typeof url !== 'string') return null
  return /^https?:\/\//i.test(url.trim()) ? url : null
}

// שלד טעינה (animate-pulse) לטבלת התשלומים — מוצג בזמן שהעמוד הראשון נטען
// או מתחלף (סינון/עימוד), במקום קפיצת "מסך ריק ואז מלא" (F27).
function PaymentsTableSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface" data-testid="payments-page-skeleton">
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
          {[0, 1, 2, 3, 4].map((i) => (
            <tr key={i} className="border-b border-border/50">
              {[0, 1, 2, 3, 4, 5, 6].map((j) => (
                <td key={j} className="p-3">
                  <div className="h-4 w-full max-w-[8rem] animate-pulse rounded bg-surface-2" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function PaymentsPage() {
  const { orgId } = useParams()
  useTitle('תשלומים')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [exporting, setExporting] = useState(false)

  // ---- שאילתת הבסיס (משותפת לרשימה המעומדת, לצבירת ה-KPI ולייצוא ה-CSV) ----
  // סינון סטטוס וטווח תאריכים בצד שרת (Item 7) — לא עוד .filter בצד לקוח על
  // כל הטבלה. ה-range() עצמו מתווסף רק בצרכנים שצריכים עימוד (usePagedQuery,
  // לולאת הייצוא) — שאילתת ה-KPI רצה בלי range כדי לצבור על כל התוצאות התואמות.
  const baseListQuery = useCallback(() => {
    let q = supabase
      .from('payments')
      .select('*, clients:client_id(id, name)', { count: 'exact' })
      .eq('org_id', orgId)
      .eq('is_archived', false)

    if (status) q = q.eq('status', status)
    if (from) q = q.gte('created_at', from)
    if (to) q = q.lte('created_at', to + 'T23:59:59')

    return q.order('created_at', { ascending: false, nullsFirst: false })
  }, [orgId, status, from, to])

  const buildQuery = useCallback((rangeFrom, rangeTo) => baseListQuery().range(rangeFrom, rangeTo), [baseListQuery])

  const paged = usePagedQuery({
    orgId,
    buildQuery,
    deps: [status, from, to],
  })

  // ---- KPI: סה"כ שולם/ממתין על *כל* התוצאות התואמות (לא רק העמוד המוצג) ----
  // אגרגציה בצד שרת (RPC get_payment_totals) — מחזירה שורות { status, total }
  // עם אותם סינונים כמו הרשימה (status/from/to, null כשלא הוגדר), במקום סריקת
  // כל השורות וצבירה בצד לקוח. שומר על אותה צורת state ({ pending, paid }).
  const [totals, setTotals] = useState({ pending: 0, paid: 0 })
  const [totalsLoading, setTotalsLoading] = useState(true)
  useEffect(() => {
    if (!orgId) return undefined
    let active = true
    async function loadTotals() {
      setTotalsLoading(true)
      const { data, error } = await supabase.rpc('get_payment_totals', {
        p_org_id: orgId,
        p_status: status || null,
        p_from: from || null,
        p_to: to ? to + 'T23:59:59' : null,
      })
      if (!active) return
      if (error) {
        // כשל ה-RPC — לא מפילים את העמוד; מציגים אפסים (fail-graceful).
        setTotals({ pending: 0, paid: 0 })
      } else {
        const next = { pending: 0, paid: 0 }
        for (const row of data || []) {
          if (row.status === 'pending') next.pending = Number(row.total) || 0
          if (row.status === 'paid') next.paid = Number(row.total) || 0
        }
        setTotals(next)
      }
      setTotalsLoading(false)
    }
    loadTotals()
    return () => {
      active = false
    }
  }, [orgId, status, from, to])

  async function exportCSV() {
    setExporting(true)
    try {
      const allRows = []
      const EXPORT_PAGE = 1000
      let rangeFrom = 0
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const rangeTo = rangeFrom + EXPORT_PAGE - 1
        const { data, error: qError, count } = await baseListQuery().range(rangeFrom, rangeTo)
        if (qError) throw qError
        allRows.push(...(data || []))
        if (!data || data.length < EXPORT_PAGE) break
        rangeFrom += EXPORT_PAGE
        if (typeof count === 'number' && rangeFrom >= count) break
      }
      const rows = allRows.map((p) => paymentToCSVRow(p, p.clients?.name))
      downloadCSV('payments.csv', exportRowsToCSV(PAYMENT_CSV_HEADERS, rows))
    } finally {
      setExporting(false)
    }
  }

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
          <Button size="sm" variant="secondary" onClick={exportCSV} loading={exporting} data-testid="payments-export-btn">⬇ ייצוא CSV</Button>
        </div>
      </div>
      <div className="mb-4 flex gap-6 text-sm text-text-muted" data-testid="payments-page-totals">
        <span>שולם: <b className="text-text">{totalsLoading ? '…' : formatAmount(totals.paid)}</b></span>
        <span>ממתין: <b className="text-text">{totalsLoading ? '…' : formatAmount(totals.pending)}</b></span>
        <span>{paged.total.toLocaleString('he')} תשלומים</span>
      </div>
      {paged.loading ? (
        <PaymentsTableSkeleton />
      ) : (
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
              {paged.rows.map((p) => (
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
                    {safeHttpUrl(p.invoice_url) ? (
                      <a className="text-accent hover:underline" href={safeHttpUrl(p.invoice_url)} target="_blank" rel="noreferrer">צפייה</a>
                    ) : (
                      p.invoice_url && <span className="text-text-dim">חשבונית</span>
                    )}
                  </td>
                </tr>
              ))}
              {paged.rows.length === 0 && (
                <tr><td colSpan={7} className="p-6 text-center text-text-dim" data-testid="payments-page-empty">אין תשלומים תואמים.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <div data-testid="payments-pagination">
        <Pagination
          page={paged.page}
          setPage={paged.setPage}
          pageSize={paged.pageSize}
          setPageSize={paged.setPageSize}
          total={paged.total}
        />
      </div>
    </div>
  )
}
