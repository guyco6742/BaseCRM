import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Popover from '../board/Popover'

// צ'יפ סטטוס לחיץ בכרטיס — פותח popover לבחירת שלב חדש בלי לגרור
function StatusChipButton({ status, statuses, onSelect }) {
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <Popover
        panelWidth={160}
        panel={(close) => (
          <div className="space-y-1">
            {statuses.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  onSelect(s.id)
                  close()
                }}
                className="block w-full rounded px-2 py-1.5 text-start text-sm font-medium text-white"
                style={{ backgroundColor: s.color }}
                data-testid={`kanban-status-option-${s.id}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      >
        <span
          className="mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium text-white"
          style={{ backgroundColor: status?.color || '#4a4f77' }}
          data-testid="kanban-card-status-chip"
        >
          {status ? status.label : 'ללא שלב'}
        </span>
      </Popover>
    </span>
  )
}

// תצוגת קנבן — עמודה לכל שלב בפייפליין, גרירת לקוח בין עמודות משנה את השלב
export default function ClientsKanban({ clients, statuses, orgId, onSetStatus }) {
  const navigate = useNavigate()
  const [dragOverCol, setDragOverCol] = useState(null)
  // מבחין בין גרירה ללחיצה — כדי שסיום גרירה לא ינווט לעמוד הלקוח
  const draggingRef = useRef(false)

  // עמודה לכל שלב פעיל + עמודת "ללא שלב" אם יש לקוחות בלי סטטוס
  const noStatusClients = clients.filter((c) => !c.status_id || !statuses.some((s) => s.id === c.status_id))
  const columns = [
    ...statuses.map((s) => ({ id: s.id, label: s.label, color: s.color })),
    ...(noStatusClients.length > 0 ? [{ id: null, label: 'ללא שלב', color: '#4a4f77' }] : []),
  ]

  function clientsOf(colId) {
    if (colId === null) return noStatusClients
    return clients.filter((c) => c.status_id === colId)
  }

  function handleDrop(e, colId) {
    e.preventDefault()
    setDragOverCol(null)
    const clientId = e.dataTransfer.getData('clientId')
    if (clientId) onSetStatus(clientId, colId)
  }

  return (
    <div className="flex items-start gap-3 overflow-x-auto pb-4" data-testid="clients-kanban">
      {columns.map((col) => {
        const list = clientsOf(col.id)
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
            data-testid={`kanban-col-${col.id ?? 'none'}`}
          >
            {/* כותרת עמודה */}
            <div
              className="flex items-center justify-between rounded-t-lg px-3 py-2 text-sm font-semibold text-white"
              style={{ backgroundColor: col.color }}
            >
              <span>{col.label}</span>
              <span className="rounded-full bg-black/20 px-2 text-xs">{list.length}</span>
            </div>

            {/* כרטיסי לקוח */}
            <div className="min-h-[80px] space-y-2 p-2">
              {list.map((c) => (
                <div
                  key={c.id}
                  draggable
                  onDragStart={(e) => {
                    draggingRef.current = true
                    e.dataTransfer.setData('clientId', c.id)
                  }}
                  onDragEnd={() => setTimeout(() => (draggingRef.current = false), 100)}
                  onClick={() => {
                    if (!draggingRef.current) navigate(`/org/${orgId}/clients/${c.id}`)
                  }}
                  className="block cursor-grab rounded-md border border-border bg-surface p-3 hover:border-accent active:cursor-grabbing"
                  data-testid={`kanban-card-${c.id}`}
                >
                  <div className="truncate text-sm font-medium text-text">{c.name}</div>
                  {(c.phone || c.email) && (
                    <div className="mt-1 truncate text-xs text-text-dim" dir="ltr">
                      {c.phone || c.email}
                    </div>
                  )}
                  {(c.contacts?.[0]?.count ?? 0) > 0 && (
                    <div className="mt-1 text-xs text-text-dim">👤 {c.contacts[0].count} אנשי קשר</div>
                  )}
                  <StatusChipButton
                    status={statuses.find((s) => s.id === c.status_id)}
                    statuses={statuses}
                    onSelect={(statusId) => onSetStatus(c.id, statusId)}
                  />
                </div>
              ))}
              {list.length === 0 && (
                <p className="py-4 text-center text-xs text-text-dim">גררו לקוח לכאן</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
