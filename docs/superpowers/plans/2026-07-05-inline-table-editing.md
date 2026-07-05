# Inline Table Editing + Kanban Status Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users edit status/phone/email/custom fields directly in the CRM clients table, and change a card's status via a click-to-open popover on both kanban boards (in addition to existing drag-and-drop).

**Architecture:** Reuse the existing `BoardCell`-based inline-edit patterns (click-to-edit `TextEditor`/`LinkLikeCell`, and the portal-based `Popover` component) rather than inventing new ones. `ClientsTable` gains new callback props wired up in `ClientsPage.jsx`; both kanban components gain a small status-chip-with-popover on each card, reusing the `onSetStatus` callback each already receives.

**Tech Stack:** React 19, Supabase JS client, existing `Popover`/`BoardCell` components — no new dependencies.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-05-inline-table-editing-design.md`
- Client-name cell in `ClientsTable` stays a navigation link — NOT in scope for inline editing.
- Only `ClientsTable` and `GroupSection`'s existing editing are in scope — no other tables (e.g. admin/org-settings member lists) get inline editing in this plan.
- No new drag-and-drop library — native HTML5 drag-and-drop stays as-is; the popover is an addition, not a replacement.
- All new writes follow the existing optimistic-update + rollback-on-error pattern (see `setClientStatus` in `src/pages/ClientsPage.jsx:159` and `updateItemValue` in `src/pages/BoardPage.jsx:129`), with the existing Hebrew error-message style (e.g. `'עדכון ... נכשל.'`).
- No test framework exists in this repo (no Cypress/Vitest/Jest) — verification is manual via the dev server, not automated tests.
- All UI copy is Hebrew, RTL, matching existing tone in the files being modified.

---

### Task 1: Export reusable cell editors from `BoardCell.jsx`

**Files:**
- Modify: `src/components/board/BoardCell.jsx:8` and `src/components/board/BoardCell.jsx:366`

**Interfaces:**
- Consumes: nothing new.
- Produces: `TextEditor` and `LinkLikeCell` become named exports of `src/components/board/BoardCell.jsx`, importable as `import BoardCell, { TextEditor, LinkLikeCell } from '../board/BoardCell'`. `LinkLikeCell` signature: `LinkLikeCell({ value, onChange, canEdit, kind })` where `kind` is `'link' | 'email' | 'phone'`.

- [ ] **Step 1: Add `export` to the two function declarations**

In `src/components/board/BoardCell.jsx`, change line 8 from:

```jsx
function TextEditor({ value, onChange, type = 'text', display }) {
```

to:

```jsx
export function TextEditor({ value, onChange, type = 'text', display }) {
```

And change line 366 from:

```jsx
function LinkLikeCell({ value, onChange, canEdit, kind }) {
```

to:

```jsx
export function LinkLikeCell({ value, onChange, canEdit, kind }) {
```

Do not change anything else in the file — `BoardCell`'s own internal usages of these two functions are unaffected by adding `export`.

- [ ] **Step 2: Verify the app still builds and lints clean**

Run: `npm run build` and `npm run lint` from the repo root.
Expected: both succeed with no new errors (pre-existing warnings unrelated to this file are fine).

- [ ] **Step 3: Manual smoke check — existing editing still works**

Start the dev server, open a board with at least one group and a text/number custom column, and confirm inline editing in `GroupSection`'s table view still works exactly as before (click a cell, type, blur, value persists after refresh). This confirms the export change didn't alter existing behavior.

- [ ] **Step 4: Commit**

```bash
git add src/components/board/BoardCell.jsx
git commit -m "refactor: export TextEditor and LinkLikeCell from BoardCell for reuse"
```

---

### Task 2: Inline editing in `ClientsTable`

**Files:**
- Modify: `src/components/crm/ClientsTable.jsx` (full-file rewrite)
- Modify: `src/pages/ClientsPage.jsx:159-166` (add two new functions), `src/pages/ClientsPage.jsx:450-461` (pass new props)

**Interfaces:**
- Consumes: `TextEditor`, `LinkLikeCell` exported in Task 1 from `src/components/board/BoardCell.jsx`; the existing `Popover` component at `src/components/board/Popover.jsx` (props: `children`, `panel(close)`, `panelWidth`); the existing `setClientStatus(clientId, statusId)` function already defined in `ClientsPage.jsx:159`.
- Produces: `ClientsTable` gains three new required props: `onSetStatus(clientId, statusId)`, `onSetField(clientId, field, value)`, `onSetCustomValue(client, fieldId, value)`. `ClientsPage.jsx` gains `updateClientField(clientId, field, value)` and `updateClientCustomValue(client, fieldId, value)` functions (used only by this task; not consumed elsewhere).

- [ ] **Step 1: Add `updateClientField` and `updateClientCustomValue` to `ClientsPage.jsx`**

In `src/pages/ClientsPage.jsx`, immediately after the existing `setClientStatus` function (after line 166), add:

```jsx
  // עדכון טלפון/אימייל מהטבלה — עדכון אופטימי
  async function updateClientField(clientId, field, value) {
    const prev = clients.find((c) => c.id === clientId)
    setClients((cur) => cur.map((c) => (c.id === clientId ? { ...c, [field]: value } : c)))
    const { error } = await supabase
      .from('clients')
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq('id', clientId)
    if (error) {
      setClients((cur) => cur.map((c) => (c.id === clientId ? { ...c, [field]: prev?.[field] } : c)))
      setError('עדכון השדה נכשל.')
    }
  }

  // עדכון שדה מותאם מהטבלה — עדכון אופטימי (כמו updateItemValue בבורד)
  async function updateClientCustomValue(client, fieldId, value) {
    const newValues = { ...(client.custom_values || {}), [fieldId]: value }
    setClients((cur) => cur.map((c) => (c.id === client.id ? { ...c, custom_values: newValues } : c)))
    const { error } = await supabase
      .from('clients')
      .update({ custom_values: newValues, updated_at: new Date().toISOString() })
      .eq('id', client.id)
    if (error) {
      setClients((cur) =>
        cur.map((c) => (c.id === client.id ? { ...c, custom_values: client.custom_values } : c))
      )
      setError('שמירת השינוי נכשלה.')
    }
  }
```

- [ ] **Step 2: Pass the new props to `<ClientsTable>` in `ClientsPage.jsx`**

Find the `<ClientsTable ... />` usage (around line 451):

```jsx
        <ClientsTable
          clients={sorted}
          columns={columns}
          orgId={orgId}
          statuses={statuses}
          members={members}
          sort={sort}
          onSort={applySort}
          onArchive={archiveClient}
        />
```

Replace it with:

```jsx
        <ClientsTable
          clients={sorted}
          columns={columns}
          orgId={orgId}
          statuses={statuses}
          members={members}
          sort={sort}
          onSort={applySort}
          onArchive={archiveClient}
          onSetStatus={setClientStatus}
          onSetField={updateClientField}
          onSetCustomValue={updateClientCustomValue}
        />
```

- [ ] **Step 3: Rewrite `src/components/crm/ClientsTable.jsx`**

Replace the entire file content with:

```jsx
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
```

- [ ] **Step 4: Verify build and lint**

Run: `npm run build` and `npm run lint` from the repo root.
Expected: both succeed with no new errors.

- [ ] **Step 5: Manual verification**

Start the dev server, open the clients list view (`/org/:orgId/clients`, list view, not kanban):
- Click a status chip → popover opens with all statuses + "נקה" → pick one → chip updates, popover closes.
- Click a phone or email cell → input appears → type a new value → blur or Enter → value persists after a page refresh.
- Click a custom-field cell (text/number/status/etc., whichever exists in your test org) → confirm it's now editable and saves.
- Confirm the client-name cell is still a plain navigation link (unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/components/crm/ClientsTable.jsx src/pages/ClientsPage.jsx
git commit -m "feat: add inline editing to ClientsTable (status, phone, email, custom fields)"
```

---

### Task 3: Click-to-change-status popover on `ClientsKanban` cards

**Files:**
- Modify: `src/components/crm/ClientsKanban.jsx` (full-file rewrite)

**Interfaces:**
- Consumes: the existing `Popover` component (`src/components/board/Popover.jsx`); the `onSetStatus(clientId, statusId)` prop already passed into `ClientsKanban` by `ClientsPage.jsx:442` (`onSetStatus={setClientStatus}`) — no changes needed in `ClientsPage.jsx` for this task.
- Produces: nothing consumed by later tasks.

**Note on approach:** `ClientsKanban`'s cards are currently rendered as `<Link>` (an `<a>` tag). Nesting a clickable `<button>` (which `Popover`'s trigger renders) inside an `<a>` is invalid HTML and behaves inconsistently across browsers. This task converts the card from `<Link>` to a `<div>` with `useNavigate`-based click-to-navigate, using the same "distinguish a completed drag from a click" `draggingRef` pattern already used in `src/components/board/BoardKanban.jsx:19-20,93-101` — this keeps drag-and-drop working exactly as before while making room for the nested status button.

- [ ] **Step 1: Rewrite `src/components/crm/ClientsKanban.jsx`**

Replace the entire file content with:

```jsx
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
```

- [ ] **Step 2: Verify build and lint**

Run: `npm run build` and `npm run lint` from the repo root.
Expected: both succeed with no new errors.

- [ ] **Step 3: Manual verification**

Start the dev server, switch the clients page to kanban view (`▦ קנבן` toggle):
- Confirm clicking a card (away from the status chip) still navigates to the client detail page.
- Confirm dragging a card to a different column still changes its status (existing behavior).
- Click the small status chip on a card → popover opens listing all statuses → pick a different one → card's chip updates and the card moves to the corresponding kanban column, WITHOUT navigating away.

- [ ] **Step 4: Commit**

```bash
git add src/components/crm/ClientsKanban.jsx
git commit -m "feat: add click-to-change-status popover to ClientsKanban cards"
```

---

### Task 4: Click-to-change-status popover on `BoardKanban` cards

**Files:**
- Modify: `src/components/board/BoardKanban.jsx` (full-file rewrite)

**Interfaces:**
- Consumes: the existing `Popover` component (`src/components/board/Popover.jsx`); the `onSetStatus(item, labelId)` prop already passed into `BoardKanban` by `src/pages/BoardPage.jsx:347` (`onSetStatus={(item, labelId) => updateItemValue(item, kanbanColumn.id, labelId)}`) — no changes needed in `BoardPage.jsx` for this task; the existing `column.settings.labels` array (each `{ id, label, color }`) already computed as `labels` at `BoardKanban.jsx:22`.
- Produces: nothing consumed by later tasks.

**Note on approach:** unlike `ClientsKanban`, `BoardKanban`'s cards are already plain `<div>` elements (not links), so nesting a `Popover`-triggered `<button>` inside is valid HTML — no structural card change is needed here, just adding the chip and gating it behind `canEdit` (matching the existing `draggable={canEdit}` gating on the same card).

- [ ] **Step 1: Rewrite `src/components/board/BoardKanban.jsx`**

Replace the entire file content with:

```jsx
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
                    className={`cursor-pointer rounded-md border border-border bg-surface p-3 hover:border-accent ${
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
```

- [ ] **Step 2: Verify build and lint**

Run: `npm run build` and `npm run lint` from the repo root.
Expected: both succeed with no new errors.

- [ ] **Step 3: Manual verification**

Start the dev server, open a board that has a `status`-type column selected as the kanban-driving column, switch to kanban view:
- Confirm clicking a card (away from the status chip) still opens the item modal (existing behavior).
- Confirm dragging a card to a different column still changes its status (existing behavior).
- Click the status chip on a card → popover opens listing all labels + "נקה" → pick a different one → card moves to the corresponding column, WITHOUT opening the item modal.

- [ ] **Step 4: Commit**

```bash
git add src/components/board/BoardKanban.jsx
git commit -m "feat: add click-to-change-status popover to BoardKanban cards"
```
