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
