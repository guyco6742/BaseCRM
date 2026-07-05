import { useRef, useState } from 'react'
import Avatar from '../ui/Avatar'
import Popover from './Popover'

// תצוגת קנבן לבורד — עמודה לכל תווית בעמודת הסטטוס הנבחרת.
// גרירת כרטיס בין עמודות משנה את הסטטוס של הפריט.
export default function BoardKanban({
  column,        // עמודת הסטטוס שמניעה את הקנבן
  personColumn,  // עמודת "אחראי" ראשונה (לאווטאר בכרטיס), אופציונלי
  items,
  groups,
  members,
  canEdit,
  onSetStatus,   // (item, labelId|null)
  onQuickAdd,    // (labelId, name) — הוספה מהירה לקבוצה הראשונה
  onOpenItem,    // (item) — פתיחת חלון עריכה בלחיצה על כרטיס
}) {
  const [dragOverCol, setDragOverCol] = useState(null)
  const [drafts, setDrafts] = useState({}) // טיוטות הוספה מהירה לפי עמודה
  // מבחין בין גרירה ללחיצה — כדי שסיום גרירה לא יפתח את חלון העריכה
  const draggingRef = useRef(false)

  const labels = column?.settings?.labels || []
  const noneItems = items.filter(
    (i) => !i.values?.[column.id] || !labels.some((l) => l.id === i.values[column.id])
  )
  const columns = [
    ...labels.map((l) => ({ id: l.id, label: l.label, color: l.color })),
    ...(noneItems.length > 0 ? [{ id: null, label: 'ללא סטטוס', color: '#4a4f77' }] : []),
  ]

  const groupOf = (item) => groups.find((g) => g.id === item.group_id)
  const assigneeOf = (item) => {
    if (!personColumn) return null
    return members.find((m) => m.user_id === item.values?.[personColumn.id])
  }

  function itemsOf(colId) {
    if (colId === null) return noneItems
    return items.filter((i) => i.values?.[column.id] === colId)
  }

  function handleDrop(e, colId) {
    e.preventDefault()
    setDragOverCol(null)
    const itemId = e.dataTransfer.getData('itemId')
    const item = items.find((i) => i.id === itemId)
    if (item && item.values?.[column.id] !== colId) onSetStatus(item, colId)
  }

  function submitQuickAdd(e, colId) {
    e.preventDefault()
    const name = (drafts[colId] ?? '').trim()
    if (!name) return
    onQuickAdd(colId, name)
    setDrafts((d) => ({ ...d, [colId]: '' }))
  }

  return (
    <div className="flex items-start gap-3 overflow-x-auto pb-4" data-testid="board-kanban">
      {columns.map((col) => {
        const list = itemsOf(col.id)
        return (
          <div
            key={col.id ?? 'none'}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOverCol(col.id)
            }}
            onDragLeave={() => setDragOverCol(null)}
            onDrop={(e) => handleDrop(e, col.id)}
            className={`w-64 shrink-0 rounded-lg border bg-surface/60 transition-colors ${
              dragOverCol === col.id ? 'border-accent bg-accent/10' : 'border-border'
            }`}
            data-testid={`board-kanban-col-${col.id ?? 'none'}`}
          >
            {/* כותרת עמודה */}
            <div
              className="flex items-center justify-between rounded-t-lg px-3 py-2 text-sm font-semibold text-white"
              style={{ backgroundColor: col.color }}
            >
              <span>{col.label}</span>
              <span className="rounded-full bg-black/20 px-2 text-xs">{list.length}</span>
            </div>

            {/* כרטיסי משימות */}
            <div className="min-h-[70px] space-y-2 p-2">
              {list.map((item) => {
                const grp = groupOf(item)
                const assignee = assigneeOf(item)
                const currentLabel = labels.find((l) => l.id === item.values?.[column.id])
                return (
                  <div
                    key={item.id}
                    draggable={canEdit}
                    onDragStart={(e) => {
                      draggingRef.current = true
                      e.dataTransfer.setData('itemId', item.id)
                    }}
                    onDragEnd={() => setTimeout(() => (draggingRef.current = false), 100)}
                    onClick={() => {
                      if (!draggingRef.current) onOpenItem?.(item)
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onOpenItem?.(item)
                      }
                    }}
                    className={`cursor-pointer rounded-md border border-border bg-surface p-3 hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent ${
                      canEdit ? 'active:cursor-grabbing' : ''
                    }`}
                    data-testid={`board-kanban-card-${item.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-text">{item.name || 'פריט ללא שם'}</span>
                      {assignee && (
                        <Avatar name={assignee.full_name} email={assignee.email} size={22} />
                      )}
                    </div>
                    {grp && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-text-dim">
                        <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: grp.color }} />
                        <span className="truncate">{grp.name}</span>
                      </div>
                    )}
                    {canEdit && (
                      <span onClick={(e) => e.stopPropagation()} className="mt-1.5 inline-block">
                        <Popover
                          panelWidth={160}
                          panel={(close) => (
                            <div className="space-y-1">
                              {labels.map((l) => (
                                <button
                                  key={l.id}
                                  onClick={() => {
                                    onSetStatus(item, l.id)
                                    close()
                                  }}
                                  className="block w-full rounded px-2 py-1.5 text-start text-sm font-medium text-white"
                                  style={{ backgroundColor: l.color }}
                                  data-testid={`board-kanban-status-option-${l.id}`}
                                >
                                  {l.label}
                                </button>
                              ))}
                              <button
                                onClick={() => {
                                  onSetStatus(item, null)
                                  close()
                                }}
                                className="block w-full rounded px-2 py-1.5 text-start text-sm text-text-muted hover:bg-surface-2"
                              >
                                נקה
                              </button>
                            </div>
                          )}
                        >
                          <span
                            className="inline-block rounded-full px-2 py-0.5 text-xs font-medium text-white"
                            style={{ backgroundColor: currentLabel?.color || '#4a4f77' }}
                            data-testid={`board-kanban-status-chip-${item.id}`}
                          >
                            {currentLabel ? currentLabel.label : 'ללא סטטוס'}
                          </span>
                        </Popover>
                      </span>
                    )}
                  </div>
                )
              })}

              {list.length === 0 && (
                <p className="py-3 text-center text-xs text-text-dim">גררו משימה לכאן</p>
              )}

              {/* הוספה מהירה — נכנס לקבוצה הראשונה עם הסטטוס של העמודה */}
              {canEdit && col.id !== null && groups.length > 0 && (
                <form onSubmit={(e) => submitQuickAdd(e, col.id)}>
                  <input
                    value={drafts[col.id] ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [col.id]: e.target.value }))}
                    placeholder="+ הוסף משימה"
                    className="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-text placeholder:text-text-dim outline-none focus:border-border"
                    data-testid={`board-kanban-add-${col.id}`}
                  />
                </form>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
