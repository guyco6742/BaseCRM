import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useOrg } from '../context/OrgContext'
import { useConfirm } from '../context/ConfirmContext'
import { useToast } from '../context/ToastContext'
import { useTitle } from '../lib/useTitle'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Input from '../components/ui/Input'
import GroupSection, { GroupSectionSkeleton } from '../components/board/GroupSection'
import BoardKanban from '../components/board/BoardKanban'
import ItemModal from '../components/board/ItemModal'
import AddColumnModal from '../components/board/AddColumnModal'
import ColumnManagerModal from '../components/board/ColumnManagerModal'
import EditColumnModal from '../components/board/EditColumnModal'
import ArchivedModal from '../components/board/ArchivedModal'
import { LABEL_COLORS, formatColumnValue } from '../lib/columnTypes'
import { handleEnterAsTab } from '../lib/formNav'
import { exportRowsToCSV, downloadCSV } from '../lib/csv'
import FavoriteStarButton from '../components/FavoriteStarButton'

// גודל חלון-הטעינה הראשוני לכל קבוצה, ואורך כל "טען עוד" נוסף (Item 7 — F8).
// הבורד לא מעומד כרשימה שטוחה: כל קבוצה טוענת עד 100 פריטים ראשונים, וקבוצה
// עם יותר מ-100 מציגה כפתור "טען עוד" שמוסיף עוד 100 (ר' §7 Item 7 בספק).
const ITEMS_PAGE_SIZE = 100

export default function BoardPage() {
  const { boardId } = useParams()
  const { orgId, isAdmin, role, members: orgMembers } = useOrg()
  const canEdit = role === 'admin' || role === 'member' || isAdmin
  const confirm = useConfirm()
  const { toast } = useToast()

  const [board, setBoard] = useState(null)
  const [columns, setColumns] = useState([])
  const [groups, setGroups] = useState([])
  // items מכיל רק את החלונות הטעונים (עד 100 לקבוצה, יותר אחרי "טען עוד") —
  // לא את כל פריטי הבורד. groupMeta עוקב אחרי loaded/total פר-קבוצה כדי לדעת
  // מתי להציג "טען עוד" וכמה פריטים נותרו.
  const [items, setItems] = useState([])
  const [groupMeta, setGroupMeta] = useState({}) // { [groupId]: { loaded, total } }
  const [loadingMoreGroupId, setLoadingMoreGroupId] = useState(null)
  const [clients, setClients] = useState([])
  const [metaLoading, setMetaLoading] = useState(true) // board/columns/groups/clients
  const [itemsLoading, setItemsLoading] = useState(true) // חלונות הפריטים הראשוניים
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')

  const [addColumnOpen, setAddColumnOpen] = useState(false)
  const [columnManagerOpen, setColumnManagerOpen] = useState(false)
  const [editingColumn, setEditingColumn] = useState(null)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [addGroupOpen, setAddGroupOpen] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [savingGroup, setSavingGroup] = useState(false)

  // תצוגה: טבלה / קנבן — נשמרת לכל בורד בנפרד
  const [view, setView] = useState('table')
  const [kanbanColId, setKanbanColId] = useState(null)
  // משימה פתוחה לעריכה (מהקנבן) — נשמר רק ה-id, והפריט נלקח חי מה-state
  const [openItemId, setOpenItemId] = useState(null)

  useEffect(() => {
    setView(localStorage.getItem(`basecrm.boardView:${boardId}`) || 'table')
    setKanbanColId(null)
  }, [boardId])

  useTitle(board?.name)

  function switchView(v) {
    setView(v)
    localStorage.setItem(`basecrm.boardView:${boardId}`, v)
  }

  // מטא-דאטה של הבורד: בורד/עמודות/קבוצות/לקוחות — קלים, לא מעומדים.
  // מוחזר groupList כדי ש-loadItemWindows יוכל לרוץ מיד אחרי, בלי לחכות
  // לרינדור נוסף שיקרא את groups מה-state (שעדיין לא התעדכן באותו tick).
  async function loadMeta() {
    setMetaLoading(true)
    try {
      const [bRes, cRes, gRes, clRes] = await Promise.all([
        supabase.from('boards').select('*').eq('id', boardId).maybeSingle(),
        // עמודות: טוענים הכל (כולל מושבתות) לניהול; הסינון לתצוגה נעשה בצד הלקוח
        supabase.from('columns').select('*').eq('board_id', boardId).order('position'),
        supabase.from('groups').select('*').eq('board_id', boardId).eq('is_archived', false).order('position'),
        // לקוחות הארגון — לעמודות מסוג "לקוח"
        supabase.from('clients').select('id, name').eq('org_id', orgId).eq('is_archived', false).order('name'),
      ])
      if (bRes.error) throw bRes.error
      setBoard(bRes.data)
      setColumns(cRes.data || [])
      const groupList = gRes.data || []
      setGroups(groupList)
      setClients(clRes.data || [])
      return groupList
    } catch {
      setError('טעינת הבורד נכשלה.')
      return []
    } finally {
      setMetaLoading(false)
    }
  }

  // חלון הפריטים הראשוני (עד 100) לכל קבוצה — שאילתה אחת פר-קבוצה (Promise.all),
  // כל אחת מחזירה גם count:'exact' כדי לדעת אם יש עוד להציג "טען עוד" (Item 7).
  // מספר הקבוצות בפועל נמוך (~10 בדרך כלל) — N מקביל מקובל, עדיף על שאילתה
  // שטוחה אחת ל-.range(0,500) שהייתה מפרה את החלוקה הבטוחה-פר-קבוצה מהספק.
  async function loadItemWindows(groupList) {
    if (groupList.length === 0) {
      setItems([])
      setGroupMeta({})
      setItemsLoading(false)
      return
    }
    setItemsLoading(true)
    try {
      const results = await Promise.all(
        groupList.map((g) =>
          supabase
            .from('items')
            .select('*', { count: 'exact' })
            .eq('group_id', g.id)
            .eq('is_archived', false)
            .order('position')
            .range(0, ITEMS_PAGE_SIZE - 1)
        )
      )
      const nextItems = []
      const nextMeta = {}
      results.forEach((res, idx) => {
        const g = groupList[idx]
        const rows = res.data || []
        nextItems.push(...rows)
        nextMeta[g.id] = { loaded: rows.length, total: res.count ?? rows.length }
      })
      setItems(nextItems)
      setGroupMeta(nextMeta)
    } catch {
      setError('טעינת הפריטים נכשלה.')
    } finally {
      setItemsLoading(false)
    }
  }

  async function load() {
    const groupList = await loadMeta()
    await loadItemWindows(groupList)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, orgId])

  // "טען עוד" לקבוצה בודדת — מוסיף 100 פריטים נוספים לחלון הטעון שלה.
  async function loadMoreForGroup(group) {
    const meta = groupMeta[group.id] || { loaded: 0, total: 0 }
    setLoadingMoreGroupId(group.id)
    try {
      const from = meta.loaded
      const to = from + ITEMS_PAGE_SIZE - 1
      const { data, error: qError, count } = await supabase
        .from('items')
        .select('*', { count: 'exact' })
        .eq('group_id', group.id)
        .eq('is_archived', false)
        .order('position')
        .range(from, to)
      if (qError) throw qError
      const rows = data || []
      setItems((prev) => [...prev, ...rows])
      setGroupMeta((prev) => ({
        ...prev,
        [group.id]: { loaded: from + rows.length, total: count ?? prev[group.id]?.total ?? 0 },
      }))
    } catch {
      toast('טעינת פריטים נוספים נכשלה', 'error')
    } finally {
      setLoadingMoreGroupId(null)
    }
  }

  // סופר-אדמין שקוף לארגון — לא מופיע כבחירה בעמודות "אחראי"
  const members = useMemo(
    () =>
      orgMembers
        .filter((m) => !m.profiles?.is_super_admin)
        .map((m) => ({
          user_id: m.user_id,
          full_name: m.profiles?.full_name,
          email: m.profiles?.email,
        })),
    [orgMembers]
  )

  // עמודות פעילות (לא מושבתות) לפי סדר; מתוכן — המוצגות (לא מוסתרות)
  // מיוצב עם useMemo כדי לשמור על זהות מערך יציבה בין רינדורים (חיוני ל-React.memo בשורות הבורד)
  const orderedColumns = useMemo(
    () => columns.filter((c) => !c.is_archived).sort((a, b) => a.position - b.position),
    [columns]
  )
  const archivedColumns = useMemo(() => columns.filter((c) => c.is_archived), [columns])
  const visibleColumns = useMemo(
    () => orderedColumns.filter((c) => !c.settings?.hidden),
    [orderedColumns]
  )

  // ---- פעולות פריטים ----
  // מיקום פריט חדש: שולפים את ה-position המקסימלי בפועל מה-DB (לא את אורך
  // החלון הטעון) — כדי לא להתנגש עם פריטים לא-טעונים כשבקבוצה יש יותר מ-100
  // פריטים ורק החלון הראשון נטען (Item 7 — "טען עוד" פר-קבוצה).
  const addItem = useCallback(
    async (group, name, values = {}) => {
      const { data: maxRow } = await supabase
        .from('items')
        .select('position')
        .eq('group_id', group.id)
        .eq('is_archived', false)
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle()
      const position = (maxRow?.position ?? -1) + 1
      const { data, error } = await supabase
        .from('items')
        .insert({
          org_id: orgId,
          board_id: boardId,
          group_id: group.id,
          name,
          values,
          position,
        })
        .select()
        .single()
      if (error) {
        toast('הוספת הפריט נכשלה', 'error')
        return setError('הוספת הפריט נכשלה.')
      }
      setItems((prev) => [...prev, data])
      setGroupMeta((prev) => ({
        ...prev,
        [group.id]: {
          loaded: (prev[group.id]?.loaded ?? 0) + 1,
          total: (prev[group.id]?.total ?? 0) + 1,
        },
      }))
    },
    [orgId, boardId, toast]
  )

  const updateItemName = useCallback(
    async (item, name) => {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, name } : i)))
      const { error } = await supabase
        .from('items')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', item.id)
      if (error) {
        // הכתיבה נכשלה — מחזירים את המצב הקודם ומודיעים
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, name: item.name } : i)))
        setError('שמירת השם נכשלה. נסו שוב.')
        toast('שמירת השם נכשלה', 'error')
      }
    },
    [toast]
  )

  const updateItemValue = useCallback(
    async (item, columnId, value) => {
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
        toast('שמירת השינוי נכשלה', 'error')
      }
    },
    [toast]
  )

  // העברת משימה לקבוצה אחרת — בין שני "חלונות" טעונים; מעדכן גם את
  // ה-loaded/total האופטימיים של שתי הקבוצות (מקור/יעד) בהתאם.
  async function moveItemToGroup(item, groupId) {
    const prevGroupId = item.group_id
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, group_id: groupId } : i)))
    setGroupMeta((prev) => ({
      ...prev,
      [prevGroupId]: {
        loaded: Math.max(0, (prev[prevGroupId]?.loaded ?? 1) - 1),
        total: Math.max(0, (prev[prevGroupId]?.total ?? 1) - 1),
      },
      [groupId]: {
        loaded: (prev[groupId]?.loaded ?? 0) + 1,
        total: (prev[groupId]?.total ?? 0) + 1,
      },
    }))
    const { error } = await supabase
      .from('items')
      .update({ group_id: groupId, updated_at: new Date().toISOString() })
      .eq('id', item.id)
    if (error) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, group_id: prevGroupId } : i)))
      setGroupMeta((prev) => ({
        ...prev,
        [prevGroupId]: {
          loaded: (prev[prevGroupId]?.loaded ?? 0) + 1,
          total: (prev[prevGroupId]?.total ?? 0) + 1,
        },
        [groupId]: {
          loaded: Math.max(0, (prev[groupId]?.loaded ?? 1) - 1),
          total: Math.max(0, (prev[groupId]?.total ?? 1) - 1),
        },
      }))
      setError('העברת הקבוצה נכשלה. נסו שוב.')
      toast('העברת הקבוצה נכשלה', 'error')
    }
  }

  // השבתת פריט — נשמר ב-DB עם is_archived, ניתן לשחזור
  const archiveItem = useCallback(
    async (item) => {
      setItems((prev) => prev.filter((i) => i.id !== item.id))
      setGroupMeta((prev) => ({
        ...prev,
        [item.group_id]: {
          loaded: Math.max(0, (prev[item.group_id]?.loaded ?? 1) - 1),
          total: Math.max(0, (prev[item.group_id]?.total ?? 1) - 1),
        },
      }))
      const { error } = await supabase.from('items').update({ is_archived: true }).eq('id', item.id)
      if (error) {
        toast('השבתת הפריט נכשלה', 'error')
      } else {
        toast('הפריט הושבת בהצלחה')
      }
    },
    [toast]
  )

  // ---- פעולות קבוצות ----
  async function addGroup(e) {
    e.preventDefault()
    setSavingGroup(true)
    try {
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
      if (error) {
        toast('יצירת הקבוצה נכשלה', 'error')
        return setError('יצירת הקבוצה נכשלה.')
      }
      setGroups((prev) => [...prev, data])
      setGroupMeta((prev) => ({ ...prev, [data.id]: { loaded: 0, total: 0 } }))
      setGroupName('')
      setAddGroupOpen(false)
      toast('הקבוצה נוצרה בהצלחה')
    } finally {
      setSavingGroup(false)
    }
  }

  // השבתת קבוצה — הפריטים שבתוכה נשמרים ב-DB (לא נמחקים), ניתן לשחזור
  const archiveGroup = useCallback(
    async (group) => {
      const ok = await confirm({
        title: 'השבתת קבוצה',
        message: `להשבית את הקבוצה "${group.name}"? הפריטים יישמרו וניתן לשחזר בהמשך.`,
        confirmText: 'השבתה',
        danger: true,
      })
      if (!ok) return
      setGroups((prev) => prev.filter((g) => g.id !== group.id))
      setItems((prev) => prev.filter((i) => i.group_id !== group.id))
      setGroupMeta((prev) => {
        const next = { ...prev }
        delete next[group.id]
        return next
      })
      const { error } = await supabase.from('groups').update({ is_archived: true }).eq('id', group.id)
      if (error) {
        toast('השבתת הקבוצה נכשלה', 'error')
      } else {
        toast('הקבוצה הושבתה בהצלחה')
      }
    },
    [confirm, toast]
  )

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
    if (error) {
      toast('יצירת העמודה נכשלה', 'error')
      return setError('יצירת העמודה נכשלה.')
    }
    setColumns((prev) => [...prev, data])
    setAddColumnOpen(false)
    toast('העמודה נוצרה בהצלחה')
  }

  // השבתת עמודה — נשמרת ב-DB עם is_archived, ניתן לשחזור
  const archiveColumn = useCallback(async (column) => {
    setColumns((prev) => prev.map((c) => (c.id === column.id ? { ...c, is_archived: true } : c)))
    const { error } = await supabase.from('columns').update({ is_archived: true }).eq('id', column.id)
    if (error) {
      toast('השבתת העמודה נכשלה', 'error')
    } else {
      toast('העמודה הושבתה בהצלחה')
    }
  }, [toast])

  async function restoreColumn(column) {
    setColumns((prev) => prev.map((c) => (c.id === column.id ? { ...c, is_archived: false } : c)))
    const { error } = await supabase.from('columns').update({ is_archived: false }).eq('id', column.id)
    if (error) {
      toast('שחזור העמודה נכשל', 'error')
    } else {
      toast('העמודה שוחזרה בהצלחה')
    }
  }

  // עדכון עמודה קיימת (שם + הגדרות: תוויות/צבעים/אפשרויות/יחידה)
  async function updateColumn(column, { name, settings }) {
    // שומרים על מפתח ה-hidden אם קיים
    const merged = { ...settings, hidden: column.settings?.hidden }
    setColumns((prev) => prev.map((c) => (c.id === column.id ? { ...c, name, settings: merged } : c)))
    const { error } = await supabase.from('columns').update({ name, settings: merged }).eq('id', column.id)
    if (error) {
      toast('שמירת העמודה נכשלה', 'error')
    } else {
      toast('העמודה נשמרה בהצלחה')
    }
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
    const results = await Promise.all([
      supabase.from('columns').update({ position: b.position }).eq('id', a.id),
      supabase.from('columns').update({ position: a.position }).eq('id', b.id),
    ])
    if (results.some((r) => r.error)) {
      toast('שינוי סדר העמודות נכשל', 'error')
    }
  }

  // הצגה/הסתרה של עמודה (נשמר ב-settings.hidden)
  async function toggleColumnHidden(column) {
    const newSettings = { ...(column.settings || {}), hidden: !column.settings?.hidden }
    setColumns((prev) => prev.map((c) => (c.id === column.id ? { ...c, settings: newSettings } : c)))
    const { error } = await supabase.from('columns').update({ settings: newSettings }).eq('id', column.id)
    if (error) {
      toast('עדכון תצוגת העמודה נכשל', 'error')
    }
  }

  if (metaLoading) return <LoadingSpinner label="טוען בורד..." />

  const minTableWidth = 220 + visibleColumns.length * 160 + 40

  // קנבן: עמודות סטטוס זמינות + העמודה הפעילה (ברירת מחדל: הראשונה)
  const statusColumns = orderedColumns.filter((c) => c.type === 'status')
  const kanbanColumn = statusColumns.find((c) => c.id === kanbanColId) || statusColumns[0]
  const personColumn = orderedColumns.find((c) => c.type === 'person')

  // ייצוא הבורד ל-CSV — חייב לכלול *את כל* פריטי הבורד (לא רק החלונות
  // הטעונים על המסך), אז שולף בלולאה עמודי-1000 ישירות מה-DB (כמו
  // ClientsPage.exportCSV), ולא מ-items שב-state.
  async function exportCSV() {
    setExporting(true)
    try {
      const allItems = []
      const EXPORT_PAGE = 1000
      let from = 0
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const to = from + EXPORT_PAGE - 1
        const { data, error: qError, count } = await supabase
          .from('items')
          .select('*', { count: 'exact' })
          .eq('board_id', boardId)
          .eq('is_archived', false)
          .order('position')
          .range(from, to)
        if (qError) throw qError
        allItems.push(...(data || []))
        if (!data || data.length < EXPORT_PAGE) break
        from += EXPORT_PAGE
        if (typeof count === 'number' && from >= count) break
      }
      const headers = ['קבוצה', 'שם', ...visibleColumns.map((c) => c.name)]
      const ctx = { members, clients }
      const rows = groups.flatMap((group) =>
        allItems
          .filter((i) => i.group_id === group.id)
          .map((item) => [
            group.name,
            item.name,
            ...visibleColumns.map((col) => formatColumnValue(col, item.values?.[col.id], ctx)),
          ])
      )
      const csv = exportRowsToCSV(headers, rows)
      downloadCSV(`${board?.name || 'בורד'}-${new Date().toISOString().slice(0, 10)}.csv`, csv)
    } catch {
      toast('ייצוא ה-CSV נכשל.', 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="p-6" data-testid="board-page">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-text" data-testid="board-title">{board?.name}</h1>
          <FavoriteStarButton type="board" boardId={boardId} />

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
        <div className="flex gap-2">
          <Button variant="secondary" onClick={exportCSV} loading={exporting} data-testid="board-export-btn">
            ⬇ ייצוא CSV
          </Button>
          {isAdmin && (
            <>
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
            </>
          )}
        </div>
      </div>

      {error && <p className="mb-4 text-status-red">{error}</p>}

      {groups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface/50 p-10 text-center">
          <p className="mb-4 text-text-muted">
            {isAdmin ? 'אין עדיין קבוצות. הוסיפו קבוצה כדי להתחיל.' : 'הבורד ריק.'}
          </p>
          {isAdmin && <Button onClick={() => setAddGroupOpen(true)}>+ קבוצה חדשה</Button>}
        </div>
      ) : view === 'kanban' ? (
        !kanbanColumn ? (
          <div className="rounded-lg border border-dashed border-border bg-surface/50 p-10 text-center text-text-muted">
            תצוגת קנבן דורשת עמודת סטטוס.{' '}
            {isAdmin ? 'הוסיפו עמודה מסוג "סטטוס" לבורד.' : 'בקשו מהמנהל להוסיף עמודת סטטוס.'}
          </div>
        ) : itemsLoading ? (
          <LoadingSpinner label="טוען פריטים..." />
        ) : (
          // הערה (Item 7 v1): הקנבן מקבל רק את החלונות הטעונים (עד 100 פריטים
          // לקבוצה) — קבוצה שחורגת מזה לא תציג את כל הכרטיסים שלה בקנבן עד
          // שנטען "טען עוד" בתצוגת הטבלה. מתועד כמגבלת v1, לא נדרש טיפול UI.
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
            {itemsLoading
              ? groups.map((group) => (
                  <GroupSectionSkeleton key={group.id} group={group} columns={visibleColumns} />
                ))
              : groups.map((group) => (
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
                    total={groupMeta[group.id]?.total}
                    loadingMore={loadingMoreGroupId === group.id}
                    onAddItem={addItem}
                    onArchiveGroup={archiveGroup}
                    onItemName={updateItemName}
                    onItemValue={updateItemValue}
                    onArchiveItem={archiveItem}
                    onArchiveColumn={archiveColumn}
                    onLoadMore={loadMoreForGroup}
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
            <Button type="submit" disabled={!groupName.trim()} loading={savingGroup} data-testid="group-create-submit">
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
