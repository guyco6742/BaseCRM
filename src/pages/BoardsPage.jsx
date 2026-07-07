import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import { useConfirm } from '../context/ConfirmContext'
import { useToast } from '../context/ToastContext'
import { useTitle } from '../lib/useTitle'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Input from '../components/ui/Input'
import { defaultSettings } from '../lib/columnTypes'
import { handleEnterAsTab } from '../lib/formNav'

export default function BoardsPage() {
  const { wsId } = useParams()
  const { orgId, isAdmin, structureVersion, refreshStructure } = useOrg()
  const confirm = useConfirm()
  const { toast } = useToast()
  const [workspace, setWorkspace] = useState(null)
  const [boards, setBoards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [wsRes, bRes] = await Promise.all([
        supabase.from('workspaces').select('*').eq('id', wsId).maybeSingle(),
        supabase.from('boards').select('*').eq('workspace_id', wsId).order('position'),
      ])
      if (bRes.error) throw bRes.error
      setWorkspace(wsRes.data)
      setBoards(bRes.data || [])
    } catch {
      setError('טעינת הבורדים נכשלה.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId, structureVersion])

  useTitle(workspace?.name || 'בורדים')

  // יצירת בורד חדש + קבוצה ראשונה + עמודות ברירת מחדל (סטטוס, אחראי, תאריך)
  async function handleCreate(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const { data: board, error: bErr } = await supabase
        .from('boards')
        .insert({
          org_id: orgId,
          workspace_id: wsId,
          name: name.trim(),
          position: boards.length,
        })
        .select()
        .single()
      if (bErr) throw bErr

      // עמודות ברירת מחדל (כולל עמודת מערכת "נוצר בתאריך")
      await supabase.from('columns').insert([
        { org_id: orgId, board_id: board.id, name: 'סטטוס', type: 'status', settings: defaultSettings('status'), position: 0 },
        { org_id: orgId, board_id: board.id, name: 'אחראי', type: 'person', settings: {}, position: 1 },
        { org_id: orgId, board_id: board.id, name: 'תאריך יעד', type: 'date', settings: {}, position: 2 },
        { org_id: orgId, board_id: board.id, name: 'נוצר בתאריך', type: 'created_at', settings: {}, position: 9999 },
      ])
      // קבוצה ראשונה
      await supabase.from('groups').insert({
        org_id: orgId,
        board_id: board.id,
        name: 'קבוצה ראשונה',
        color: '#579bfc',
        position: 0,
      })

      setModalOpen(false)
      setName('')
      refreshStructure()
      await load()
      toast('הבורד נוצר בהצלחה')
    } catch {
      setError('יצירת הבורד נכשלה.')
      toast('יצירת הבורד נכשלה', 'error')
    } finally {
      setSaving(false)
    }
  }

  // השבתה — הבורד וכל הנתונים נשמרים ב-DB וניתנים לשחזור
  async function handleArchive(board) {
    const ok = await confirm({
      title: 'השבתת בורד',
      message: `להשבית את הבורד "${board.name}"? הנתונים יישמרו וניתן לשחזר.`,
      confirmText: 'השבתה',
      danger: true,
    })
    if (!ok) return
    try {
      const { error } = await supabase.from('boards').update({ is_archived: true }).eq('id', board.id)
      if (error) throw error
      refreshStructure()
      await load()
      toast('הבורד הושבת בהצלחה')
    } catch {
      setError('השבתת הבורד נכשלה.')
      toast('השבתת הבורד נכשלה', 'error')
    }
  }

  async function handleRestore(board) {
    try {
      const { error } = await supabase.from('boards').update({ is_archived: false }).eq('id', board.id)
      if (error) throw error
      refreshStructure()
      await load()
      toast('הבורד שוחזר בהצלחה')
    } catch {
      setError('שחזור הבורד נכשל.')
      toast('שחזור הבורד נכשל', 'error')
    }
  }

  const activeBoards = boards.filter((b) => !b.is_archived)
  const archivedBoards = boards.filter((b) => b.is_archived)

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="text-sm text-text-dim">וורקספייס</div>
          <h1 className="text-2xl font-bold text-text">{workspace?.name || 'בורדים'}</h1>
        </div>
        {isAdmin && (
          <Button onClick={() => setModalOpen(true)} data-testid="board-new-btn">
            + בורד חדש
          </Button>
        )}
      </div>

      {error && <p className="mb-4 text-status-red">{error}</p>}

      {loading ? (
        <LoadingSpinner label="טוען..." />
      ) : activeBoards.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface/50 p-10 text-center">
          <p className="mb-4 text-text-muted">
            {isAdmin ? 'אין עדיין בורדים. צרו את הבורד הראשון.' : 'אין עדיין בורדים בוורקספייס זה.'}
          </p>
          {isAdmin && <Button onClick={() => setModalOpen(true)}>+ בורד חדש</Button>}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {activeBoards.map((b) => (
            <div
              key={b.id}
              className="group rounded-lg border border-border bg-surface p-5 transition-colors hover:border-accent"
              data-testid={`board-card-${b.id}`}
            >
              <Link to={`/org/${orgId}/board/${b.id}`} className="block" data-testid={`board-link-${b.id}`}>
                <h3 className="text-lg font-semibold text-text group-hover:text-accent">
                  {b.name}
                </h3>
                {b.description && (
                  <p className="mt-1 text-sm text-text-dim">{b.description}</p>
                )}
              </Link>
              {isAdmin && (
                <div className="mt-3 flex gap-2 border-t border-border pt-3">
                  <button
                    onClick={() => handleArchive(b)}
                    className="text-xs text-text-dim hover:text-status-red"
                    data-testid={`board-archive-${b.id}`}
                  >
                    השבתה
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* בורדים מושבתים — שחזור (אדמין בלבד) */}
      {isAdmin && archivedBoards.length > 0 && (
        <section className="mt-8" data-testid="boards-archived-section">
          <h2 className="mb-2 text-sm font-semibold text-text-muted">
            בורדים מושבתים ({archivedBoards.length})
          </h2>
          <div className="space-y-1">
            {archivedBoards.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between rounded-md border border-dashed border-border bg-surface/50 px-3 py-2"
              >
                <span className="text-sm text-text-dim">{b.name}</span>
                <button
                  onClick={() => handleRestore(b)}
                  className="text-sm text-accent hover:underline"
                  data-testid={`board-restore-${b.id}`}
                >
                  שחזר
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="בורד חדש">
        <form onSubmit={handleCreate} onKeyDown={handleEnterAsTab} className="space-y-4">
          <Input
            label="שם הבורד"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="לדוגמה: משימות צוות"
            required
            autoFocus
            data-testid="board-name-input"
          />
          <p className="text-xs text-text-dim">
            הבורד ייווצר עם קבוצה ראשונה ועמודות ברירת מחדל (סטטוס, אחראי, תאריך יעד).
          </p>
          <div className="flex justify-start gap-2">
            <Button type="submit" disabled={!name.trim()} loading={saving} data-testid="board-create-submit">
              צור בורד
            </Button>
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              ביטול
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
