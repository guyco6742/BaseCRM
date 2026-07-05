# New-Client Modal — Full Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "new client" modal collect status and all visible custom fields (not just name/phone/email), so creating a client can set every column the table shows.

**Architecture:** Extend `newClient` state in `src/pages/ClientsPage.jsx` with `status_id` and `custom_values`; render a status `<select>` and one labeled `BoardCell` editor per non-file visible custom field inside the existing create `<Modal>`; include both in the `clients` insert.

**Tech Stack:** React 19, Supabase JS client, existing `BoardCell` component — no new dependencies.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-05-new-client-modal-fields-design.md`
- Only the create modal in `src/pages/ClientsPage.jsx` changes — no table/kanban/inline-editing changes.
- Reuse the existing `BoardCell` component (`src/components/board/BoardCell.jsx`, default export) for custom-field editors — no new input components.
- `files`-type custom fields are excluded from the create modal (uploads need the client id, which doesn't exist yet).
- `custom_values` is a `jsonb not null default '{}'` column on `clients` — passing `{}` or an object is safe.
- All UI copy is Hebrew, RTL, matching existing tone in the file.
- No test framework exists in this repo (no Cypress/Vitest/Jest) — verification is manual via the dev server + `npm run build`/`npm run lint`.

---

### Task 1: Add status + custom fields to the new-client modal

**Files:**
- Modify: `src/pages/ClientsPage.jsx` — import (line 13 area), `newClient` initial state (line 53), `handleCreate` insert + reset (lines 207-217), and the create `<Modal>` form (after line 551).

**Interfaces:**
- Consumes: `BoardCell` default export from `src/components/board/BoardCell.jsx` (props used here: `column`, `item`, `orgId`, `value`, `members`, `canEdit`, `onChange`); existing in-scope state/vars in `ClientsPage`: `statuses`, `members`, `orgId`, `visibleFields`, `clients`, `setNewClient`, `newClient`.
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Import `BoardCell`**

In `src/pages/ClientsPage.jsx`, add this import after the existing `ClientsTable` import (line 13):

```jsx
import BoardCell from '../components/board/BoardCell'
```

- [ ] **Step 2: Extend `newClient` initial state**

Change line 53 from:

```jsx
  const [newClient, setNewClient] = useState({ name: '', phone: '', email: '' })
```

to:

```jsx
  const [newClient, setNewClient] = useState({ name: '', phone: '', email: '', status_id: null, custom_values: {} })
```

- [ ] **Step 3: Include status + custom_values in the insert, and reset the full shape**

In `handleCreate`, replace the insert object and the post-success reset. Change (lines 207-217):

```jsx
      const { error } = await supabase.from('clients').insert({
        org_id: orgId,
        name: newClient.name.trim(),
        phone: newClient.phone.trim() || null,
        email: newClient.email.trim() || null,
        status_id: statuses[0]?.id ?? null, // ברירת מחדל: השלב הראשון בפייפליין
        position: clients.length,
      })
      if (error) throw error
      setAddOpen(false)
      setNewClient({ name: '', phone: '', email: '' })
```

to:

```jsx
      const { error } = await supabase.from('clients').insert({
        org_id: orgId,
        name: newClient.name.trim(),
        phone: newClient.phone.trim() || null,
        email: newClient.email.trim() || null,
        status_id: newClient.status_id ?? statuses[0]?.id ?? null, // ברירת מחדל: השלב הראשון בפייפליין
        custom_values: newClient.custom_values || {},
        position: clients.length,
      })
      if (error) throw error
      setAddOpen(false)
      setNewClient({ name: '', phone: '', email: '', status_id: null, custom_values: {} })
```

- [ ] **Step 4: Render the status selector + custom-field editors in the modal**

In the create `<Modal>`'s `<form>`, insert the following block AFTER the email `<Input>` (i.e. after the closing `/>` on line 551, before the `<div className="flex justify-start gap-2">` submit row on line 552):

```jsx
          <label className="block">
            <span className="mb-1 block text-sm text-text-muted">שלב</span>
            <select
              value={newClient.status_id ?? statuses[0]?.id ?? ''}
              onChange={(e) => setNewClient((c) => ({ ...c, status_id: e.target.value || null }))}
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent"
              data-testid="client-status-select"
            >
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          {visibleFields
            .filter((f) => f.type !== 'files')
            .map((field) => (
              <label key={field.id} className="block">
                <span className="mb-1 block text-sm text-text-muted">{field.name}</span>
                <div
                  className="h-9 overflow-hidden rounded-md border border-border"
                  data-testid={`client-field-input-${field.id}`}
                >
                  <BoardCell
                    column={field}
                    item={newClient}
                    orgId={orgId}
                    value={newClient.custom_values?.[field.id]}
                    members={members}
                    canEdit
                    onChange={(v) =>
                      setNewClient((c) => ({
                        ...c,
                        custom_values: { ...(c.custom_values || {}), [field.id]: v },
                      }))
                    }
                  />
                </div>
              </label>
            ))}
```

- [ ] **Step 5: Verify build and lint**

Run: `npm run build` and `npm run lint` from the repo root.
Expected: both succeed with no new errors (a single pre-existing `ColumnSettingsEditor.jsx` warning from lint, and the chunk-size warning from build, are expected and unrelated).

- [ ] **Step 6: Manual verification**

Start the dev server, open the clients page, click "+ לקוח חדש":
- Confirm the modal now shows a "שלב" (status) dropdown listing the org's statuses, plus one labeled editor per visible custom field (text/number/status/dropdown/date/checkbox/person/link/email/phone), and that a `files`-type field (if the org has one) does NOT appear.
- Create a client with a status and at least one custom field value set; confirm the new client appears in the table with those values and they persist after a page refresh.
- Confirm creating a client while leaving status untouched still assigns the first status (unchanged default behavior).

- [ ] **Step 7: Commit**

```bash
git add src/pages/ClientsPage.jsx
git commit -m "feat: collect status and custom fields in the new-client modal"
```
