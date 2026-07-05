import { Link } from 'react-router-dom'
import BoardCell, { LinkLikeCell } from '../board/BoardCell'
import Popover from '../board/Popover'

// צ'יפ סטטוס לחיץ — פותח popover לבחירת שלב חדש
function EditableStatusChip({ status, statuses, onSelect }) {
  const cell = (
    <span
      className="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: status?.color || '#4a4f77' }}
    >
      {status ? status.label : <span className="text-text-dim">—</span>}
    </span>
  )
  return (
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
              data-testid={`status-option-${s.id}`}
            >
              {s.label}
            </button>
          ))}
          <button
            onClick={() => {
              onSelect(null)
              close()
            }}
            className="block w-full rounded px-2 py-1.5 text-start text-sm text-text-muted hover:bg-surface-2"
          >
            נקה
          </button>
        </div>
      )}
    >
      {cell}
    </Popover>
  )
}

// חץ כיוון המיון בכותרת העמודה הפעילה.
function SortArrow({ active, dir }) {
  if (!active) return null
  return <span className="text-accent">{dir === 'asc' ? ' ▲' : ' ▼'}</span>
}

export default function ClientsTable({
  clients,
  columns,
  orgId,
  statuses,
  members = [],
  sort,
  onSort,
  onArchive,
  onSetStatus,
  onSetField,
  onSetCustomValue,
}) {
  const statusOf = (c) => statuses.find((s) => s.id === c.status_id)

  function renderCell(client, col) {
    switch (col.kind) {
      case 'name':
        return (
          <Link
            to={`/org/${orgId}/clients/${client.id}`}
            className="font-medium text-text hover:text-accent"
            data-testid={`client-link-${client.id}`}
          >
            {client.name}
          </Link>
        )
      case 'status':
        return (
          <EditableStatusChip
            status={statusOf(client)}
            statuses={statuses}
            onSelect={(statusId) => onSetStatus(client.id, statusId)}
          />
        )
      case 'phone':
        return (
          <div className="h-8 min-w-[7rem]" data-testid={`client-phone-${client.id}`}>
            <LinkLikeCell
              value={client.phone}
              onChange={(v) => onSetField(client.id, 'phone', v)}
              canEdit
              kind="phone"
            />
          </div>
        )
      case 'email':
        return (
          <div className="h-8 min-w-[7rem]" data-testid={`client-email-${client.id}`}>
            <LinkLikeCell
              value={client.email}
              onChange={(v) => onSetField(client.id, 'email', v)}
              canEdit
              kind="email"
            />
          </div>
        )
      case 'contacts':
        return <span className="text-text-dim">{client.contacts?.[0]?.count ?? 0}</span>
      case 'custom':
        return (
          <div
            className="h-8 min-w-[7rem] overflow-hidden rounded-md"
            data-testid={`client-cell-${client.id}-${col.field.id}`}
          >
            <BoardCell
              column={col.field}
              item={client}
              orgId={orgId}
              value={client.custom_values?.[col.field.id]}
              members={members}
              canEdit
              onChange={(v) => onSetCustomValue(client, col.field.id, v)}
            />
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border" data-testid="clients-table">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-sidebar text-xs font-medium text-text-muted">
            {columns.map((col) => (
              <th
                key={col.key}
                onClick={() => onSort(col.key)}
                className="cursor-pointer select-none whitespace-nowrap px-4 py-2 text-start hover:text-text"
                title="מיון לפי עמודה זו"
                data-testid={`clients-th-${col.key}`}
              >
                {col.label}
                <SortArrow active={sort?.key === col.key} dir={sort?.dir} />
              </th>
            ))}
            <th className="w-10 px-2" />
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <tr
              key={c.id}
              className="border-b border-border bg-surface last:border-b-0 hover:bg-surface-2"
              data-testid={`client-row-${c.id}`}
            >
              {columns.map((col) => (
                <td key={col.key} className="whitespace-nowrap px-4 py-2 align-middle">
                  {renderCell(c, col)}
                </td>
              ))}
              <td className="px-2 text-center align-middle">
                <button
                  onClick={() => onArchive(c)}
                  className="text-text-dim hover:text-status-red"
                  title="השבת לקוח (ניתן לשחזור)"
                  data-testid={`client-archive-${c.id}`}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
