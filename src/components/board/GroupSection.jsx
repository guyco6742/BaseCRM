import { useEffect, useState } from 'react'
import BoardCell from './BoardCell'

// שם פריט עם טיוטה מקומית — נשמר ל-DB רק בסיום עריכה (blur/Enter),
// לא בכל הקשה, כדי לא להציף את השרת בעדכונים.
function ItemNameInput({ item, canEdit, onName }) {
  const [draft, setDraft] = useState(item.name)

  useEffect(() => {
    setDraft(item.name)
  }, [item.name])

  function commit() {
    const trimmed = draft.trim()
    if (trimmed !== item.name) onName(item, trimmed)
  }

  return (
    <input
      value={draft}
      disabled={!canEdit}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(item.name)
      }}
      placeholder="פריט ללא שם"
      className="w-full bg-transparent text-sm text-text outline-none placeholder:text-text-dim"
      data-testid={`item-name-${item.id}`}
    />
  )
}

// שורת פריט בודדת
function ItemRow({ item, columns, members, clients, orgId, gridTemplate, canEdit, onName, onValue, onArchive }) {
  return (
    <div
      className="grid items-stretch border-b border-border bg-surface hover:bg-surface-2"
      style={{ gridTemplateColumns: gridTemplate }}
      data-testid={`item-row-${item.id}`}
    >
      {/* שם הפריט */}
      <div className="flex items-center border-e border-border px-3 py-1.5">
        <ItemNameInput item={item} canEdit={canEdit} onName={onName} />
      </div>

      {/* תאי העמודות */}
      {columns.map((col) => (
        <div
          key={col.id}
          className="border-e border-border"
          data-testid={`cell-${col.type}-${item.id}-${col.id}`}
        >
          <BoardCell
            column={col}
            item={item}
            orgId={orgId}
            value={item.values?.[col.id]}
            members={members}
            clients={clients}
            canEdit={canEdit}
            onChange={(v) => onValue(item, col.id, v)}
          />
        </div>
      ))}

      {/* פעולות שורה — השבתה (נשמר ב-DB, ניתן לשחזור) */}
      <div className="flex items-center justify-center">
        {canEdit && (
          <button
            onClick={() => onArchive(item)}
            className="text-text-dim hover:text-status-red"
            title="השבת פריט (ניתן לשחזור)"
            data-testid={`item-archive-${item.id}`}
          >
            ×
          </button>
        )}
      </div>
    </div>
  )
}

export default function GroupSection({
  group,
  columns,
  items,
  members,
  clients,
  orgId,
  canEdit,
  isAdmin,
  onAddItem,
  onArchiveGroup,
  onItemName,
  onItemValue,
  onArchiveItem,
  onArchiveColumn,
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [newName, setNewName] = useState('')

  const gridTemplate = `minmax(220px, 1fr) repeat(${columns.length}, 160px) 40px`

  function submitNew(e) {
    e.preventDefault()
    if (!newName.trim()) return
    onAddItem(group, newName.trim())
    setNewName('')
  }

  return (
    <div className="mb-6" data-testid={`group-${group.id}`}>
      {/* כותרת הקבוצה */}
      <div className="mb-1 flex items-center gap-2">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="text-text-dim hover:text-text"
          style={{ color: group.color }}
          data-testid={`group-collapse-${group.id}`}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <h3 className="font-semibold" style={{ color: group.color }}>
          {group.name}
        </h3>
        <span className="text-xs text-text-dim">{items.length} פריטים</span>
        {isAdmin && (
          <button
            onClick={() => onArchiveGroup(group)}
            className="text-xs text-text-dim hover:text-status-red"
            title="השבת קבוצה (הפריטים נשמרים וניתנים לשחזור)"
            data-testid={`group-archive-${group.id}`}
          >
            השבת קבוצה
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="overflow-hidden rounded-md border border-border">
          {/* פס צבע + כותרות עמודות */}
          <div
            className="grid border-b border-border bg-sidebar text-xs font-medium text-text-muted"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <div className="border-e border-border px-3 py-2" style={{ boxShadow: `inset 3px 0 0 ${group.color}` }}>
              פריט
            </div>
            {columns.map((col) => (
              <div key={col.id} className="group/col flex items-center justify-center gap-1 border-e border-border px-2 py-2">
                <span className="truncate">{col.name}</span>
                {isAdmin && col.type !== 'created_at' && (
                  <button
                    onClick={() => onArchiveColumn(col)}
                    className="opacity-0 transition-opacity group-hover/col:opacity-100 hover:text-status-red"
                    title="השבת עמודה (ניתן לשחזור)"
                    data-testid={`column-archive-${col.id}`}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <div />
          </div>

          {/* שורות */}
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              columns={columns}
              members={members}
              clients={clients}
              orgId={orgId}
              gridTemplate={gridTemplate}
              canEdit={canEdit}
              onName={onItemName}
              onValue={onItemValue}
              onArchive={onArchiveItem}
            />
          ))}

          {/* הוספת פריט */}
          {canEdit && (
            <form
              onSubmit={submitNew}
              className="grid bg-surface/60"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              <div className="border-e border-border px-3 py-1.5">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="+ הוסף פריט"
                  className="w-full bg-transparent text-sm text-text outline-none placeholder:text-text-dim"
                  data-testid={`add-item-input-${group.id}`}
                />
              </div>
              <div style={{ gridColumn: `span ${columns.length + 1}` }} />
            </form>
          )}
        </div>
      )}
    </div>
  )
}
