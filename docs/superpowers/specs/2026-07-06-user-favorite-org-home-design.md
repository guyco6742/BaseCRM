# User-level favorite org home — design

Date: 2026-07-06

## Motivation

Visiting an org today always lands on the workspaces list
(`/org/:orgId` → `WorkspacesPage`). Users who live in one board (or the
Clients page) want to skip that list and land directly on their board every
time they open the org. This should be a per-user, per-org preference, not an
org-wide setting — different members of the same org can favorite different
boards.

## Scope

- New per-user, per-org "favorite" pointing at either a board or the Clients
  page.
- Visiting the org's index route auto-redirects to the favorite when one is
  set; otherwise behaves exactly as today (shows `WorkspacesPage`).
- A ⭐ toggle in the header of `BoardPage` and `ClientsPage` to set/unset the
  favorite.
- Stored server-side (not localStorage) so it follows the user across
  devices.

Out of scope: favoriting workspaces or arbitrary other pages, starring
multiple boards for a sidebar "favorites" shortcut list, org-wide default
landing pages (admin-set), any change to the global `/` dashboard.

## Data model

New table, migration `supabase/migration_013_user_favorites.sql`:

```sql
create table public.user_favorites (
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

create policy user_favorites_select on public.user_favorites for select using (
  user_id = auth.uid()
);
create policy user_favorites_insert on public.user_favorites for insert with check (
  user_id = auth.uid() and public.is_org_member(org_id)
);
create policy user_favorites_update on public.user_favorites for update using (
  user_id = auth.uid()
) with check (
  user_id = auth.uid() and public.is_org_member(org_id)
);
create policy user_favorites_delete on public.user_favorites for delete using (
  user_id = auth.uid()
);
```

Notes:

- Primary key `(user_id, org_id)` means "set favorite" is a plain upsert —
  there is never more than one favorite per user per org, so no separate
  "clear the old one" step is needed.
- This table stores a personal UI preference, not org content, so the
  project's "no physical deletes" rule does not apply here — real `delete`s
  are fine (toggling a favorite off, cascade on account/org/board deletion).
- If a favorited board is later archived, we do **not** delete the row.
  The redirect logic (below) treats an archived board as "no usable
  favorite" and falls back to the workspaces list. If the board is restored,
  the favorite silently starts working again.

## Where the state lives

`OrgContext` (`src/context/OrgContext.jsx`) already loads org + role scoped by
`orgId` + `user.id`, so it's the natural home for this too:

- New state `favorite`: `null | { type: 'board', boardId: string } | { type: 'clients' }`.
- Loaded in the same effect that loads `org`/`role`, via:
  ```js
  supabase
    .from('user_favorites')
    .select('favorite_type, board_id, boards(is_archived)')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle()
  ```
  A row is only kept as the active favorite if `favorite_type = 'clients'`,
  or `favorite_type = 'board'` and `boards.is_archived === false`.
- New `setFavorite(next)` function exposed on the context:
  - `next = { type: 'board', boardId }` or `{ type: 'clients' }` → upsert.
  - `next = null` → delete the row for `(user_id, org_id)`.
  - Updates local `favorite` state optimistically, same pattern as
    `refreshOrg`/`refreshStructure`.

Both the star buttons and the redirect read/write through this single
context value, so there's one fetch per org visit, not one per page.

## Redirect

`src/App.jsx` currently has:

```jsx
<Route path="/org/:orgId" element={<OrgLayout />}>
  <Route index element={<WorkspacesPage />} />
  ...
```

Replace the index element with a new `src/pages/OrgHomePage.jsx`:

```jsx
export default function OrgHomePage() {
  const { orgId, favorite, loading } = useOrg()
  if (loading) return <LoadingSpinner label="טוען..." />
  if (favorite?.type === 'board') return <Navigate to={`/org/${orgId}/board/${favorite.boardId}`} replace />
  if (favorite?.type === 'clients') return <Navigate to={`/org/${orgId}/clients`} replace />
  return <WorkspacesPage />
}
```

The sidebar's workspace/board links are unchanged, so the workspaces list is
still reachable at any time by clicking a workspace in the sidebar — only the
bare `/org/:orgId` URL's behavior changes.

## Setting the favorite (star button)

New shared component `src/components/FavoriteStarButton.jsx`:

- Props: `type` (`'board' | 'clients'`), `boardId` (required when
  `type === 'board'`).
- Reads `favorite` from `useOrg()` to compute `isActive` (deep-equal on
  type + boardId).
- On click: calls `setFavorite(isActive ? null : { type, boardId })`.
- Renders a filled ⭐ when active, outline ☆ otherwise; title text "הגדר כדף
  הבית של הארגון" / "הסר מדף הבית" (Hebrew tooltips matching existing UI
  copy conventions); `data-testid="favorite-star"`.

Wired in:

- `BoardPage.jsx` — next to the board name in the header, `<FavoriteStarButton type="board" boardId={boardId} />`.
- `ClientsPage.jsx` — next to the page title/export button, `<FavoriteStarButton type="clients" />`.

## Testing

- Set favorite on a board → revisit `/org/:orgId` → redirected straight to
  that board.
- Set favorite on Clients → revisit `/org/:orgId` → redirected to
  `/org/:orgId/clients`.
- Unset favorite (click active star again) → `/org/:orgId` shows the
  workspaces list again.
- Two different users in the same org can have different favorites
  simultaneously (or none) without affecting each other.
- Archive the favorited board → `/org/:orgId` falls back to the workspaces
  list (favorite row still present in DB); un-archive it → redirect resumes.
- RLS: user A cannot read/set/delete user B's favorite row (direct REST call
  blocked).
- Non-member of an org cannot insert a favorite row for that org (`is_org_member` check fails).

Verify in the browser (preview server on the worktree) for the redirect and
star-toggle flows; verify RLS edge cases via SQL/REST.
