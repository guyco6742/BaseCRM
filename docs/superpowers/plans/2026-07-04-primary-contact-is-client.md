# Primary Contact Is Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the client detail page, the primary contact defaults to "the client themselves" — no data entry required — and only reveals separate name/role/phone/email fields when the user unchecks that default.

**Architecture:** Add five columns directly on `public.clients` (`contact_is_self`, `contact_name`, `contact_role`, `contact_phone`, `contact_email`) via a new idempotent SQL migration. `ClientPage.jsx` reads/writes them through the existing generic `patchClient()` optimistic-update helper — no new component, no new table, no changes to the existing multi-contact (`contacts` table) feature.

**Tech Stack:** React 19 (plain JSX, no TypeScript), Supabase (Postgres + PostgREST + RLS), Tailwind CSS, Vite. No test framework is configured in this project (`package.json` has only `dev`/`build`/`lint`/`preview`) — verification is build + lint + a live PostgREST smoke check + manual browser walkthrough, matching how every prior feature in this codebase (including the CRM's earlier migrations) was verified.

## Global Constraints

- Full spec: `docs/superpowers/specs/2026-07-04-primary-contact-is-client-design.md`.
- This project is **not a git repository** (confirmed: `git rev-parse --is-inside-work-tree` fails with "not a git repository"). Skip all git steps — no `git init`, no commits. Where the task template says "Commit", instead just check the step's checkbox and move to the next step.
- SQL migrations in this project are applied manually by the user pasting the file into the Supabase SQL Editor (see `supabase/migration_007_security_fix_super_admin.sql`, `supabase/migration_008_tonika_status_fields.sql` for the established style/header comment convention). The agent has no `service_role` key and cannot run DDL directly — do not attempt to `psql` into the database.
- Supabase project ref: `iezgyetfwgmlczcrnrvx`. `.env` has `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` — the anon key is safe to use for read-only REST smoke checks (RLS-protected) but must never be used to bypass RLS or embedded anywhere beyond what's already in `.env`.
- Existing pattern to reuse verbatim: `EditableField` (local component in `src/pages/ClientPage.jsx`, draft-state + commit-on-blur input) and `patchClient(patch)` (optimistic update + Supabase `.update()` + `updated_at` bump), both already defined in that file — do not duplicate them.
- This feature touches **only** the primary contact. The existing `contacts` table, `openAddContact`/`openEditContact`/`saveContact`/`archiveContact` functions, and the "+ איש קשר" list below it are unmodified except for a heading-text rename.

---

### Task 1: Database migration — primary contact columns on `clients`

**Files:**
- Create: `supabase/migration_009_primary_contact.sql`

**Interfaces:**
- Produces: five new nullable-except-first columns on `public.clients`, readable via PostgREST `select`: `contact_is_self` (boolean, not null, default `true`), `contact_name` (text), `contact_role` (text), `contact_phone` (text), `contact_email` (text). Task 2 reads/writes these exact column names through `client.contact_is_self`, `client.contact_name`, etc.

- [ ] **Step 1: Write the migration file**

Create `supabase/migration_009_primary_contact.sql` with this exact content:

```sql
-- ============================================================================
-- מיגרציה 009 — איש קשר ראשי = הלקוח עצמו (כברירת מחדל)
--
-- מוסיף לטבלת clients את השדות הדרושים כדי לתמוך במצב שבו איש הקשר הראשי
-- הוא הלקוח עצמו (ברירת מחדל, ללא צורך במילוי נתונים), ורק כשמסמנים שאיש
-- הקשר שונה מהלקוח נשמרים עבורו שם/תפקיד/טלפון/אימייל נפרדים.
-- לא נוגע בטבלת contacts (רשימת אנשי הקשר הנוספים) — ללא שינוי שם.
-- הריצו ב-Supabase → SQL Editor. בטוח להריץ שוב (idempotent).
-- ============================================================================

alter table public.clients add column if not exists contact_is_self boolean not null default true;
alter table public.clients add column if not exists contact_name  text;
alter table public.clients add column if not exists contact_role  text;
alter table public.clients add column if not exists contact_phone text;
alter table public.clients add column if not exists contact_email text;
```

- [ ] **Step 2: Ask the user to run the migration**

Tell the user: "Please run `supabase/migration_009_primary_contact.sql` in Supabase → SQL Editor (same process as the previous migrations), then let me know when it's done." Wait for their confirmation before proceeding to Step 3.

- [ ] **Step 3: Live smoke check via PostgREST**

Run this to confirm the columns exist and are readable (uses the anon key already in `.env`; expects `200` and a JSON array — either `[]` if the org has no clients visible to an anonymous caller, or objects containing the new keys; it must NOT be a `42703` "column does not exist" error):

```bash
cd "C:\Users\USER\Desktop\Caulde\BaseCrm"
URL=$(grep VITE_SUPABASE_URL .env | cut -d= -f2)
ANON=$(grep VITE_SUPABASE_ANON_KEY .env | cut -d= -f2)
curl -s "$URL/rest/v1/clients?select=id,contact_is_self,contact_name,contact_role,contact_phone,contact_email&limit=1" -H "apikey: $ANON"
```

Expected: either `[]` or a JSON array of objects — not `{"code":"42703",...}`. If you get a `42703` error, the migration wasn't applied yet; go back to Step 2.

- [ ] **Step 4: Mark task complete**

No git commit (this project has no `.git`). Check off this task in your tracking and move to Task 2.

---

### Task 2: `ClientPage.jsx` — primary contact toggle + inline fields

**Files:**
- Modify: `src/pages/ClientPage.jsx:383-442` (the "אנשי קשר" `<section>`)

**Interfaces:**
- Consumes: `client` state object (now includes `contact_is_self: boolean`, `contact_name/role/phone/email: string|null` from Task 1's migration — already returned by the existing `select('*')` in `load()`, no query change needed). Consumes `patchClient(patch: object): Promise<void>` (already defined in this file, ~line 134). Consumes `EditableField` (already defined in this file, ~line 15) with props `{ label, value, onSave, type, textarea, testid, dir }`. Consumes `handleEnterAsTab` (already imported at the top of the file).
- Produces: no new exports — this is a leaf UI change inside the default-exported `ClientPage` component.

- [ ] **Step 1: Replace the "אנשי קשר" section**

In `src/pages/ClientPage.jsx`, find this exact block (currently lines 383-390):

```jsx
          {/* אנשי קשר */}
          <section className="rounded-lg border border-border bg-surface p-4" data-testid="client-contacts">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-text">אנשי קשר ({contacts.length})</h2>
              <Button size="sm" variant="secondary" onClick={openAddContact} data-testid="contact-add-btn">
                + איש קשר
              </Button>
            </div>
```

Replace it with:

```jsx
          {/* אנשי קשר */}
          <section className="rounded-lg border border-border bg-surface p-4" data-testid="client-contacts">
            {/* איש קשר ראשי — ברירת מחדל: הלקוח עצמו */}
            <div className="mb-4 border-b border-border pb-4" data-testid="primary-contact">
              <label className="flex items-center gap-2 text-sm text-text">
                <input
                  type="checkbox"
                  checked={client.contact_is_self}
                  onChange={(e) => patchClient({ contact_is_self: e.target.checked })}
                  className="h-4 w-4 accent-[var(--color-accent)]"
                  data-testid="primary-contact-is-self"
                />
                איש הקשר הוא הלקוח עצמו
              </label>

              {client.contact_is_self ? (
                <div
                  className="mt-2 rounded-md bg-bg px-3 py-2 text-sm text-text-muted"
                  data-testid="primary-contact-self-summary"
                >
                  <div>{client.name}</div>
                  {client.phone && <div dir="ltr">{client.phone}</div>}
                  {client.email && <div dir="ltr">{client.email}</div>}
                </div>
              ) : (
                <div className="mt-3 space-y-3" onKeyDown={handleEnterAsTab}>
                  <EditableField
                    label="שם איש הקשר"
                    value={client.contact_name}
                    onSave={(v) => patchClient({ contact_name: v })}
                    testid="primary-contact-name"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <EditableField
                      label="תפקיד"
                      value={client.contact_role}
                      onSave={(v) => patchClient({ contact_role: v })}
                      testid="primary-contact-role"
                    />
                    <EditableField
                      label="טלפון"
                      type="tel"
                      value={client.contact_phone}
                      onSave={(v) => patchClient({ contact_phone: v })}
                      testid="primary-contact-phone"
                      dir="ltr"
                    />
                  </div>
                  <EditableField
                    label="אימייל"
                    type="email"
                    value={client.contact_email}
                    onSave={(v) => patchClient({ contact_email: v })}
                    testid="primary-contact-email"
                    dir="ltr"
                  />
                </div>
              )}
            </div>

            {/* אנשי קשר נוספים */}
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-text">אנשי קשר נוספים ({contacts.length})</h2>
              <Button size="sm" variant="secondary" onClick={openAddContact} data-testid="contact-add-btn">
                + איש קשר
              </Button>
            </div>
```

Leave everything from the `{contacts.length === 0 ? (` line (currently line 391) through the closing `</section>` (currently line 442) exactly as it is — only the block above it changes. Note the empty-state copy at that unchanged line still reads `"אין עדיין אנשי קשר."` — leave it as-is (it's about the "נוספים" list, and the wording is still accurate in context).

- [ ] **Step 2: Lint the changed file**

```bash
cd "C:\Users\USER\Desktop\Caulde\BaseCrm"
npx oxlint src/pages/ClientPage.jsx
```

Expected: no output (no errors/warnings introduced). If oxlint flags something, fix it before proceeding.

- [ ] **Step 3: Production build**

```bash
cd "C:\Users\USER\Desktop\Caulde\BaseCrm"
npm run build
```

Expected: `✓ built in <time>` with no errors (a pre-existing "chunks are larger than 500kB" warning is expected and unrelated).

- [ ] **Step 4: Manual browser verification (by the user, after deploy)**

This screen requires an authenticated super-admin session (`guyco42@gmail.com`) that the agent does not have credentials for. After deploying (`netlify deploy --prod --dir=dist --no-build`), ask the user to check, on any client's detail page (`/org/:orgId/clients/:clientId`):

1. Open a client that has never been touched by this feature — the "איש הקשר הוא הלקוח עצמו" checkbox is checked, and a read-only summary shows that client's own name/phone/email. No input fields are visible.
2. Uncheck the box — the summary disappears and four empty fields appear (שם / תפקיד / טלפון / אימייל).
3. Fill in a name and phone, click elsewhere to blur — reload the page. The unchecked state and the values you typed are still there.
4. Re-check the box — the fields disappear again and the read-only summary reappears.
5. Uncheck it once more (without retyping anything) — confirm the name/phone you entered in step 3 reappear in the fields (proves values were preserved in the DB, not cleared, while hidden).
6. Confirm the "אנשי קשר נוספים" list below still works exactly as before (add/edit/archive a secondary contact) and is unaffected by any of the above.

- [ ] **Step 5: Mark task complete**

No git commit (this project has no `.git`). Check off this task in your tracking. This completes the plan.
