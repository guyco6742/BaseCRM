# Inline Table Editing + Kanban Status Popover — Design

## Problem

Today, editing a value in the app requires leaving the current view:
- `ClientsTable` (the CRM clients table) is fully read-only — status, phone, email, and custom fields all require navigating to the client detail page or opening a modal to change.
- Kanban cards (`ClientsKanban`, `BoardKanban`) can only change their status/label via drag-and-drop between columns — there's no click-based way to change status directly on a card.

Board's own table view (`GroupSection.jsx`) already supports inline editing of custom fields via `BoardCell` with `canEdit={true}` — that pattern should be extended, not reinvented.

## Goal

1. Make `ClientsTable` support click-to-edit inline editing (same interaction as existing `BoardCell`: click a cell → it becomes editable → blur/Enter saves) for: status, phone, email, and custom fields. The client-name cell remains a navigation link (out of scope, per explicit decision).
2. Add a click-to-change-status popover to both `ClientsKanban` and `BoardKanban` cards, as an addition alongside (not a replacement for) the existing drag-and-drop.

## Non-goals

- No changes to `GroupSection.jsx`'s existing inline editing (already works).
- No changes to any other tables in the app (admin/org-settings member lists) — explicitly out of scope per decision during brainstorming.
- No new drag-and-drop library — existing native HTML5 drag-and-drop stays as-is.
- No new test framework — this repo has none (no Cypress/Vitest/Jest); verification is manual via the dev server, same as prior work in this repo.

## Design

### 1. Reusable pieces from `BoardCell.jsx`

`TextEditor` and `LinkLikeCell` are currently private (unexported) functions inside [BoardCell.jsx](../../../src/components/board/BoardCell.jsx). Export both so `ClientsTable` can reuse them directly instead of re-implementing the same click-to-edit/blur-to-save interaction.

### 2. `ClientsTable.jsx` — inline editing

New props: `onSetStatus(clientId, statusId)`, `onSetField(clientId, field, value)` (for `phone`/`email`), `onSetCustomValue(client, fieldId, value)`.

- **Status cell**: replace the read-only `StatusChip` with a new `EditableStatusChip` (in the same file), built with the existing `Popover` component: the chip is the trigger, the panel lists all `statuses` (colored buttons, same visual style as `BoardCell`'s `status` case) plus a "נקה" (clear) option. Selecting one calls `onSetStatus(client.id, chosenId)` and closes the popover.
- **Phone/email cells**: replace the plain `<span>` rendering with the exported `LinkLikeCell` from `BoardCell.jsx` (`kind="phone"` / `kind="email"`, `canEdit={true}`), calling `onSetField(client.id, 'phone'|'email', value)` on change. This keeps the existing tel:/mailto: link + pencil-icon-to-edit behavior consistent with board cells.
- **Custom field cells**: change `canEdit={false}` → `canEdit={true}` on the existing `BoardCell` usage (`ClientsTable.jsx:69-76`), wiring its `onChange` to `onSetCustomValue(client, col.field.id, value)`.

### 3. `ClientsPage.jsx` — new/reused update functions

- Reuse the existing `setClientStatus(clientId, statusId)` (already defined, currently only wired to kanban drag-drop) — pass it to `ClientsTable` as `onSetStatus`.
- Add `updateClientField(clientId, field, value)`: optimistic local update of `phone`/`email`, then `supabase.from('clients').update({ [field]: value, updated_at: ... }).eq('id', clientId)`, rolling back on error — mirrors `setClientStatus`'s existing error-handling shape (`setError('...נכשל.')`).
- Add `updateClientCustomValue(client, fieldId, value)`: optimistic local update of `client.custom_values`, then `supabase.from('clients').update({ custom_values: newValues, updated_at: ... }).eq('id', client.id)`, rolling back on error — mirrors `updateItemValue` in [BoardPage.jsx:129](../../../src/pages/BoardPage.jsx:129) exactly (same optimistic-update/rollback shape, applied to the `clients` table instead of `items`).

### 4. Kanban click-to-change-status

Both kanban components already receive an `onSetStatus` callback (used today only by drag-drop). Add a small clickable status-chip control to each card, using the existing `Popover` component, wrapped in an element with `onClick={(e) => e.stopPropagation()}` so the click doesn't also trigger the card's existing click behavior (`Link` navigation in `ClientsKanban`, `onOpenItem` in `BoardKanban`).

- **`ClientsKanban.jsx`**: add a small colored chip inside each card (below the client name) showing the client's current status label/color, wrapped in a `Popover` listing all `statuses`. Selecting one calls `onSetStatus(client.id, newStatusId)` — the same handler already used for drop.
- **`BoardKanban.jsx`**: add the same style of chip using the current `column.settings.labels` list (the same data driving the kanban columns themselves). Selecting one calls `onSetStatus(item, newLabelId)` — the same handler already used for drop.

### 5. Error handling

No new error-handling design needed — every new write follows the exact optimistic-update + rollback-on-error pattern already established by `setClientStatus` and `updateItemValue`. On failure, the local state reverts and the existing inline error banner (`setError(...)`) shows the existing Hebrew message pattern ("...נכשל.").

### 6. Testing

No test framework exists in this repo (no Cypress/Vitest/Jest — confirmed in prior work on this codebase). Verification is manual: run the dev server, exercise each new inline-edit path (status/phone/email/custom-field in the table; status-popover-click on both kanban views) and confirm changes persist (visible after a page refresh) and errors roll back correctly if a write is forced to fail.
