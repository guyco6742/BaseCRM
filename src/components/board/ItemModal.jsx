import { useEffect, useState } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import BoardCell from './BoardCell'
import { formatDateTime } from '../../lib/columnTypes'
import { handleEnterAsTab } from '../../lib/formNav'

// חלון עריכת משימה — נפתח בלחיצה על כרטיס בקנבן.
// item מגיע "חי" מה-state של הבורד, כך שכל שינוי משתקף מיד בכל התצוגות.
export default function ItemModal({
  open,
  item,
  columns,
  groups,
  members,
  clients,
  orgId,
  canEdit,
  onClose,
  onName,
  onValue,
  onMoveGroup,
  onArchive,
}) {
  const [nameDraft, setNameDraft] = useState('')

  useEffect(() => {
    if (item) setNameDraft(item.name)
  }, [item])

  if (!item) return null

  function commitName() {
    const trimmed = nameDraft.trim()
    if (trimmed && trimmed !== item.name) onName(item, trimmed)
  }

  return (
    <Modal open={open} onClose={onClose} title="עריכת משימה" size="lg" testid="item-modal">
      <div className="space-y-4" onKeyDown={handleEnterAsTab}>
        {/* שם המשימה */}
        <label className="block">
          <span className="mb-1 block text-xs text-text-dim">שם המשימה</span>
          <input
            value={nameDraft}
            disabled={!canEdit}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setNameDraft(item.name)
            }}
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-lg font-medium text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/50"
            data-testid="item-modal-name"
          />
        </label>

        {/* קבוצה */}
        <label className="block">
          <span className="mb-1 block text-xs text-text-dim">קבוצה</span>
          <select
            value={item.group_id}
            disabled={!canEdit}
            onChange={(e) => onMoveGroup(item, e.target.value)}
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/50"
            data-testid="item-modal-group"
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>

        {/* כל העמודות */}
        <div className="space-y-2 border-t border-border pt-3">
          {columns.map((col) => (
            <div key={col.id} className="grid grid-cols-[1fr_2fr] items-center gap-2">
              <span className="truncate text-sm text-text-dim">{col.name}</span>
              <div
                className="h-9 overflow-hidden rounded-md border border-border bg-bg"
                data-testid={`item-modal-field-${col.id}`}
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
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="text-xs text-text-dim">נוצר: {formatDateTime(item.created_at)}</span>
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onArchive(item)
                onClose()
              }}
              data-testid="item-modal-archive"
            >
              <span className="text-status-orange">השבת משימה</span>
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
