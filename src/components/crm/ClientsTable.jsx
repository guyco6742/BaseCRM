import { Link } from 'react-router-dom'
import BoardCell from '../board/BoardCell'

// תגית סטטוס (עמודת הבסיס) — עותק קטן כדי לא ליצור תלות מעגלית ב-ClientsPage.
function StatusChip({ status }) {
  if (!status) return <span className="text-sm text-text-dim">—</span>
  return (
    <span
      className="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: status.color }}
    >
      {status.label}
    </span>
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
        return <StatusChip status={statusOf(client)} />
      case 'phone':
        return (
          <span className="text-text-muted" dir="ltr">
            {client.phone || '—'}
          </span>
        )
      case 'email':
        return (
          <span className="text-text-muted" dir="ltr">
            {client.email || '—'}
          </span>
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
              canEdit={false}
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
