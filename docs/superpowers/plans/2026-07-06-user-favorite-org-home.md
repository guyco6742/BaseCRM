# User-level favorite org home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each user favorite a board or the Clients page per org; visiting `/org/:orgId` then auto-redirects straight there instead of showing the workspaces list, via a ⭐ toggle on the board/clients page header.

**Architecture:** A new `user_favorites` table (one row per user+org, RLS-scoped to the owner) is the single source of truth. `OrgContext` loads it alongside `org`/`role` and exposes `favorite` + `setFavorite()`. A new `OrgHomePage` component replaces the org's `index` route: it reads `favorite` from context and either `<Navigate>`s to the board/clients URL or falls back to the existing `WorkspacesPage`. A shared `FavoriteStarButton` component (used on `BoardPage` and `ClientsPage`) writes to the table via `setFavorite`.

**Tech Stack:** React 19 + Vite, `@supabase/supabase-js`, React Router 7, Supabase Postgres (RLS). No unit-test framework in this repo — verification is `npm run lint` (oxlint), SQL via the Supabase MCP against the **dev** project, and the browser preview server.

## Global Constraints

- Dev Supabase project id: `atgoyrojmwxmntonbmpd`. Apply/verify all SQL here first. Do NOT touch prod (`iezgyetfwgmlczcrnrvx`).
- New SQL goes in one idempotent file: `supabase/migration_013_user_favorites.sql` (`create table if not exists`, `drop policy if exists ... create policy`, safe to re-run).
- Do not modify `supabase/schema.sql` — it only ever tracks the Stage 0/1 bootstrap tables (`profiles`/`organizations`/`memberships`/`invitations`/`workspaces`/`boards`/`columns`/`groups`/`items`); CRM/leads/features tables added by migrations 004-010 were never synced there either, so a new feature table follows that same precedent.
- Reuse the existing `public.is_org_member(p_org_id uuid)` RLS helper (defined in `supabase/schema.sql:151`) — do not write a new membership check.
- One favorite per user per org — enforced by the table's primary key `(user_id, org_id)`, so "set favorite" is always a plain upsert.
- UI copy is Hebrew, RTL, matching existing tone. Reuse existing `data-testid` conventions (kebab-case, page-scoped prefixes like `board-*`, `clients-*`).
- Favorited-but-archived boards are never deleted from the table; the redirect logic just ignores them and falls back to the workspaces list.

---

## File map

- `supabase/migration_013_user_favorites.sql` — **create**. `user_favorites` table + RLS policies.
- `src/context/OrgContext.jsx` — **modify**. Load `favorite`, expose `setFavorite`.
- `src/pages/OrgHomePage.jsx` — **create**. Replaces `WorkspacesPage` as the org `index` route element; redirects or falls back.
- `src/App.jsx` — **modify**. Swap the `index` route element, add `WorkspacesPage`'s import is still needed by `OrgHomePage`, not `App.jsx`.
- `src/components/FavoriteStarButton.jsx` — **create**. Shared ⭐ toggle.
- `src/pages/BoardPage.jsx` — **modify**. Render `FavoriteStarButton` next to the board title.
- `src/pages/ClientsPage.jsx` — **modify**. Render `FavoriteStarButton` next to the page title.

---

## Task 1: DB migration — `user_favorites` table + RLS

**Files:**
- Create: `supabase/migration_013_user_favorites.sql`

**Interfaces:**
- Produces: table `public.user_favorites(user_id uuid, org_id uuid, favorite_type text, board_id uuid, created_at timestamptz)`, primary key `(user_id, org_id)`.

- [ ] **Step 1: Write the migration file**

Create `supabase/migration_013_user_favorites.sql`:

```sql
-- ============================================================================
-- מיגרציה 013 — מועדפים אישיים למשתמש: בורד/עמוד לקוחות כ"דף בית" לארגון
-- הריצו ב-Supabase → SQL Editor. בטוח להריץ שוב (idempotent).
-- ============================================================================

create table if not exists public.user_favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  favorite_type text not null check (favorite_type in ('board', 'clients')),
  board_id uuid references public.boards(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, org_id),
  constraint user_favorites_board_id_check check (
    (favorite_type = 'board' and board_id is not null)
    or (favorite_type = 'clients' and board_id is null)
  )
);

alter table public.user_favorites enable row level security;

drop policy if exists user_favorites_select on public.user_favorites;
create policy user_favorites_select on public.user_favorites for select using (
  user_id = auth.uid()
);

drop policy if exists user_favorites_insert on public.user_favorites;
create policy user_favorites_insert on public.user_favorites for insert with check (
  user_id = auth.uid() and public.is_org_member(org_id)
);

drop policy if exists user_favorites_update on public.user_favorites;
create policy user_favorites_update on public.user_favorites for update using (
  user_id = auth.uid()
) with check (
  user_id = auth.uid() and public.is_org_member(org_id)
);

drop policy if exists user_favorites_delete on public.user_favorites;
create policy user_favorites_delete on public.user_favorites for delete using (
  user_id = auth.uid()
);
```

- [ ] **Step 2: Apply the migration to the dev project**

Use the Supabase MCP `apply_migration` with `project_id = atgoyrojmwxmntonbmpd`, name `migration_013_user_favorites`, and the file contents above.
Expected: success, no error.

- [ ] **Step 3: Verify the table and policies exist**

Run via `execute_sql` (project `atgoyrojmwxmntonbmpd`):

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'user_favorites'
order by ordinal_position;

select polname, cmd from pg_policy
where polrelid = 'public.user_favorites'::regclass
order by polname;
```
Expected: columns `user_id, org_id, favorite_type, board_id, created_at`; four policies (`user_favorites_select/insert/update/delete`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migration_013_user_favorites.sql
git commit -m "feat(db): add user_favorites table for per-user org home"
```

---

## Task 2: Verify RLS via SQL impersonation

Pure verification against dev data — no code changes. Confirms a user can only touch their own favorite row, and only for orgs they belong to, before wiring the UI.

**Files:** none (SQL only).

**Interfaces:**
- Consumes: `public.user_favorites` from Task 1.

Existing dev users (from earlier setup, same as `docs/superpowers/plans/2026-07-06-user-deletion-and-org-count.md`):
- `a1a1a1a1-0000-4000-8000-000000000001` — test.oneorg (member of טוניקה only)
- `a2a2a2a2-0000-4000-8000-000000000002` — test.multiorg (member of 2 orgs)

- [ ] **Step 1: Find a board id in an org test.oneorg belongs to**

```sql
select b.id as board_id, b.org_id
from public.boards b
join public.memberships m on m.org_id = b.org_id
where m.user_id = 'a1a1a1a1-0000-4000-8000-000000000001' and b.is_archived = false
limit 1;
```
Note the returned `board_id`/`org_id` for use below (call them `<board_id>` / `<org_id>`).

- [ ] **Step 2: Assert a member CAN upsert their own favorite for their own org**

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','a1a1a1a1-0000-4000-8000-000000000001','role','authenticated')::text, true);
insert into public.user_favorites (user_id, org_id, favorite_type, board_id)
values ('a1a1a1a1-0000-4000-8000-000000000001', '<org_id>', 'board', '<board_id>')
on conflict (user_id, org_id) do update set favorite_type = excluded.favorite_type, board_id = excluded.board_id;
select * from public.user_favorites where user_id = 'a1a1a1a1-0000-4000-8000-000000000001';
rollback;
```
Expected: insert succeeds; the select returns the one row. (Rolled back — no lasting effect.)

- [ ] **Step 3: Assert a user CANNOT insert a favorite for an org they don't belong to**

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','a1a1a1a1-0000-4000-8000-000000000001','role','authenticated')::text, true);
insert into public.user_favorites (user_id, org_id, favorite_type)
values ('a1a1a1a1-0000-4000-8000-000000000001', gen_random_uuid(), 'clients');
rollback;
```
Expected: ERROR — RLS policy violation on `user_favorites_insert` (random org id fails `is_org_member`).

- [ ] **Step 4: Assert a user CANNOT read another user's favorite row**

```sql
begin;
set local role authenticated;
-- as test.multiorg, seed a favorite for test.oneorg's org bypassing RLS via a security-definer-free direct insert as postgres would not reflect real usage,
-- so instead: as test.oneorg insert their own row, then switch identity and confirm test.multiorg sees zero rows for that user_id.
select set_config('request.jwt.claims', json_build_object('sub','a1a1a1a1-0000-4000-8000-000000000001','role','authenticated')::text, true);
insert into public.user_favorites (user_id, org_id, favorite_type, board_id)
values ('a1a1a1a1-0000-4000-8000-000000000001', '<org_id>', 'board', '<board_id>')
on conflict (user_id, org_id) do update set favorite_type = excluded.favorite_type, board_id = excluded.board_id;

select set_config('request.jwt.claims', json_build_object('sub','a2a2a2a2-0000-4000-8000-000000000002','role','authenticated')::text, true);
select count(*) as visible_rows from public.user_favorites where user_id = 'a1a1a1a1-0000-4000-8000-000000000001';
rollback;
```
Expected: `visible_rows = 0`.

- [ ] **Step 5: Assert the check constraint rejects a mismatched type/board_id pair**

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','a1a1a1a1-0000-4000-8000-000000000001','role','authenticated')::text, true);
insert into public.user_favorites (user_id, org_id, favorite_type, board_id)
values ('a1a1a1a1-0000-4000-8000-000000000001', '<org_id>', 'clients', '<board_id>');
rollback;
```
Expected: ERROR — violates check constraint `user_favorites_board_id_check` (`clients` type must have `board_id is null`).

No cleanup needed — every step rolls back.

---

## Task 3: `OrgContext` — load and expose `favorite`

**Files:**
- Modify: `src/context/OrgContext.jsx`

**Interfaces:**
- Produces: `useOrg()` now also returns `favorite: null | { type: 'board', boardId: string } | { type: 'clients' }` and `setFavorite(next)` where `next` is `null` or one of those two shapes.
- Consumes: `orgId`, `user.id` (already in scope in this file).

- [ ] **Step 1: Add favorite state and a loader function**

In `src/context/OrgContext.jsx`, add a new state next to `structureVersion` (after line 15):

```jsx
  const [favorite, setFavoriteState] = useState(null)
```

Add a loader function next to `refreshOrg` (after the `refreshOrg` definition, ~line 26):

```jsx
  // טוען את המועדף האישי של המשתמש לארגון הזה (בורד או עמוד לקוחות), אם קיים ותקף
  const loadFavorite = useCallback(async () => {
    const { data } = await supabase
      .from('user_favorites')
      .select('favorite_type, board_id, boards(is_archived)')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!data) {
      setFavoriteState(null)
      return
    }
    if (data.favorite_type === 'clients') {
      setFavoriteState({ type: 'clients' })
      return
    }
    if (data.favorite_type === 'board' && data.boards && !data.boards.is_archived) {
      setFavoriteState({ type: 'board', boardId: data.board_id })
      return
    }
    setFavoriteState(null)
  }, [orgId, user.id])
```

- [ ] **Step 2: Call `loadFavorite` when the org loads**

In the existing `useEffect` that loads `org`/`role` (the one with `load()` inside), after `setRole(...)` succeeds, call it. Find:

```jsx
        if (!active) return
        setOrg(orgData)
        setRole(membership?.role ?? (isSuperAdmin ? 'admin' : null))
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [orgId, user.id, isSuperAdmin])
```

Replace with:

```jsx
        if (!active) return
        setOrg(orgData)
        setRole(membership?.role ?? (isSuperAdmin ? 'admin' : null))
        await loadFavorite()
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [orgId, user.id, isSuperAdmin, loadFavorite])
```

- [ ] **Step 3: Add `setFavorite` (upsert/delete) and expose both on context**

Add next to `loadFavorite`:

```jsx
  // next = null (מבטל), { type: 'clients' }, או { type: 'board', boardId }
  const setFavorite = useCallback(
    async (next) => {
      if (next === null) {
        await supabase.from('user_favorites').delete().eq('org_id', orgId).eq('user_id', user.id)
        setFavoriteState(null)
        return
      }
      const row = {
        user_id: user.id,
        org_id: orgId,
        favorite_type: next.type,
        board_id: next.type === 'board' ? next.boardId : null,
      }
      const { error } = await supabase.from('user_favorites').upsert(row, { onConflict: 'user_id,org_id' })
      if (!error) setFavoriteState(next)
    },
    [orgId, user.id]
  )
```

Update the `value` object at the bottom of the provider:

```jsx
  const value = {
    orgId,
    org,
    role,
    isAdmin: role === 'admin' || isSuperAdmin,
    loading,
    notFound,
    structureVersion,
    refreshStructure,
    refreshOrg,
    favorite,
    setFavorite,
  }
```

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/context/OrgContext.jsx
git commit -m "feat(org-context): load and expose per-user org favorite"
```

---

## Task 4: `OrgHomePage` + route wiring

**Files:**
- Create: `src/pages/OrgHomePage.jsx`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `useOrg()` → `orgId, favorite, loading` from Task 3.
- Produces: default export `OrgHomePage` (no props), used as the org `index` route element.

- [ ] **Step 1: Create `OrgHomePage.jsx`**

```jsx
import { Navigate } from 'react-router-dom'
import { useOrg } from '../context/OrgContext'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import WorkspacesPage from './WorkspacesPage'

export default function OrgHomePage() {
  const { orgId, favorite, loading } = useOrg()

  if (loading) {
    return <LoadingSpinner label="טוען..." />
  }
  if (favorite?.type === 'board') {
    return <Navigate to={`/org/${orgId}/board/${favorite.boardId}`} replace />
  }
  if (favorite?.type === 'clients') {
    return <Navigate to={`/org/${orgId}/clients`} replace />
  }
  return <WorkspacesPage />
}
```

- [ ] **Step 2: Wire it into the org index route**

In `src/App.jsx`, change the import:

```jsx
import WorkspacesPage from './pages/WorkspacesPage'
```
to:
```jsx
import OrgHomePage from './pages/OrgHomePage'
```

And change the route:

```jsx
          <Route index element={<WorkspacesPage />} />
```
to:
```jsx
          <Route index element={<OrgHomePage />} />
```

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no new errors (no leftover unused `WorkspacesPage` import in `App.jsx`).

- [ ] **Step 4: Verify in the browser — no favorite set (fallback)**

Ensure the dev preview server is running (worktree, port from `.claude/launch.json`). Log in, open any org you have no favorite for, and confirm the workspaces list still renders at `/org/:orgId`:

```js
!!document.querySelector('[data-testid="workspace-new-btn"]')
```
Expected: `true` (the "+ וורקספייס חדש" button from `WorkspacesPage` is present), and the URL stays `/org/:orgId`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/OrgHomePage.jsx src/App.jsx
git commit -m "feat(routing): org index redirects to the user's favorite when set"
```

---

## Task 5: `FavoriteStarButton` component

**Files:**
- Create: `src/components/FavoriteStarButton.jsx`

**Interfaces:**
- Consumes: `useOrg()` → `favorite, setFavorite` from Task 3.
- Produces: default export `FavoriteStarButton({ type, boardId })` where `type` is `'board' | 'clients'` and `boardId` is required when `type === 'board'`.

- [ ] **Step 1: Create the component**

```jsx
import { useOrg } from '../context/OrgContext'

export default function FavoriteStarButton({ type, boardId }) {
  const { favorite, setFavorite } = useOrg()

  const isActive =
    type === 'clients'
      ? favorite?.type === 'clients'
      : favorite?.type === 'board' && favorite.boardId === boardId

  function toggle() {
    setFavorite(isActive ? null : type === 'board' ? { type: 'board', boardId } : { type: 'clients' })
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={isActive ? 'הסר מדף הבית של הארגון' : 'הגדר כדף הבית של הארגון'}
      data-testid="favorite-star"
      className={`text-xl leading-none transition-colors ${
        isActive ? 'text-yellow-400' : 'text-text-dim hover:text-yellow-400'
      }`}
    >
      {isActive ? '★' : '☆'}
    </button>
  )
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/FavoriteStarButton.jsx
git commit -m "feat(favorites): add FavoriteStarButton component"
```

---

## Task 6: Wire the star button into `BoardPage`

**Files:**
- Modify: `src/pages/BoardPage.jsx`

**Interfaces:**
- Consumes: `FavoriteStarButton` from Task 5.

- [ ] **Step 1: Import the component**

Add near the other component imports (after `import { exportRowsToCSV, downloadCSV } from '../lib/csv'`):

```jsx
import FavoriteStarButton from '../components/FavoriteStarButton'
```

- [ ] **Step 2: Render it next to the board title**

Find:

```jsx
          <h1 className="text-2xl font-bold text-text" data-testid="board-title">{board?.name}</h1>
```

Replace with:

```jsx
          <h1 className="text-2xl font-bold text-text" data-testid="board-title">{board?.name}</h1>
          <FavoriteStarButton type="board" boardId={boardId} />
```

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 4: Verify in the browser**

With the preview server running, open a board and click the star:

```js
document.querySelector('[data-testid="favorite-star"]').click()
```
Expected: star turns filled (★, yellow). Reload the page — still filled (persisted). Navigate to `/org/:orgId` (e.g. via `preview_eval` `location.href = ...` or clicking the org name) — expect an immediate redirect to this board's URL. Click the star again to unset it, confirm it reverts to outline (☆), and confirm `/org/:orgId` now shows the workspaces list again.

- [ ] **Step 5: Commit**

```bash
git add src/pages/BoardPage.jsx
git commit -m "feat(board): add favorite-star toggle to set this board as org home"
```

---

## Task 7: Wire the star button into `ClientsPage`

**Files:**
- Modify: `src/pages/ClientsPage.jsx`

**Interfaces:**
- Consumes: `FavoriteStarButton` from Task 5.

- [ ] **Step 1: Import the component**

Add near the other imports (after `import { exportRowsToCSV, downloadCSV } from '../lib/csv'`):

```jsx
import FavoriteStarButton from '../components/FavoriteStarButton'
```

- [ ] **Step 2: Render it next to the page title**

Find:

```jsx
        <h1 className="text-2xl font-bold text-text">לקוחות</h1>
```

Replace with:

```jsx
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-text">לקוחות</h1>
          <FavoriteStarButton type="clients" />
        </div>
```

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 4: Verify in the browser**

With the preview server running, open the Clients page for an org and click the star. Expect the same behavior as Task 6: it fills in, persists across reload, and visiting `/org/:orgId` redirects straight to `/org/:orgId/clients`. Unset it and confirm the workspaces list returns.

Also confirm setting a board favorite (Task 6) and then setting the Clients favorite replaces it (only one favorite survives — check via `execute_sql`: `select count(*) from user_favorites where user_id = '<your uid>' and org_id = '<org id>'` should be `1`).

- [ ] **Step 5: Commit**

```bash
git add src/pages/ClientsPage.jsx
git commit -m "feat(clients): add favorite-star toggle to set clients page as org home"
```

---

## Task 8: Final verification + prod note

**Files:** none (verification only).

- [ ] **Step 1: Full lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: succeeds with no errors.

- [ ] **Step 3: End-to-end browser pass**

With two different logged-in sessions (or by switching users), confirm:
- User A favorites Board X in Org 1; User B (also a member of Org 1) has no favorite. Both visit `/org/1` — A redirects to Board X, B sees the workspaces list.
- Archiving Board X (as an admin) then visiting `/org/1` as User A falls back to the workspaces list; un-archiving restores the redirect.

- [ ] **Step 4: Note prod migration**

The dev project already has `migration_013_user_favorites` applied. Record in the final report that the same file must be run against prod (`iezgyetfwgmlczcrnrvx`) at release time — do NOT apply it to prod as part of this work.

---

## Self-review notes

- Spec coverage: data model → Task 1; RLS behavior → Task 1 + Task 2; `OrgContext` favorite state → Task 3; redirect → Task 4; star button component → Task 5; wiring on `BoardPage`/`ClientsPage` → Task 6/7; archived-board fallback → Task 3 (`loadFavorite`) + Task 8 step 3; multi-user independence → Task 8 step 3. All spec sections covered.
- Naming consistency: `favorite` shape `{ type: 'board', boardId }` / `{ type: 'clients' }` / `null` used identically in `OrgContext.jsx`, `OrgHomePage.jsx`, and `FavoriteStarButton.jsx`. `setFavorite(next)` signature matches across Task 3 (definition) and Tasks 5-7 (usage).
- No placeholders: every step has literal code, exact file paths, and concrete SQL/lint/build commands with expected output.
