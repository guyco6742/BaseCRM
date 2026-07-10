import { Link, useParams } from 'react-router-dom'
import { useTitle } from '../lib/useTitle'
import { useDashboard } from '../hooks/useDashboard'
import { formatAmount } from '../lib/payments'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-border bg-surface p-4" data-testid="dashboard-skeleton-card">
      <div className="h-3 w-24 animate-pulse rounded bg-surface-2" />
      <div className="mt-3 h-7 w-16 animate-pulse rounded bg-surface-2" />
    </div>
  )
}

function DeltaArrow({ current, previous }) {
  if (current > previous) {
    return <span className="text-sm font-medium text-emerald-500">▲</span>
  }
  if (current < previous) {
    return <span className="text-sm font-medium text-status-red">▼</span>
  }
  return <span className="text-sm font-medium text-text-dim">—</span>
}

export default function OrgDashboardPage() {
  const { orgId } = useParams()
  useTitle('דשבורד')
  const { data, loading, error, refetch } = useDashboard(orgId)

  if (error) {
    return (
      <div className="mx-auto max-w-6xl p-6" data-testid="dashboard-page">
        <h1 className="mb-4 text-2xl font-bold text-text">דשבורד</h1>
        <div className="rounded-lg border border-status-red/30 bg-status-red/10 p-6 text-center" data-testid="dashboard-error">
          <p className="mb-3 text-text">אין לך גישה לדשבורד הארגון הזה, או שאירעה שגיאה בטעינה.</p>
          <Button variant="secondary" size="sm" onClick={refetch} data-testid="dashboard-retry-btn">נסה שוב</Button>
        </div>
      </div>
    )
  }

  if (loading || !data) {
    return (
      <div className="mx-auto max-w-6xl p-6" data-testid="dashboard-page">
        <h1 className="mb-4 text-2xl font-bold text-text">דשבורד</h1>
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4" data-testid="dashboard-skeleton">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <div className="mb-6 rounded-lg border border-border bg-surface p-4">
          <div className="h-4 w-32 animate-pulse rounded bg-surface-2" />
          <div className="mt-4 space-y-3">
            <div className="h-5 w-full animate-pulse rounded bg-surface-2" />
            <div className="h-5 w-full animate-pulse rounded bg-surface-2" />
            <div className="h-5 w-full animate-pulse rounded bg-surface-2" />
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="h-4 w-40 animate-pulse rounded bg-surface-2" />
        </div>
      </div>
    )
  }

  const { leads_this_month, leads_prev_month, new_clients_this_month, pipeline, payments, overdue_tasks } = data
  const maxCount = Math.max(1, ...(pipeline || []).map((p) => p.count || 0))

  return (
    <div className="mx-auto max-w-6xl p-6" data-testid="dashboard-page">
      <h1 className="mb-4 text-2xl font-bold text-text">דשבורד</h1>

      {/* שורת כרטיסי KPI */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card data-testid="kpi-leads">
          <div className="text-sm text-text-muted">לידים החודש</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-2xl font-bold text-text">{leads_this_month}</span>
            <DeltaArrow current={leads_this_month} previous={leads_prev_month} />
          </div>
        </Card>

        <Card data-testid="kpi-clients">
          <div className="text-sm text-text-muted">לקוחות חדשים החודש</div>
          <div className="mt-1 text-2xl font-bold text-text">{new_clients_this_month}</div>
        </Card>

        <Card data-testid="kpi-pending">
          <div className="text-sm text-text-muted">תשלומים ממתינים</div>
          <div className="mt-1 text-2xl font-bold text-text">{formatAmount(payments?.pending_sum)}</div>
          <div className="mt-0.5 text-xs text-text-dim">{payments?.pending_count ?? 0} תשלומים</div>
        </Card>

        <Link to={`/org/${orgId}/reports?report=overdue_items`} data-testid="kpi-overdue">
          <Card
            className={`h-full transition-colors hover:border-status-red/50 ${
              overdue_tasks > 0 ? 'border-status-red/30 bg-status-red/5' : ''
            }`}
          >
            <div className="text-sm text-text-muted">משימות באיחור</div>
            <div className={`mt-1 text-2xl font-bold ${overdue_tasks > 0 ? 'text-status-red' : 'text-text'}`}>
              {overdue_tasks}
            </div>
          </Card>
        </Link>
      </div>

      {/* פייפליין — עמודות אופקיות */}
      <div className="mb-6 rounded-lg border border-border bg-surface p-4" data-testid="pipeline-section">
        <h2 className="mb-3 text-sm font-semibold text-text-muted">פייפליין לקוחות</h2>
        {(pipeline || []).length === 0 ? (
          <p className="text-sm text-text-dim">אין נתוני פייפליין.</p>
        ) : (
          <div className="space-y-2">
            {pipeline.map((stage) => {
              const pct = stage.count > 0 ? Math.max(4, Math.round((stage.count / maxCount) * 100)) : 2
              return (
                <div
                  key={stage.status_id}
                  className="flex items-center gap-3"
                  data-testid={`pipeline-row-${stage.status_id}`}
                >
                  <span className="flex w-32 shrink-0 items-center gap-2 truncate text-sm text-text">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: stage.color || '#579bfc' }}
                    />
                    <span className="truncate">{stage.label}</span>
                  </span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: stage.color || '#579bfc' }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-end text-sm font-medium text-text">{stage.count}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* רצועת תשלומים */}
      <div className="flex flex-wrap gap-6 rounded-lg border border-border bg-surface p-4 text-sm text-text-muted">
        <span>
          שולם החודש: <b className="text-text">{formatAmount(payments?.paid_this_month_sum)}</b>
        </span>
        <span>
          פיגורים: <b className={payments?.overdue_count > 0 ? 'text-status-red' : 'text-text'}>{payments?.overdue_count ?? 0}</b>
        </span>
      </div>
    </div>
  )
}
