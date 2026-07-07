import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { LABEL_COLORS } from '../lib/columnTypes'
import { useConfirm } from '../context/ConfirmContext'
import { useToast } from '../context/ToastContext'
import Button from './ui/Button'

// שורת שלב בפייפליין — שם עם טיוטה (נשמר ב-blur), בחירת צבע, סדר והשבתה
function StatusRow({ status, isFirst, isLast, onRename, onRecolor, onMove, onArchive }) {
  const [draft, setDraft] = useState(status.label)
  useEffect(() => setDraft(status.label), [status.label])

  return (
    <div
      className="flex items-center gap-2 rounded-md border border-border bg-bg px-2 py-1.5"
      data-testid={`pipeline-status-${status.id}`}
    >
      <div className="flex flex-col">
        <button
          onClick={() => onMove(status, -1)}
          disabled={isFirst}
          className="leading-none text-text-dim hover:text-text disabled:opacity-30"
          data-testid={`pipeline-move-up-${status.id}`}
        >
          ▲
        </button>
        <button
          onClick={() => onMove(status, 1)}
          disabled={isLast}
          className="leading-none text-text-dim hover:text-text disabled:opacity-30"
          data-testid={`pipeline-move-down-${status.id}`}
        >
          ▼
        </button>
      </div>

      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft.trim() && draft.trim() !== status.label && onRename(status, draft.trim())}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-text outline-none focus:border-accent"
        data-testid={`pipeline-label-${status.id}`}
      />

      <div className="flex gap-1">
        {LABEL_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onRecolor(status, c)}
            className={`h-4 w-4 rounded-full ${status.color === c ? 'ring-2 ring-white' : ''}`}
            style={{ backgroundColor: c }}
            title={c}
          />
        ))}
      </div>

      <button
        onClick={() => onArchive(status)}
        className="text-text-dim hover:text-status-red"
        title="השבת שלב (לקוחות בשלב זה יישארו ללא שלב מוצג)"
        data-testid={`pipeline-archive-${status.id}`}
      >
        🗄
      </button>
    </div>
  )
}

// ניהול פייפליין הלקוחות של הארגון (אדמין) — מוצג בהגדרות הארגון
export default function ClientStatusManager({ orgId }) {
  const confirm = useConfirm()
  const { toast } = useToast()
  const [statuses, setStatuses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    const { data, error } = await supabase
      .from('client_statuses')
      .select('*')
      .eq('org_id', orgId)
      .order('position')
    if (error) {
      setError('טעינת הפייפליין נכשלה (ודאו שמיגרציית ה-CRM רצה).')
    } else {
      setStatuses(data || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  const active = statuses.filter((s) => !s.is_archived)
  const archived = statuses.filter((s) => s.is_archived)

  async function addStatus() {
    const { error } = await supabase.from('client_statuses').insert({
      org_id: orgId,
      label: 'שלב חדש',
      color: LABEL_COLORS[active.length % LABEL_COLORS.length],
      position: (active[active.length - 1]?.position ?? 0) + 1,
    })
    if (error) {
      setError('הוספת השלב נכשלה.')
      toast('הוספת השלב נכשלה.', 'error')
    }
    await load()
  }

  async function rename(status, label) {
    const { error } = await supabase.from('client_statuses').update({ label }).eq('id', status.id)
    await load()
    if (error) toast('שינוי שם השלב נכשל.', 'error')
  }

  async function recolor(status, color) {
    const { error } = await supabase.from('client_statuses').update({ color }).eq('id', status.id)
    await load()
    if (error) toast('שינוי הצבע נכשל.', 'error')
  }

  async function move(status, dir) {
    const idx = active.findIndex((s) => s.id === status.id)
    const other = active[idx + dir]
    if (!other) return
    await Promise.all([
      supabase.from('client_statuses').update({ position: other.position }).eq('id', status.id),
      supabase.from('client_statuses').update({ position: status.position }).eq('id', other.id),
    ])
    await load()
  }

  async function archive(status) {
    const ok = await confirm({
      title: 'השבתת שלב',
      message: `להשבית את השלב "${status.label}"? לקוחות בשלב זה יישארו ללא שלב מוצג. ניתן לשחזר בכל עת.`,
      confirmText: 'השבתה',
      danger: true,
    })
    if (!ok) return
    const { error } = await supabase.from('client_statuses').update({ is_archived: true }).eq('id', status.id)
    await load()
    if (error) toast('השבתת השלב נכשלה.', 'error')
    else toast('השלב הושבת בהצלחה')
  }

  async function restore(status) {
    const { error } = await supabase.from('client_statuses').update({ is_archived: false }).eq('id', status.id)
    await load()
    if (error) toast('שחזור השלב נכשל.', 'error')
    else toast('השלב שוחזר בהצלחה')
  }

  if (loading) return null

  return (
    <section className="mb-8" data-testid="pipeline-manager">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-text">פייפליין לקוחות (CRM)</h2>
        <Button size="sm" variant="secondary" onClick={addStatus} data-testid="pipeline-add-btn">
          + שלב
        </Button>
      </div>

      {error && <p className="mb-2 text-sm text-status-red">{error}</p>}

      <div className="space-y-1">
        {active.map((s, i) => (
          <StatusRow
            key={s.id}
            status={s}
            isFirst={i === 0}
            isLast={i === active.length - 1}
            onRename={rename}
            onRecolor={recolor}
            onMove={move}
            onArchive={archive}
          />
        ))}
      </div>

      {archived.length > 0 && (
        <div className="mt-3">
          <h4 className="mb-1 text-xs font-semibold text-text-dim">שלבים מושבתים</h4>
          <div className="space-y-1">
            {archived.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-md border border-dashed border-border bg-bg/50 px-3 py-1.5"
              >
                <span className="flex items-center gap-2 text-sm text-text-dim">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.label}
                </span>
                <button
                  onClick={() => restore(s)}
                  className="text-sm text-accent hover:underline"
                  data-testid={`pipeline-restore-${s.id}`}
                >
                  שחזר
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
