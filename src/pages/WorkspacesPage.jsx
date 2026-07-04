import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Input from '../components/ui/Input'
import { LABEL_COLORS } from '../lib/columnTypes'
import { handleEnterAsTab } from '../lib/formNav'

export default function WorkspacesPage() {
  const { orgId, isAdmin, structureVersion, refreshStructure } = useOrg()
  const [workspaces, setWorkspaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState(LABEL_COLORS[3])
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('workspaces')
        .select('*, boards(count)')
        .eq('org_id', orgId)
        .eq('boards.is_archived', false) // הספירה כוללת רק בורדים פעילים
        .order('position')
      if (error) throw error
      setWorkspaces(data || [])
    } catch {
      setError('טעינת הוורקספייסים נכשלה.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, structureVersion])

  function openCreate() {
    setEditing(null)
    setName('')
    setColor(LABEL_COLORS[3])
    setModalOpen(true)
  }

  function openEdit(ws) {
    setEditing(ws)
    setName(ws.name)
    setColor(ws.color || LABEL_COLORS[3])
    setModalOpen(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      if (editing) {
        const { error } = await supabase
          .from('workspaces')
          .update({ name: name.trim(), color })
          .eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('workspaces').insert({
          org_id: orgId,
          name: name.trim(),
          color,
          position: workspaces.length,
        })
        if (error) throw error
      }
      setModalOpen(false)
      refreshStructure()
      await load()
    } catch {
      setError('שמירת הוורקספייס נכשלה.')
    } finally {
      setSaving(false)
    }
  }

  // השבתה — הוורקספייס וכל תוכנו נשמרים ב-DB וניתנים לשחזור
  async function handleArchive(ws) {
    if (!window.confirm(`להשבית את הוורקספייס "${ws.name}"? הבורדים והנתונים יישמרו וניתן לשחזר.`)) return
    try {
      const { error } = await supabase.from('workspaces').update({ is_archived: true }).eq('id', ws.id)
      if (error) throw error
      refreshStructure()
      await load()
    } catch {
      setError('השבתת הוורקספייס נכשלה.')
    }
  }

  async function handleRestore(ws) {
    try {
      const { error } = await supabase.from('workspaces').update({ is_archived: false }).eq('id', ws.id)
      if (error) throw error
      refreshStructure()
      await load()
    } catch {
      setError('שחזור הוורקספייס נכשל.')
    }
  }

  const activeWorkspaces = workspaces.filter((w) => !w.is_archived)
  const archivedWorkspaces = workspaces.filter((w) => w.is_archived)

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text">וורקספייסים</h1>
        {isAdmin && (
          <Button onClick={openCreate} data-testid="workspace-new-btn">
            + וורקספייס חדש
          </Button>
        )}
      </div>

      {error && <p className="mb-4 text-status-red">{error}</p>}

      {loading ? (
        <LoadingSpinner label="טוען..." />
      ) : activeWorkspaces.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface/50 p-10 text-center text-text-muted">
          {isAdmin
            ? 'אין עדיין וורקספייסים. צרו את הראשון — למשל "מכירות" או "פיתוח".'
            : 'אין עדיין וורקספייסים בארגון זה.'}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {activeWorkspaces.map((ws) => (
            <div
              key={ws.id}
              className="group rounded-lg border border-border bg-surface p-5 transition-colors hover:border-accent"
              data-testid={`workspace-card-${ws.id}`}
            >
              <Link
                to={`/org/${orgId}/workspace/${ws.id}`}
                className="block"
                data-testid={`workspace-link-${ws.id}`}
              >
                <div
                  className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg font-bold text-white"
                  style={{ backgroundColor: ws.color || '#0073ea' }}
                >
                  {ws.name?.[0]?.toUpperCase()}
                </div>
                <h3 className="text-lg font-semibold text-text group-hover:text-accent">
                  {ws.name}
                </h3>
                <span className="text-sm text-text-dim">
                  {ws.boards?.[0]?.count ?? 0} בורדים
                </span>
              </Link>
              {isAdmin && (
                <div className="mt-3 flex gap-2 border-t border-border pt-3">
                  <button
                    onClick={() => openEdit(ws)}
                    className="text-xs text-text-dim hover:text-text"
                    data-testid={`workspace-edit-${ws.id}`}
                  >
                    עריכה
                  </button>
                  <button
                    onClick={() => handleArchive(ws)}
                    className="text-xs text-text-dim hover:text-status-red"
                    data-testid={`workspace-archive-${ws.id}`}
                  >
                    השבתה
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* וורקספייסים מושבתים — שחזור (אדמין בלבד) */}
      {isAdmin && archivedWorkspaces.length > 0 && (
        <section className="mt-8" data-testid="workspaces-archived-section">
          <h2 className="mb-2 text-sm font-semibold text-text-muted">
            וורקספייסים מושבתים ({archivedWorkspaces.length})
          </h2>
          <div className="space-y-1">
            {archivedWorkspaces.map((ws) => (
              <div
                key={ws.id}
                className="flex items-center justify-between rounded-md border border-dashed border-border bg-surface/50 px-3 py-2"
              >
                <span className="flex items-center gap-2 text-sm text-text-dim">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: ws.color }} />
                  {ws.name}
                </span>
                <button
                  onClick={() => handleRestore(ws)}
                  className="text-sm text-accent hover:underline"
                  data-testid={`workspace-restore-${ws.id}`}
                >
                  שחזר
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'עריכת וורקספייס' : 'וורקספייס חדש'}
      >
        <form onSubmit={handleSave} onKeyDown={handleEnterAsTab} className="space-y-4">
          <Input
            label="שם"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="לדוגמה: מכירות"
            required
            autoFocus
            data-testid="workspace-name-input"
          />
          <div>
            <span className="mb-1 block text-sm text-text-muted">צבע</span>
            <div className="flex flex-wrap gap-2">
              {LABEL_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full ${color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-surface' : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-start gap-2">
            <Button type="submit" disabled={saving || !name.trim()} data-testid="workspace-save-btn">
              {saving ? 'שומר...' : editing ? 'שמירה' : 'יצירה'}
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
