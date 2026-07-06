# User deletion + active-org count — design

Date: 2026-07-06

## Motivation

Two related gaps in member/org management:

1. The sidebar "→ כל הארגונים" link is shown/hidden based on a raw membership
   count that includes archived orgs. It should reflect only orgs the user is
   *actively connected to*, matching what the dashboard already displays.
2. Admins have a "הסר" (remove-from-org) action on every member, with no
   member/admin distinction and no way to fully delete a user's account. We want
   a single "delete user" action whose behavior and permissions are well-defined.

## Scope

- Fix the sidebar count to consider only active-org memberships.
- Add a server-enforced `delete_user` RPC with context-sensitive behavior.
- Tighten the `memberships_delete` RLS policy.
- Wire the action into the Org Settings members list.
- Add a super-admin user-management section on the Admin page.

Out of scope: bulk deletion, soft-delete/undo for accounts, audit logging,
email notifications.

## Part 1 — Active-org count (Sidebar)

`src/components/Sidebar.jsx` currently counts memberships directly:

```js
supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
```

Change to an inner join on `organizations`, filtering out archived orgs:

```js
supabase
  .from('memberships')
  .select('id, organizations!inner(is_archived)', { count: 'exact', head: true })
  .eq('user_id', user.id)
  .eq('organizations.is_archived', false)
```

`showAllOrgsLink` becomes `count > 1` over active orgs (super-admins still
short-circuit to `true`). This matches `DashboardPage`, which already filters
archived orgs out of the list.

## Part 2 — `delete_user` RPC (server-side rules)

A single `SECURITY DEFINER` function is the source of truth for both behavior
and permissions. The browser never touches `auth.users` directly.

```sql
create or replace function public.delete_user(p_user_id uuid, p_org_id uuid)
returns text                       -- 'removed_from_org' | 'account_deleted'
language plpgsql security definer set search_path = public, auth as $$
declare
  v_target_role   member_role;
  v_target_super  boolean;
  v_total_mships  int;
begin
  -- 1. caller authorization
  if not (public.is_super_admin() or public.is_org_admin(p_org_id)) then
    raise exception 'not authorized';
  end if;

  -- 2. cannot delete yourself (prevents lockout)
  if p_user_id = auth.uid() then
    raise exception 'cannot delete yourself';
  end if;

  -- 3. target must be a member of this org
  select role into v_target_role
  from public.memberships
  where org_id = p_org_id and user_id = p_user_id;
  if v_target_role is null then
    raise exception 'user is not a member of this org';
  end if;

  -- 4. never delete a super-admin through this path
  select is_super_admin into v_target_super
  from public.profiles where id = p_user_id;
  if v_target_super then
    raise exception 'cannot delete a super admin';
  end if;

  -- 5. only a super-admin may act on an admin target (both paths)
  if v_target_role = 'admin' and not public.is_super_admin() then
    raise exception 'only super admin can delete an admin';
  end if;

  -- 6. branch on total membership count (all orgs, incl. archived)
  select count(*) into v_total_mships
  from public.memberships where user_id = p_user_id;

  if v_total_mships > 1 then
    delete from public.memberships
    where org_id = p_org_id and user_id = p_user_id;
    return 'removed_from_org';
  else
    delete from auth.users where id = p_user_id;  -- cascades profile + membership
    return 'account_deleted';
  end if;
end;
$$;

revoke all on function public.delete_user(uuid, uuid) from public, anon;
grant execute on function public.delete_user(uuid, uuid) to authenticated;
```

Notes:
- Counting **all** memberships (step 6) means an account is only deleted when
  this org is genuinely the user's last one anywhere — we never nuke an account
  that still has an archived-org membership.
- Cascade path relies on existing FKs: `profiles.id → auth.users.id ON DELETE
  CASCADE`, `memberships.user_id → profiles.id ON DELETE CASCADE`, and the
  `ON DELETE SET NULL` FKs from migration 006 (`created_by`, `invited_by`,
  `owner_id`). No new FK work required.

## Part 3 — Tighten `memberships_delete` RLS (defense in depth)

Current policy lets any org-admin delete any membership via the REST API,
bypassing the "only super-admin deletes an admin" rule. Even though the UI
routes through the RPC, tighten the direct-delete policy:

```sql
drop policy if exists memberships_delete on public.memberships;
create policy memberships_delete on public.memberships for delete using (
  public.is_super_admin()
  or (public.is_org_admin(org_id) and role = 'member')
);
```

Super-admin → any row. Plain org-admin → only `member` rows. Non-admins → none.

## Part 4 — Org Settings members list

`src/pages/OrgSettingsPage.jsx`:

- Replace `removeMember` with a `deleteUser(member)` handler that calls
  `supabase.rpc('delete_user', { p_user_id: member.user_id, p_org_id: orgId })`
  and reloads. On error, surface the RPC message.
- Confirmation copy adapts to the likely outcome using data already loaded:
  if the member's role is `admin` and caller isn't super-admin, the button
  isn't shown at all; otherwise confirm with a generic "delete user" message.
  (The remove-vs-account-delete decision is made server-side; the confirm text
  states that if this is the user's only org their account will be deleted.)
- Button visibility: shown for `member` rows to any admin; shown for `admin`
  rows only when `isSuperAdmin`. Never shown for the current user (existing
  `m.user_id !== user.id` guard) — super-admins are already filtered from the
  list.
- Keep the existing role `<select>` as-is.

## Part 5 — Admin page user management (super-admin)

`src/pages/AdminPage.jsx`: add a "משתמשים" section below the orgs.

- Load all non-super-admin profiles with their org count, e.g.
  `profiles.select('id, full_name, email, memberships(count)')`, filtered to
  `is_super_admin = false` client-side (super-admins hidden).
- Each row: avatar, name, email, "N ארגונים", and a "מחק חשבון" action.
- On the global list there is no single-org context, so deletion here means
  **full account delete**. Implement via a second small RPC
  `delete_user_account(p_user_id)` guarded by `is_super_admin()` only, which
  does `delete from auth.users where id = p_user_id` after rejecting self and
  super-admin targets. Double-confirm (irreversible), matching the existing
  org hard-delete UX.

```sql
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
```

## Migration

New file `supabase/migration_011_user_deletion.sql`, idempotent:
`delete_user`, `delete_user_account`, and the tightened `memberships_delete`
policy. Applied to the dev project (`atgoyrojmwxmntonbmpd`) for testing before
prod.

## Testing

Use the existing dev test users plus a couple of new ones:

- Member in 2 orgs → org-admin "delete" → `removed_from_org`; account and other
  org survive.
- Member in 1 org → org-admin "delete" → `account_deleted`; row gone from
  `auth.users`, `profiles`, `memberships`.
- Admin target, org-admin caller → rejected ("only super admin…").
- Admin target, super-admin caller → allowed.
- Self target → rejected.
- Super-admin target → rejected.
- Sidebar: user with 1 active + 1 archived org → link hidden (active count = 1).
- REST API direct `delete` of an admin membership by a plain org-admin →
  blocked by RLS.

Verify in the browser (preview server on the worktree) for the two primary
Org Settings flows, and via SQL for the RLS/RPC edge cases.
