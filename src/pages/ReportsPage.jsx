import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useTitle } from '../lib/useTitle'
import { useOrg } from '../context/OrgContext'
import { PAYMENT_STATUSES, formatAmount } from '../lib/payments'
import { exportRowsToCSV, downloadCSV } from '../lib/csv'
import Button from '../components/ui/Button'

// הגדרת הדוחות הזמינים — ערך פנימי (נשלח ל-RPC וב-?report=) + תווית עברית
const REPORTS = [
  { value: 'leads_by_source_by_month', label: 'לידים לפי מקור וחודש' },
  { value: 'payments_by_status', label: 'תשלומים לפי סטטוס' },
  { value: 'clients_by_status', label: 'לקוחות לפי סטטוס' },
  { value: 'overdue_items', label: 'משימות באיחור' },
]
const REPORT_VALUES = REPORTS.map((r) => r.value)
const DEFAULT_REPORT = REPORT_VALUES[0]

// כותרות עמודות (עברית) לכל דוח — משמשות גם לכותרות הטבלה וגם לכותרות ה-CSV
const COLUMNS = {
  leads_by_source_by_month: ['חודש', 'מקור', 'סה״כ לידים', 'ללא כפילויות'],
  payments_by_status: ['סטטוס', 'כמות', 'סכום'],
  clients_by_status: ['סטטוס', 'כמות'],
  overdue_items: ['פריט', 'בורד', 'קבוצה', 'תאריך יעד'],
}

function rowKey(report, row, i) {
  if (report === 'overdue_items') return row.item_id ?? i
  if (report === 'clients_by_status') return row.status_id ?? `none-${i}`
  if (report === 'payments_by_status') return row.status ?? i
  return `${row.month ?? ''}-${row.source ?? ''}-${i}`
}

// שורת CSV — ערכים גולמיים (לא מעוצבים כמטבע) אבל עם תוויות עבריות במקום ערכי enum
function csvRow(report, row) {
  switch (report) {
    case 'leads_by_source_by_month':
      return [row.month || '', row.source || '', String(row.count ?? ''), String(row.deduped_count ?? '')]
    case 'payments_by_status':
      return [PAYMENT_STATUSES[row.status]?.label || row.status || '', String(row.count ?? ''), String(row.sum ?? '')]
    case 'clients_by_status':
      return [row.label || '', String(row.count ?? '')]
    case 'overdue_items':
      return [row.item_name || '', row.board_name || '', row.group_name || '', row.due_date || '']
    default:
      return []
  }
}

function ReportRow({ report, row, orgId }) {
  if (report === 'leads_by_source_by_month') {
    return (
      <>
        <td className="p-3 text-text-dim">{row.month}</td>
        <td className="p-3 text-text">{row.source || '—'}</td>
        <td className="p-3 font-medium text-text">{row.count}</td>
        <td className="p-3 text-text-muted">{row.deduped_count}</td>
      </>
    )
  }
  if (report === 'payments_by_status') {
    return (
      <>
        <td className="p-3 text-text">{PAYMENT_STATUSES[row.status]?.label || row.status}</td>
        <td className="p-3 font-medium text-text">{row.count}</td>
        <td className="p-3 font-medium text-text">{formatAmount(row.sum)}</td>
      </>
    )
  }
  if (report === 'clients_by_status') {
    return (
      <>
        <td className="p-3 text-text">
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.color || '#94a3b8' }} />
            {row.label}
          </span>
        </td>
        <td className="p-3 font-medium text-text">{row.count}</td>
      </>
    )
  }
  // overdue_items
  return (
    <>
      <td className="p-3">
        <Link to={`/org/${orgId}/board/${row.board_id}?item=${row.item_id}`} className="text-accent hover:underline">
          {row.item_name}
        </Link>
      </td>
      <td className="p-3 text-text-muted">{row.board_name}</td>
      <td className="p-3 text-text-muted">{row.group_name}</td>
      <td className="p-3 text-status-red">{row.due_date}</td>
    </>
  )
}

function TotalsRow({ report, rows }) {
  if (rows.length === 0) return null
  if (report === 'payments_by_status') {
    const totalCount = rows.reduce((s, r) => s + (Number(r.count) || 0), 0)
    const totalSum = rows.reduce((s, r) => s + (Number(r.sum) || 0), 0)
    return (
      <tr className="border-t border-border bg-surface-2/50 font-semibold text-text" data-testid="report-totals">
        <td className="p-3">סה״כ</td>
        <td className="p-3">{totalCount}</td>
        <td className="p-3">{formatAmount(totalSum)}</td>
      </tr>
    )
  }
  if (report === 'clients_by_status') {
    const totalCount = rows.reduce((s, r) => s + (Number(r.count) || 0), 0)
    return (
      <tr className="border-t border-border bg-surface-2/50 font-semibold text-text" data-testid="report-totals">
        <td className="p-3">סה״כ</td>
        <td className="p-3">{totalCount}</td>
      </tr>
    )
  }
  if (report === 'leads_by_source_by_month') {
    const totalCount = rows.reduce((s, r) => s + (Number(r.count) || 0), 0)
    return (
      <tr className="border-t border-border bg-surface-2/50 font-semibold text-text" data-testid="report-totals">
        <td className="p-3">סה״כ</td>
        <td className="p-3" />
        <td className="p-3">{totalCount}</td>
        <td className="p-3" />
      </tr>
    )
  }
  return null
}

function SkeletonRows({ columnCount }) {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <tr key={i} className="border-b border-border/50">
          {Array.from({ length: columnCount }).map((_, c) => (
            <td key={c} className="p-3">
              <div className="h-4 w-full animate-pulse rounded bg-surface-2" />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

export default function ReportsPage() {
  const { orgId } = useOrg()
  useTitle('דוחות')
  const [searchParams, setSearchParams] = useSearchParams()

  const [report, setReport] = useState(() => {
    const fromUrl = searchParams.get('report')
    return REPORT_VALUES.includes(fromUrl) ? fromUrl : DEFAULT_REPORT
  })
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadCount, setReloadCount] = useState(0)

  const isOverdue = report === 'overdue_items'
  const columns = COLUMNS[report]

  const refetch = useCallback(() => setReloadCount((n) => n + 1), [])

  function handleReportChange(value) {
    setReport(value)
    setSearchParams({ report: value })
  }

  useEffect(() => {
    if (!orgId) return undefined
    let active = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { data, error: rpcError } = await supabase.rpc('get_org_report', {
          p_org_id: orgId,
          p_report: report,
          p_from: isOverdue ? null : (from || null),
          p_to: isOverdue ? null : (to || null),
        })
        if (rpcError) throw rpcError
        if (!active) return
        setRows(data?.rows || [])
      } catch (err) {
        if (!active) return
        setError(err)
        setRows([])
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [orgId, report, from, to, isOverdue, reloadCount])

  function exportCSV() {
    const csvRows = rows.map((r) => csvRow(report, r))
    downloadCSV(`report-${report}.csv`, exportRowsToCSV(columns, csvRows))
  }

  return (
    <div className="mx-auto max-w-6xl p-6" data-testid="reports-page">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-text">דוחות</h1>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <select
            value={report}
            onChange={(e) => handleReportChange(e.target.value)}
            className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text"
            data-testid="report-select"
          >
            {REPORTS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            disabled={isOverdue}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-text disabled:opacity-50"
            data-testid="report-from"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={isOverdue}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-text disabled:opacity-50"
            data-testid="report-to"
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={exportCSV}
            disabled={rows.length === 0}
            data-testid="report-export"
          >
            ⬇ ייצוא CSV
          </Button>
        </div>
      </div>

      {isOverdue && (
        <p className="mb-3 text-xs text-text-dim">דוח נקודתי — נכון להיום</p>
      )}

      {error ? (
        <div className="rounded-lg border border-status-red/30 bg-status-red/10 p-6 text-center" data-testid="report-error">
          <p className="mb-3 text-text">אירעה שגיאה בטעינת הדוח, או שאין לך גישה.</p>
          <Button variant="secondary" size="sm" onClick={refetch} data-testid="report-retry-btn">נסה שוב</Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm" data-testid="report-table">
            <caption className="sr-only">{REPORTS.find((r) => r.value === report)?.label}</caption>
            <thead>
              <tr className="border-b border-border text-right text-text-muted">
                {columns.map((col) => (
                  <th key={col} scope="col" className="p-3 font-medium">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows columnCount={columns.length} />
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="p-6 text-center text-text-dim" data-testid="report-empty">
                    אין נתונים בטווח שנבחר
                  </td>
                </tr>
              ) : (
                <>
                  {rows.map((row, i) => (
                    <tr key={rowKey(report, row, i)} className="border-b border-border/50">
                      <ReportRow report={report} row={row} orgId={orgId} />
                    </tr>
                  ))}
                  <TotalsRow report={report} rows={rows} />
                </>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
