# User deletion + active-org count Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the sidebar "all orgs" link to count only active-org memberships, and add a permission-aware "delete user" capability (remove-from-org vs. full account deletion) in Org Settings and the super-admin Admin page.

**Architecture:** All deletion logic and permission checks live in two `SECURITY DEFINER` Postgres RPCs so the browser never touches `auth.users` directly; the React UI just calls them. RLS on `memberships` is tightened as defense in depth. The sidebar count changes to an inner-join query.

**Tech Stack:** React 18 + Vite, `@supabase/supabase-js`, Supabase Postgres (RLS + plpgsql RPCs). No unit-test framework — verification is `npm run lint` (oxlint), SQL via the Supabase MCP against the **dev** project, and the browser preview server.

## Global Constraints

- Dev Supabase project id: `atgoyrojmwxmntonbmpd` (`TheGuysCRM-dev`). Apply/verify all SQL here first. Do NOT touch prod (`iezgyetfwgmlczcrnrvx`).
- All new SQL goes in one idempotent file: `supabase/migration_011_user_deletion.sql`. Every statement must be safe to re-run (`create or replace`, `drop policy if exists ... create policy`).
- RPCs: `security definer`, `set search_path = public, auth`, `revoke` from `public, anon`, `grant execute` to `authenticated`.
- Super-admins are transparent: never listed as deletable, never deletable via either RPC.
- UI copy is Hebrew, RTL, matching existing tone (e.g. confirmations use `window.confirm`). Reuse existing `Button`, `Avatar`, `Modal` components and `data-testid` conventions.
- Membership role enum is `member_role` with values `admin` | `member`.
- The remove-vs-account-delete threshold counts **all** of the target's memberships (including archived orgs).

---

## File map

- `supabase/migration_011_user_deletion.sql` — **create**. `delete_user(uuid,uuid)`, `delete_user_account(uuid)`, tightened `memberships_delete` policy.
- `supabase/schema.sql` — **modify**. Keep the canonical schema in sync (update `memberships_delete`, append the two functions) so a fresh bootstrap matches the migration.
- `src/components/Sidebar.jsx` — **modify** (`~68-83`). Active-org count query.
- `src/pages/OrgSettingsPage.jsx` — **modify**. Replace `removeMember` with `deleteUser` (RPC), adjust button visibility, need `isSuperAdmin`.
- `src/pages/AdminPage.jsx` — **modify**. New "משתמשים" section + `deleteAccount` handler.

---

## Task 1: DB migration — `delete_user`, `delete_user_account`, tightened RLS

**Files:**
- Create: `supabase/migration_011_user_deletion.sql`
- Modify: `supabase/schema.sql` (the `memberships_delete` policy near line 273; append the two functions after the existing helper functions ~line 168)

**Interfaces:**
- Produces:
  - `public.delete_user(p_user_id uuid, p_org_id uuid) returns text` — returns `'removed_from_org'` or `'account_deleted'`. Raises on any authz failure.
  - `public.delete_user_account(p_user_id uuid) returns void` — super-admin-only hard account delete. Raises on authz failure.

- [ ] **Step 1: Write the migration file**

Create `supabase/migration_011_user_deletion.sql`:

```sql
-- ============================================================================
-- מיגרציה 011 — מחיקת משתמשים (הסרה מארגון / מחיקת חשבון) + הקשחת RLS
-- הריצו ב-Supabase → SQL Editor. בטוח להריץ שוב (idempotent).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. delete_user — פעולה מאוחדת מארגון מסוים:
--    יעד בכמה ארגונים → הסרה מהארגון הזה; יעד בארגון יחיד → מחיקת חשבון מלאה.
--    כל בדיקות ההרשאה מתבצעות כאן (מקור אמת יחיד).
-- ----------------------------------------------------------------------------
create or replace function public.delete_user(p_user_id uuid, p_org_id uuid)
returns text
language plpgsql security definer set search_path = public, auth as $$
declare
  v_target_role   member_role;
  v_target_super  boolean;
  v_total_mships  int;
begin
  if not (public.is_super_admin() or public.is_org_admin(p_org_id)) then
    raise exception 'not authorized';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'cannot delete yourself';
  end if;

  select role into v_target_role
  from public.memberships
  where org_id = p_org_id and user_id = p_user_id;
  if v_target_role is null then
    raise exception 'user is not a member of this org';
  end if;

  select is_super_admin into v_target_super
  from public.profiles where id = p_user_id;
  if v_target_super then
    raise exception 'cannot delete a super admin';
  end if;

  if v_target_role = 'admin' and not public.is_super_admin() then
    raise exception 'only super admin can delete an admin';
  end if;

  select count(*) into v_total_mships
  from public.memberships where user_id = p_user_id;

  if v_total_mships > 1 then
    delete from public.memberships
    where org_id = p_org_id and user_id = p_user_id;
    return 'removed_from_org';
  else
    delete from auth.users where id = p_user_id;
    return 'account_deleted';
  end if;
end;
$$;

revoke all on function public.delete_user(uuid, uuid) from public, anon;
grant execute on function public.delete_user(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. delete_user_account — מחיקת חשבון מלאה מהעמוד הגלובלי (סופר-אדמין בלבד)
-- ----------------------------------------------------------------------------
create or replace function public.delete_user_account(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_super_admin() then
    raise exception 'not authorized';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot delete yourself';
  end if;
  if (select is_super_admin from public.profiles where id = p_user_id) then
    raise exception 'cannot delete a super admin';
  end if;
  delete from auth.users where id = p_user_id;
end;
$$;

revoke all on function public.delete_user_account(uuid) from public, anon;
grant execute on function public.delete_user_account(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. הקשחת מדיניות מחיקת חברויות:
--    סופר-אדמין → כל שורה; אדמין-ארגון רגיל → רק שורות של 'member'.
--    (מונע עקיפת הכלל "רק סופר-אדמין מוחק אדמין" דרך ה-REST API הישיר.)
-- ----------------------------------------------------------------------------
drop policy if exists memberships_delete on public.memberships;
create policy memberships_delete on public.memberships for delete using (
  public.is_super_admin()
  or (public.is_org_admin(org_id) and role = 'member')
);
```

- [ ] **Step 2: Apply the migration to the dev project**

Use the Supabase MCP `apply_migration` (or `execute_sql`) with `project_id = atgoyrojmwxmntonbmpd`, name `migration_011_user_deletion`, and the file contents above.
Expected: success, no error.

- [ ] **Step 3: Verify the objects exist**

Run via `execute_sql` (project `atgoyrojmwxmntonbmpd`):

```sql
select proname from pg_proc
where proname in ('delete_user','delete_user_account')
order by proname;
select polname, pg_get_expr(polqual, polrelid) as using_expr
from pg_policy where polname = 'memberships_delete';
```
Expected: both functions listed; `memberships_delete` `using_expr` references `is_super_admin` and `role = 'member'`.

- [ ] **Step 4: Sync `supabase/schema.sql`**

In `supabase/schema.sql`, replace the existing `memberships_delete` policy block (around line 273):

```sql
drop policy if exists memberships_delete on public.memberships;
create policy memberships_delete on public.memberships for delete using (public.is_org_admin(org_id));
```

with:

```sql
drop policy if exists memberships_delete on public.memberships;
create policy memberships_delete on public.memberships for delete using (
  public.is_super_admin()
  or (public.is_org_admin(org_id) and role = 'member')
);
```

Then append both function definitions (identical to the migration's sections 1 and 2, including the `revoke`/`grant` lines) after the `is_org_admin` function block (after ~line 168).

- [ ] **Step 5: Commit**

```bash
git add supabase/migration_011_user_deletion.sql supabase/schema.sql
git commit -m "feat(db): add delete_user/delete_user_account RPCs and tighten memberships_delete RLS"
```

---

## Task 2: Verify RPC permission matrix via SQL

Pure verification against dev data — no code changes. Confirms the security rules before wiring UI. Uses impersonation via `set local role` + `request.jwt.claims` so `auth.uid()` resolves to a chosen user.

**Files:** none (SQL only).

**Interfaces:**
- Consumes: `delete_user`, `delete_user_account` from Task 1.

Existing dev users (from earlier setup):
- `a1a1a1a1-0000-4000-8000-000000000001` — test.oneorg (member of טוניקה only)
- `a2a2a2a2-0000-4000-8000-000000000002` — test.multiorg (member of 2 orgs)
- `b4cf7d2f-264a-45b5-9dd6-a401594f3c87` — super-admin (guyco42)

- [ ] **Step 1: Create disposable fixtures for a clean matrix**

Run via `execute_sql` (project `atgoyrojmwxmntonbmpd`). Creates an org with one admin (caller) and one member + one admin target, plus a multi-org member.

```sql
-- caller admin
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,recovery_token,email_change_token_new,email_change)
values ('00000000-0000-0000-0000-000000000000','c0000000-0000-4000-8000-000000000001','authenticated','authenticated','t.caller@example.dev',extensions.crypt('Test1234!',extensions.gen_salt('bf')),now(),now(),now(),'{"provider":"email","providers":["email"]}','{"full_name":"caller admin"}','','','',''),
       ('00000000-0000-0000-0000-000000000000','c0000000-0000-4000-8000-000000000002','authenticated','authenticated','t.member@example.dev',extensions.crypt('Test1234!',extensions.gen_salt('bf')),now(),now(),now(),'{"provider":"email","providers":["email"]}','{"full_name":"member target"}','','','',''),
       ('00000000-0000-0000-0000-000000000000','c0000000-0000-4000-8000-000000000003','authenticated','authenticated','t.admin@example.dev',extensions.crypt('Test1234!',extensions.gen_salt('bf')),now(),now(),now(),'{"provider":"email","providers":["email"]}','{"full_name":"admin target"}','','','','');
insert into auth.identities (provider_id,user_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values
 ('c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001',jsonb_build_object('sub','c0000000-0000-4000-8000-000000000001','email','t.caller@example.dev','email_verified',true),'email',now(),now(),now()),
 ('c0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000002',jsonb_build_object('sub','c0000000-0000-4000-8000-000000000002','email','t.member@example.dev','email_verified',true),'email',now(),now(),now()),
 ('c0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000003',jsonb_build_object('sub','c0000000-0000-4000-8000-000000000003','email','t.admin@example.dev','email_verified',true),'email',now(),now(),now());
insert into organizations (id,name,slug) values ('c0111111-0000-4000-8000-000000000001','QA Delete Org','qa-delete-org');
insert into memberships (org_id,user_id,role) values
 ('c0111111-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','admin'),
 ('c0111111-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002','member'),
 ('c0111111-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000003','admin');
-- give the member target a 2nd org so removal (not account delete) is exercised
insert into memberships (org_id,user_id,role) values
 ('21bc9fe6-351c-43a3-af35-f29523c9f717','c0000000-0000-4000-8000-000000000002','member');
```

- [ ] **Step 2: Assert an org-admin CAN remove a multi-org member (→ removed_from_org)**

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','c0000000-0000-4000-8000-000000000001','role','authenticated')::text, true);
select public.delete_user('c0000000-0000-4000-8000-000000000002','c0111111-0000-4000-8000-000000000001');
rollback;
```
Expected: returns `removed_from_org`. (Rolled back so fixtures persist for later steps.)

- [ ] **Step 3: Assert an org-admin CANNOT delete an admin target**

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','c0000000-0000-4000-8000-000000000001','role','authenticated')::text, true);
select public.delete_user('c0000000-0000-4000-8000-000000000003','c0111111-0000-4000-8000-000000000001');
rollback;
```
Expected: ERROR `only super admin can delete an admin`.

- [ ] **Step 4: Assert a super-admin CAN delete an admin target**

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','b4cf7d2f-264a-45b5-9dd6-a401594f3c87','role','authenticated')::text, true);
select public.delete_user('c0000000-0000-4000-8000-000000000003','c0111111-0000-4000-8000-000000000001');
rollback;
```
Expected: returns `account_deleted` (admin target is only in QA Delete Org).

- [ ] **Step 5: Assert self-delete and super-admin-target are rejected**

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','c0000000-0000-4000-8000-000000000001','role','authenticated')::text, true);
select public.delete_user('c0000000-0000-4000-8000-000000000001','c0111111-0000-4000-8000-000000000001'); -- self
rollback;
```
Expected: ERROR `cannot delete yourself`.

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','b4cf7d2f-264a-45b5-9dd6-a401594f3c87','role','authenticated')::text, true);
select public.delete_user_account('b4cf7d2f-264a-45b5-9dd6-a401594f3c87');
rollback;
```
Expected: ERROR `cannot delete yourself`.

- [ ] **Step 6: Assert RLS blocks a plain admin deleting an admin membership directly**

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','c0000000-0000-4000-8000-000000000001','role','authenticated')::text, true);
with del as (
  delete from public.memberships
  where org_id='c0111111-0000-4000-8000-000000000001'
    and user_id='c0000000-0000-4000-8000-000000000003' returning 1
)
select count(*) as deleted_rows from del;
rollback;
```
Expected: `deleted_rows = 0` (RLS silently filters the admin row).

- [ ] **Step 7: Clean up fixtures**

```sql
delete from auth.users where id in
 ('c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000003');
delete from organizations where id='c0111111-0000-4000-8000-000000000001';
```
Expected: success. (No commit — this task changes no files.)

---

## Task 3: Sidebar active-org count

**Files:**
- Modify: `src/components/Sidebar.jsx` (the membership-count `useEffect`, ~lines 68-83)

**Interfaces:**
- Consumes: nothing new.
- Produces: no exported change; behavior only.

- [ ] **Step 1: Update the count query to active orgs only**

Replace the effect body that sets `showAllOrgsLink`:

```jsx
    supabase
      .from('memberships')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .then(({ count }) => {
        if (active) setShowAllOrgsLink((count ?? 0) > 1)
      })
```

with an inner-join that excludes archived orgs:

```jsx
    supabase
      .from('memberships')
      .select('id, organizations!inner(is_archived)', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('organizations.is_archived', false)
      .then(({ count }) => {
        if (active) setShowAllOrgsLink((count ?? 0) > 1)
      })
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 3: Verify in the browser**

Ensure the dev preview server is running (worktree, port from `.claude/launch.json`). Log in as `test.multiorg@example.dev` / `Test1234!`, enter an org, and run in `preview_eval`:

```js
!!document.querySelector('[data-testid="sidebar-all-orgs-link"]')
```
Expected: `true` (2 active orgs). Then temporarily archive one of that user's orgs via SQL, reload, and confirm it flips to `false`; un-archive afterward.

- [ ] **Step 4: Commit**

```bash
git add src/components/Sidebar.jsx
git commit -m "fix(sidebar): count only active-org memberships for all-orgs link"
```

---

## Task 4: Org Settings — delete user via RPC

**Files:**
- Modify: `src/pages/OrgSettingsPage.jsx`

**Interfaces:**
- Consumes: `supabase.rpc('delete_user', { p_user_id, p_org_id })` from Task 1; `isSuperAdmin` from `useAuth`.

- [ ] **Step 1: Pull `isSuperAdmin` from auth**

Change:

```jsx
  const { user } = useAuth()
```
to:
```jsx
  const { user, isSuperAdmin } = useAuth()
```

- [ ] **Step 2: Replace `removeMember` with `deleteUser`**

Replace the whole `removeMember` function (lines ~66-76) with:

```jsx
  async function deleteUser(member) {
    const label = member.profiles?.full_name || member.profiles?.email
    if (
      !window.confirm(
        `למחוק את ${label}? אם זה הארגון היחיד של המשתמש — החשבון יימחק לצמיתות. אחרת המשתמש יוסר מהארגון הזה בלבד.`
      )
    )
      return
    try {
      const { data, error } = await supabase.rpc('delete_user', {
        p_user_id: member.user_id,
        p_org_id: orgId,
      })
      if (error) throw error
      // data === 'account_deleted' | 'removed_from_org'
      await load()
    } catch (e) {
      setError(e.message === 'only super admin can delete an admin'
        ? 'רק סופר-אדמין יכול למחוק מנהל/ת.'
        : 'מחיקת המשתמש נכשלה.')
    }
  }
```

- [ ] **Step 3: Update the delete button (visibility + handler)**

Replace the existing remove button block (lines ~151-159):

```jsx
                    {m.user_id !== user.id && (
                      <button
                        onClick={() => removeMember(m)}
                        className="text-sm text-text-dim hover:text-status-red"
                        data-testid={`member-remove-${m.user_id}`}
                      >
                        הסר
                      </button>
                    )}
```

with (admins can delete members; admin-targets only deletable by super-admin):

```jsx
                    {m.user_id !== user.id && (m.role === 'member' || isSuperAdmin) && (
                      <button
                        onClick={() => deleteUser(m)}
                        className="text-sm text-text-dim hover:text-status-red"
                        data-testid={`member-delete-${m.user_id}`}
                      >
                        מחק
                      </button>
                    )}
```

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no new errors (no remaining reference to `removeMember`).

- [ ] **Step 5: Verify in the browser (two primary flows)**

Log in as an org-admin of a test org. In Org Settings:
- Delete a member who belongs to 2 orgs → row disappears; confirm via SQL the account still exists and the other-org membership remains → `removed_from_org` path.
- Delete a member who belongs only to this org → row disappears; confirm via SQL the `auth.users`/`profiles` row is gone → `account_deleted` path.
- Confirm no "מחק" button renders on an admin row when logged in as a non-super org-admin; confirm it DOES render for a super-admin.

Use `preview_snapshot` / `preview_eval` for button presence and `execute_sql` for the DB assertions. Recreate any consumed test users afterward if later tasks need them.

- [ ] **Step 6: Commit**

```bash
git add src/pages/OrgSettingsPage.jsx
git commit -m "feat(org-settings): delete user via delete_user RPC with role-aware permissions"
```

---

## Task 5: Admin page — user management section

**Files:**
- Modify: `src/pages/AdminPage.jsx`

**Interfaces:**
- Consumes: `supabase.rpc('delete_user_account', { p_user_id })` from Task 1.

- [ ] **Step 1: Add users state and loader**

Add state near the other `useState` calls:

```jsx
  const [users, setUsers] = useState([])
```

In the existing `load()` function, after the orgs fetch, also load users (non-super-admin profiles with org count):

```jsx
      const { data: uData, error: uErr } = await supabase
        .from('profiles')
        .select('id, full_name, email, is_super_admin, memberships(count)')
        .order('created_at', { ascending: false })
      if (uErr) throw uErr
      setUsers((uData || []).filter((u) => !u.is_super_admin))
```

- [ ] **Step 2: Add the delete-account handler**

Add near the other handlers:

```jsx
  async function handleDeleteAccount(u) {
    const label = u.full_name || u.email
    if (!window.confirm(`למחוק לצמיתות את החשבון של ${label}? פעולה בלתי הפיכה!`)) return
    if (!window.confirm('אישור אחרון: החשבון וכל החברויות שלו יימחקו לתמיד. להמשיך?')) return
    try {
      const { error } = await supabase.rpc('delete_user_account', { p_user_id: u.id })
      if (error) throw error
      await load()
    } catch {
      setError('מחיקת החשבון נכשלה.')
    }
  }
```

- [ ] **Step 3: Render the users section**

Add a new `<section>` after the archived-orgs `<section>` (before the create-org `<Modal>`, ~line 236):

```jsx
      <section className="mt-8" data-testid="admin-users-section">
        <h2 className="mb-2 text-sm font-semibold text-text-muted">
          משתמשים ({users.length})
        </h2>
        <div className="overflow-hidden rounded-lg border border-border">
          {users.map((u) => (
            <div
              key={u.id}
              className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 last:border-b-0"
              data-testid={`admin-user-row-${u.id}`}
            >
              <div className="flex items-center gap-3">
                <Avatar name={u.full_name} email={u.email} />
                <div>
                  <div className="text-text">{u.full_name || u.email}</div>
                  <div className="text-xs text-text-dim">{u.email}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-text-dim">
                  {u.memberships?.[0]?.count ?? 0} ארגונים
                </span>
                <button
                  onClick={() => handleDeleteAccount(u)}
                  className="text-sm text-text-dim hover:text-status-red"
                  data-testid={`admin-user-delete-${u.id}`}
                >
                  מחק חשבון
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
```

- [ ] **Step 4: Import `Avatar`**

Add to the imports at the top:

```jsx
import Avatar from '../components/ui/Avatar'
```

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 6: Verify in the browser**

Log in as the super-admin (`guyco42@gmail.com`). Go to `/admin`. Confirm the "משתמשים" section lists real users with org counts and no super-admin appears. Delete a disposable test account and confirm via `execute_sql` that its `auth.users` row is gone.

- [ ] **Step 7: Commit**

```bash
git add src/pages/AdminPage.jsx
git commit -m "feat(admin): super-admin user list with account deletion"
```

---

## Task 6: Final lint + cleanup

**Files:** none (verification/cleanup).

- [ ] **Step 1: Full lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 2: Remove leftover QA users**

Confirm no `c0000000-*` / `qa-delete-org` fixtures remain (Task 2 step 7). Decide with the user whether to keep or delete the `test.oneorg` / `test.multiorg` accounts.

- [ ] **Step 3: Confirm migration is ready for prod**

The dev project already has `migration_011` applied. Note in the final report that the same file must be run against prod (`iezgyetfwgmlczcrnrvx`) at release time — do NOT apply it to prod as part of this work.

---

## Self-review notes

- Spec coverage: Part 1 → Task 3; Part 2 (`delete_user`) → Task 1 + Task 4 + Task 2 verification; Part 3 (RLS) → Task 1 + Task 2 step 6; Part 4 (org settings) → Task 4; Part 5 (admin page + `delete_user_account`) → Task 1 + Task 5. All covered.
- Naming consistency: RPC `delete_user(p_user_id, p_org_id)` returns `text`; `delete_user_account(p_user_id)` returns `void`. `data-testid`s: `member-delete-*` (replaces `member-remove-*`), `admin-user-row-*`, `admin-user-delete-*`, `admin-users-section`.
- The `memberships_delete` policy expression is identical in the migration and in `schema.sql`.
