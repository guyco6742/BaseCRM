# New-Client Modal — Full Fields — Design

## Problem

The "new client" modal in `src/pages/ClientsPage.jsx` (the `<Modal ... title="לקוח חדש">` around line 490) only collects **name, phone, email**. But the clients table displays more columns: the pipeline **status** and any **custom fields** (`client_fields`) defined for the org. So a user creating a client cannot set those values at creation time — they must create the client, then edit each field inline in the table. The create form should match the table's editable fields.

## Goal

Extend the new-client modal to also collect:
1. **Status** — the client's pipeline stage (`status_id`), defaulting to the first status (already the current insert default).
2. **Every visible custom field** — each rendered with its field name as a label and a type-appropriate editor, reusing the existing `BoardCell` component (the same editor the table uses).

Both are saved as part of the single `clients` insert.

## Non-goals

- No change to the table, kanban, or inline-editing behavior — only the create modal.
- No new field-input components — reuse the existing `BoardCell` editors.
- `files`-type custom fields are intentionally excluded from the create modal (see below).
- No change to the `client_fields` / status management UIs.

## Design

### Fields rendered in the modal

Below the existing name/phone/email `Input`s, the modal gains:

**Status selector.** A labeled native `<select>` listing the org's `statuses` (already loaded in `ClientsPage`), value bound to `newClient.status_id`. Defaults to `statuses[0]?.id ?? null` when the modal opens — matching the current insert default so behavior is unchanged if the user leaves it alone.

**Custom-field editors.** For each field in `visibleFields` (already computed in `ClientsPage` — active, non-hidden fields, in position order) whose `type !== 'files'`, render:
- the field's `name` as a label (`<span class="mb-1 block text-sm text-text-muted">`), and
- a `BoardCell` with `canEdit`, `column={field}`, `value={newClient.custom_values?.[field.id]}`, `members={members}`, `orgId={orgId}`, and `onChange` writing into the local `custom_values` draft.

Each editor is wrapped in a bordered box (e.g. `rounded-md border border-border`) so the cell-style editors read as form controls inside the modal.

### Why `files` is excluded

`BoardCell`'s `files` type (`FilesCell`) uploads to storage keyed by the item/client id (`itemId={item?.id}`). At create time the client has no id yet, so file uploads can't be associated. File-type fields are therefore omitted from the create modal; they remain fillable from the table immediately after the client is created. This is the only excluded type.

### State changes

`newClient` state (currently `{ name, phone, email }`) gains `status_id` and `custom_values`:
- Initialized to `{ name: '', phone: '', email: '', status_id: statuses[0]?.id ?? null, custom_values: {} }`.
- Because `statuses` loads asynchronously, the modal's status `<select>` falls back to `statuses[0]?.id` for display when `newClient.status_id` is not yet set, and the create handler resolves the same default — so an unset value still persists the first status.
- Reset to the same initial shape after a successful create (matching the existing reset that clears the form).

### Save

`handleCreate` includes the new fields in the insert:

```js
const { error } = await supabase.from('clients').insert({
  org_id: orgId,
  name: newClient.name.trim(),
  phone: newClient.phone.trim() || null,
  email: newClient.email.trim() || null,
  status_id: newClient.status_id ?? statuses[0]?.id ?? null,
  custom_values: newClient.custom_values || {},
  position: clients.length,
})
```

`custom_values` is a `jsonb not null default '{}'` column on `clients` (confirmed in `supabase/migration_004_crm.sql`), so passing an object (or `{}`) is safe.

### Error handling

Unchanged from the existing `handleCreate` try/catch: on failure it shows `'יצירת הלקוח נכשלה.'` and keeps the modal open with the entered values. No new error paths are introduced.

## Testing

No test framework exists in this repo (no Cypress/Vitest/Jest) — verification is manual via the dev server: open the new-client modal, confirm status + all non-file custom fields appear with correct editors, create a client with values set, and confirm they persist (visible in the table and after a refresh). A file-type field, if one exists, should not appear in the modal.
