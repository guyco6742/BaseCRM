import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Input from '../components/ui/Input'
import GroupSection from '../components/board/GroupSection'
import BoardKanban from '../components/board/BoardKanban'
import ItemModal from '../components/board/ItemModal'
import AddColumnModal from '../components/board/AddColumnModal'
import ColumnManagerModal from '../components/board/ColumnManagerModal'
import EditColumnModal from '../components/board/EditColumnModal'
import ArchivedModal from '../components/board/ArchivedModal'
import { LABEL_COLORS } from '../lib/columnTypes'
import { handleEnterAsTab } from '../lib/formNav'

export default function BoardPage() {
  const { boardId } = useParams()
  const { orgId, isAdmin, role } = useOrg()
  const canEdit = role === 'admin' || role === 'member' || isAdmin

  const [board, setBoard] = useState(null)
  const [columns, setColumns] = useState([])
  const [groups, setGroups] = useState([])
  const [items, setItems] = useState([])
  const [members, setMembers] = useState([])
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [addColumnOpen, setAddColumnOpen] = useState(false)
  const [columnManagerOpen, setColumnManagerOpen] = useState(false)
  const [editingColumn, setEditingColumn] = useState(null)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [addGroupOpen, setAddGroupOpen] = useState(false)
  const [groupName, setGroupName] = useState('')

  // תצוגה: טבלה / קנבן — נשמרת לכל בורד בנפרד
  const [view, setView] = useState('table')
  const [kanbanColId, setKanbanColId] = useState(null)
  // משימה פתוחה לעריכה (מהקנבן) — נשמר רק ה-id, והפריט נלקח חי מה-state
  const [openItemId, setOpenItemId] = useState(null)

  useEffect(() => {
    setView(localStorage.getItem(`basecrm.boardView:${boardId}`) || 'table')
    setKanbanColId(null)
  }, [boardId])

  function switchView(v) {
    setView(v)
    localStorage.setItem(`basecrm.boardView:${boardId}`, v)
  }

  async function load() {
    setLoading(true)
    try {
      const [bRes, cRes, gRes, iRes, mRes, clRes] = await Promise.all([
        supabase.from('boards').select('*').eq('id', boardId).maybeSingle(),
        // עמודות: טוענים הכל (כולל מושבתות) לניהול; הסינון לתצוגה נעשה בצד הלקוח
        supabase.from('columns').select('*').eq('board_id', boardId).order('position'),
        supabase.from('groups').select('*').eq('board_id', boardId).eq('is_archived', false).order('position'),
        supabase.from('items').select('*').eq('board_id', boardId).eq('is_archived', false).order('position'),
        supabase.from('memberships').select('user_id, profiles(full_name, email, is_super_admin)').eq('org_id', orgId),
        // לקוחות הארגון — לעמודות מסוג "לקוח"
        supabase.from('clients').select('id, name').eq('org_id', orgId).eq('is_archived', false).order('name'),
      ])
      if (bRes.error) throw bRes.error
      setBoard(bRes.data)
      setColumns(cRes.data || [])
      setGroups(gRes.data || [])
      setItems(iRes.data || [])
      setClients(clRes.data || [])
      // סופר-אדמין שקוף לארגון — לא מופיע כבחירה בעמודות "אחראי"
      setMembers(
        (mRes.data || [])
          .filter((m) => !m.profiles?.is_super_admin)
          .map((m) => ({
            user_id: m.user_id,
            full_name: m.profiles?.full_name,
            email: m.profiles?.email,
          }))
      )
    } catch {
      setError('טעינת הבורד נכשלה.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, orgId])

  // ---- פעולות פריטים ----
  async function addItem(group, name, values = {}) {
    const groupItems = items.filter((i) => i.group_id === group.id)
    const { data, error } = await supabase
      .from('items')
      .insert({
        org_id: orgId,
        board_id: boardId,
        group_id: group.id,
        name,
        values,
        position: groupItems.length,
      })
      .select()
      .single()
    if (error) return setError('הוספת הפריט נכשלה.')
    setItems((prev) => [...prev, data])
  }

  async function updateItemName(item, name) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, name } : i)))
    const { error } = await supabase
      .from('items')
      .update({ name, updated_at: new Date().toISOString() })
      .eq('id', item.id)
    if (error) {
      // הכתיבה נכשלה — מחזירים את המצב הקודם ומודיעים
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, name: item.name } : i)))
      setError('שמירת השם נכשלה. נסו שוב.')
    }
  }

  async function updateItemValue(item, columnId, value) {
    const newValues = { ...(item.values || {}), [columnId]: value }
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, values: newValues } : i)))
    const { error } = await supabase
      .from('items')
      .update({ values: newValues, updated_at: new Date().toISOString() })
      .eq('id', item.id)
    if (error) {
      // הכתיבה נכשלה — מחזירים את הערך הקודם ומודיעים
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, values: item.values } : i)))
      setError('שמירת השינוי נכשלה. נסו שוב.')
    }
  }

  // העברת משימה לקבוצה אחרת
  async function moveItemToGroup(item, groupId) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, group_id: groupId } : i)))
    const { error } = await supabase
      .from('items')
      .update({ group_id: groupId, updated_at: new Date().toISOString() })
      .eq('id', item.id)
    if (error) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, group_id: item.group_id } : i)))
      setError('העברת הקבוצה נכשלה. נסו שוב.')
    }
  }

  // השבתת פריט — נשמר ב-DB עם is_archived, ניתן לשחזור
  async function archiveItem(item) {
    setItems((prev) => prev.filter((i) => i.id !== item.id))
    await supabase.from('items').update({ is_archived: true }).eq('id', item.id)
  }

  // ---- פעולות קבוצות ----
  async function addGroup(e) {
    e.preventDefault()
    const color = LABEL_COLORS[groups.length % LABEL_COLORS.length]
    const { data, error } = await supabase
      .from('groups')
      .insert({
        org_id: orgId,
        board_id: boardId,
        name: groupName.trim(),
        color,
        position: groups.length,
      })
      .select()
      .single()
    if (error) return setError('יצירת הקבוצה נכשלה.')
    setGroups((prev) => [...prev, data])
    setGroupName('')
    setAddGroupOpen(false)
  }

  // השבתת קבוצה — הפריטים שבתוכה נשמרים ב-DB (לא נמחקים), ניתן לשחזור
  async function archiveGroup(group) {
    if (!window.confirm(`להשבית את הקבוצה "${group.name}"? הפריטים יישמרו וניתן לשחזר בהמשך.`)) return
    setGroups((prev) => prev.filter((g) => g.id !== group.id))
    setItems((prev) => prev.filter((i) => i.group_id !== group.id))
    await supabase.from('groups').update({ is_archived: true }).eq('id', group.id)
  }

  // ---- פעולות עמודות ----
  async function addColumn({ name, type, settings }) {
    const { data, error } = await supabase
      .from('columns')
      .insert({
        org_id: orgId,
        board_id: boardId,
        name,
        type,
        settings,
        position: columns.length,
      })
      .select()
      .single()
    if (error) return setError('יצירת העמודה נכשלה.')
    setColumns((prev) => [...prev, data])
    setAddColumnOpen(false)
  }

  // השבתת עמודה — נשמרת ב-DB עם is_archived, ניתן לשחזור
  async function archiveColumn(column) {
    setColumns((prev) => prev.map((c) => (c.id === column.id ? { ...c, is_archived: true } : c)))
    await supabase.from('columns').update({ is_archived: true }).eq('id', column.id)
  }

  async function restoreColumn(column) {
    setColumns((prev) => prev.map((c) => (c.id === column.id ? { ...c, is_archived: false } : c)))
    await supabase.from('columns').update({ is_archived: false }).eq('id', column.id)
  }

  // עדכון עמודה קיימת (שם + הגדרות: תוויות/צבעים/אפשרויות/יחידה)
  async function updateColumn(column, { name, settings }) {
    // שומרים על מפתח ה-hidden אם קיים
    const merged = { ...settings, hidden: column.settings?.hidden }
    setColumns((prev) => prev.map((c) => (c.id === column.id ? { ...c, name, settings: merged } : c)))
    await supabase.from('columns').update({ name, settings: merged }).eq('id', column.id)
  }

  // הזזת עמודה שמאלה/ימינה — החלפת מיקום עם השכן הפעיל ושמירה
  async function moveColumn(column, dir) {
    const ordered = columns.filter((c) => !c.is_archived).sort((a, b) => a.position - b.position)
    const idx = ordered.findIndex((c) => c.id === column.id)
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= ordered.length) return
    const a = ordered[idx]
    const b = ordered[swapIdx]
    // החלפת ערכי position
    setColumns((prev) =>
      prev.map((c) =>
        c.id === a.id ? { ...c, position: b.position } : c.id === b.id ? { ...c, position: a.position } : c
      )
    )
    await Promise.all([
      supabase.from('columns').update({ position: b.position }).eq('id', a.id),
      supabase.from('columns').update({ position: a.position }).eq('id', b.id),
    ])
  }

  // הצגה/הסתרה של עמודה (נשמר ב-settings.hidden)
  async function toggleColumnHidden(column) {
    const newSettings = { ...(column.settings || {}), hidden: !column.settings?.hidden }
    setColumns((prev) => prev.map((c) => (c.id === column.id ? { ...c, settings: newSettings } : c)))
    await supabase.from('columns').update({ settings: newSettings }).eq('id', column.id)
  }

  if (loading) return <LoadingSpinner label="טוען בורד..." />

  // עמודות פעילות (לא מושבתות) לפי סדר; מתוכן — המוצגות (לא מוסתרות)
  const orderedColumns = columns.filter((c) => !c.is_archived).sort((a, b) => a.position - b.position)
  const archivedColumns = columns.filter((c) => c.is_archived)
  const visibleColumns = orderedColumns.filter((c) => !c.settings?.hidden)
  const minTableWidth = 220 + visibleColumns.length * 160 + 40

  // קנבן: עמודות סטטוס זמינות + העמודה הפעילה (ברירת מחדל: הראשונה)
  const statusColumns = orderedColumns.filter((c) => c.type === 'status')
  const kanbanColumn = statusColumns.find((c) => c.id === kanbanColId) || statusColumns[0]
  const personColumn = orderedColumns.find((c) => c.type === 'person')

  return (
    <div className="p-6" data-testid="board-page">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-text" data-testid="board-title">{board?.name}</h1>

          {/* טוגל טבלה / קנבן */}
          <div className="flex overflow-hidden rounded-md border border-border" data-testid="board-view-toggle">
            <button
              onClick={() => switchView('table')}
              className={`px-3 py-1 text-sm ${view === 'table' ? 'bg-accent text-white' : 'bg-surface text-text-muted hover:bg-surface-2'}`}
              data-testid="board-view-table"
            >
              ☰ טבלה
            </button>
            <button
              onClick={() => switchView('kanban')}
              className={`px-3 py-1 text-sm ${view === 'kanban' ? 'bg-accent text-white' : 'bg-surface text-text-muted hover:bg-surface-2'}`}
              data-testid="board-view-kanban"
            >
              ▦ קנבן
            </button>
          </div>

          {/* בורר עמודת סטטוס — רק בקנבן וכשיש יותר מאחת */}
          {view === 'kanban' && statusColumns.length > 1 && (
            <select
              value={kanbanColumn?.id ?? ''}
              onChange={(e) => setKanbanColId(e.target.value)}
              className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text outline-none focus:border-accent"
              data-testid="board-kanban-col-select"
            >
              {statusColumns.map((c) => (
                <option key={c.id} value={c.id}>
                  לפי: {c.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setArchivedOpen(true)} data-testid="board-archived-btn">
              🗄 מושבתים
            </Button>
            <Button variant="ghost" onClick={() => setColumnManagerOpen(true)} data-testid="board-columns-btn">
              ⚙ עמודות
            </Button>
            <Button variant="secondary" onClick={() => setAddColumnOpen(true)} data-testid="board-add-column-btn">
              + עמודה
            </Button>
            <Button onClick={() => setAddGroupOpen(true)} data-testid="board-add-group-btn">
              + קבוצה
            </Button>
          </div>
        )}
      </div>

      {error && <p className="mb-4 text-status-red">{error}</p>}

      {groups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface/50 p-10 text-center text-text-muted">
          {isAdmin ? 'אין עדיין קבוצות. הוסיפו קבוצה כדי להתחיל.' : 'הבורד ריק.'}
        </div>
      ) : view === 'kanban' ? (
        !kanbanColumn ? (
          <div className="rounded-lg border border-dashed border-border bg-surface/50 p-10 text-center text-text-muted">
            תצוגת קנבן דורשת עמודת סטטוס.{' '}
            {isAdmin ? 'הוסיפו עמודה מסוג "סטטוס" לבורד.' : 'בקשו מהמנהל להוסיף עמודת סטטוס.'}
          </div>
        ) : (
          <BoardKanban
            column={kanbanColumn}
            personColumn={personColumn}
            items={items}
            groups={groups}
            members={members}
            canEdit={canEdit}
            onSetStatus={(item, labelId) => updateItemValue(item, kanbanColumn.id, labelId)}
            onQuickAdd={(labelId, name) => addItem(groups[0], name, { [kanbanColumn.id]: labelId })}
            onOpenItem={(item) => setOpenItemId(item.id)}
          />
        )
      ) : (
        <div className="overflow-x-auto pb-2">
          <div style={{ minWidth: minTableWidth }}>
            {groups.map((group) => (
              <GroupSection
                key={group.id}
                group={group}
                columns={visibleColumns}
                items={items.filter((i) => i.group_id === group.id)}
                members={members}
                clients={clients}
                orgId={orgId}
                canEdit={canEdit}
                isAdmin={isAdmin}
                onAddItem={addItem}
                onArchiveGroup={archiveGroup}
                onItemName={updateItemName}
                onItemValue={updateItemValue}
                onArchiveItem={archiveItem}
                onArchiveColumn={archiveColumn}
              />
            ))}
          </div>
        </div>
      )}

      {/* עריכת משימה — נפתח בלחיצה על כרטיס בקנבן; הפריט נלקח חי מה-state */}
      <ItemModal
        open={Boolean(openItemId)}
        item={items.find((i) => i.id === openItemId) ?? null}
        columns={visibleColumns}
        groups={groups}
        members={members}
        clients={clients}
        orgId={orgId}
        canEdit={canEdit}
        onClose={() => setOpenItemId(null)}
        onName={updateItemName}
        onValue={updateItemValue}
        onMoveGroup={moveItemToGroup}
        onArchive={archiveItem}
      />

      <AddColumnModal
        open={addColumnOpen}
        onClose={() => setAddColumnOpen(false)}
        onCreate={addColumn}
      />

      <ColumnManagerModal
        open={columnManagerOpen}
        onClose={() => setColumnManagerOpen(false)}
        columns={orderedColumns}
        archivedColumns={archivedColumns}
        onMove={moveColumn}
        onEdit={(col) => setEditingColumn(col)}
        onToggleHidden={toggleColumnHidden}
        onArchive={archiveColumn}
        onRestore={restoreColumn}
      />

      <EditColumnModal
        open={Boolean(editingColumn)}
        column={editingColumn}
        onClose={() => setEditingColumn(null)}
        onSave={updateColumn}
      />

      <ArchivedModal
        open={archivedOpen}
        onClose={() => setArchivedOpen(false)}
        boardId={boardId}
        onRestored={load}
      />

      <Modal open={addGroupOpen} onClose={() => setAddGroupOpen(false)} title="קבוצה חדשה">
        <form onSubmit={addGroup} onKeyDown={handleEnterAsTab} className="space-y-4">
          <Input
            label="שם הקבוצה"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="לדוגמה: השבוע"
            required
            autoFocus
            data-testid="group-name-input"
          />
          <div className="flex justify-start gap-2">
            <Button type="submit" disabled={!groupName.trim()} data-testid="group-create-submit">
              צור קבוצה
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAddGroupOpen(false)}>
              ביטול
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
