-- ============================================================================
-- BaseCRM — Schema + Row Level Security (RLS)
-- להרצה ב-Supabase → SQL Editor (הדביקו הכל והריצו פעם אחת).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ENUM types
-- ----------------------------------------------------------------------------
do $$ begin
  create type member_role as enum ('admin', 'member');
exception when duplicate_object then null; end $$;

do $$ begin
  create type invite_status as enum ('pending', 'accepted');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 2. Tables
-- ----------------------------------------------------------------------------

-- פרופיל משתמש (מקושר 1:1 ל-auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  is_super_admin boolean not null default false,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- ארגונים (כל ארגון = חברה נפרדת)
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  logo_url text,
  is_archived boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- חברות משתמש בארגון + תפקיד
create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role member_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

-- הזמנות במייל
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role member_role not null default 'member',
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  status invite_status not null default 'pending',
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- וורקספייסים (מחלקות בתוך הארגון)
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  color text default '#0073ea',
  position double precision not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- בורדים
create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  position double precision not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- עמודות מותאמות (שדות) לכל בורד
create table if not exists public.columns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  name text not null,
  type text not null,               -- text | long_text | status | number | date | checkbox | person | dropdown | link | email | phone | files | created_at
  settings jsonb not null default '{}'::jsonb,
  position double precision not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- קבוצות בתוך בורד
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  name text not null,
  color text default '#579bfc',
  position double precision not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- פריטים (שורות)
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null default '',
  values jsonb not null default '{}'::jsonb,   -- { column_id: value }
  position double precision not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- אינדקסים לשליפות נפוצות
create index if not exists idx_memberships_user on public.memberships(user_id);
create index if not exists idx_memberships_org on public.memberships(org_id);
create index if not exists idx_workspaces_org on public.workspaces(org_id);
create index if not exists idx_boards_workspace on public.boards(workspace_id);
create index if not exists idx_columns_board on public.columns(board_id);
create index if not exists idx_groups_board on public.groups(board_id);
create index if not exists idx_items_board on public.items(board_id);
create index if not exists idx_items_group on public.items(group_id);

-- ----------------------------------------------------------------------------
-- 3. Helper functions (SECURITY DEFINER — עוקפות RLS כדי למנוע רקורסיה)
-- ----------------------------------------------------------------------------

create or replace function public.is_super_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select is_super_admin from public.profiles where id = auth.uid()),
    false
  );
$$;

create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships
    where org_id = p_org_id and user_id = auth.uid()
  ) or public.is_super_admin();
$$;

create or replace function public.is_org_admin(p_org_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships
    where org_id = p_org_id and user_id = auth.uid() and role = 'admin'
  ) or public.is_super_admin();
$$;

-- ----------------------------------------------------------------------------
-- 4. Trigger — יצירת profile אוטומטית בהרשמת משתמש חדש
-- ----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- קריאת הזמנה לפי טוקן — מאפשר למוזמן שעוד לא נרשם/התחבר לקרוא את פרטי ההזמנה
-- לפי הטוקן הסודי בלבד, בלי לחשוף הזמנות אחרות (עוקף RLS בבטחה).
create or replace function public.get_invitation_by_token(p_token text)
returns table (id uuid, org_id uuid, email text, role member_role, status invite_status, org_name text)
language sql stable security definer set search_path = public as $$
  select i.id, i.org_id, i.email, i.role, i.status, o.name
  from public.invitations i
  join public.organizations o on o.id = i.org_id
  where i.token = p_token;
$$;

grant execute on function public.get_invitation_by_token(text) to anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 5. Enable RLS
-- ----------------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships   enable row level security;
alter table public.invitations   enable row level security;
alter table public.workspaces    enable row level security;
alter table public.boards        enable row level security;
alter table public.columns       enable row level security;
alter table public.groups        enable row level security;
alter table public.items         enable row level security;

-- ----------------------------------------------------------------------------
-- 6. Policies
-- ----------------------------------------------------------------------------

-- profiles: כל משתמש רואה את הפרופיל שלו; אפשר לראות פרופילים של חברי אותו ארגון;
-- סופר-אדמין רואה הכל. עדכון — רק של עצמך.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (
  id = auth.uid()
  or public.is_super_admin()
  or exists (
    select 1 from public.memberships m1
    join public.memberships m2 on m1.org_id = m2.org_id
    where m1.user_id = auth.uid() and m2.user_id = profiles.id
  )
);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update using (id = auth.uid());
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert with check (id = auth.uid());

-- organizations: חברים רואים את הארגונים שלהם; יצירה/עדכון/מחיקה — רק סופר-אדמין.
drop policy if exists orgs_select on public.organizations;
create policy orgs_select on public.organizations for select using (
  public.is_org_member(id)
);
drop policy if exists orgs_insert on public.organizations;
create policy orgs_insert on public.organizations for insert with check (public.is_super_admin());
drop policy if exists orgs_update on public.organizations;
create policy orgs_update on public.organizations for update using (public.is_super_admin());
drop policy if exists orgs_delete on public.organizations;
create policy orgs_delete on public.organizations for delete using (public.is_super_admin());

-- memberships: חברי הארגון רואים; ניהול — אדמין ארגון או סופר-אדמין.
-- הערה: המשתמש חייב לראות את החברות של עצמו (בשביל is_org_member וטעינת הארגונים).
drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships for select using (
  user_id = auth.uid() or public.is_org_admin(org_id)
);
drop policy if exists memberships_insert on public.memberships;
create policy memberships_insert on public.memberships for insert with check (
  public.is_org_admin(org_id)
  -- מאפשר גם למוזמן ליצור לעצמו חברות בעת קבלת הזמנה תקפה
  or exists (
    select 1 from public.invitations i
    join public.profiles p on p.id = auth.uid()
    where i.org_id = memberships.org_id
      and i.status = 'pending'
      and lower(i.email) = lower(p.email)
      and memberships.user_id = auth.uid()
  )
);
drop policy if exists memberships_update on public.memberships;
create policy memberships_update on public.memberships for update using (public.is_org_admin(org_id));
drop policy if exists memberships_delete on public.memberships;
create policy memberships_delete on public.memberships for delete using (public.is_org_admin(org_id));

-- invitations: אדמין ארגון מנהל; המוזמן רשאי לראות/לעדכן הזמנה התואמת לאימייל שלו.
drop policy if exists invitations_select on public.invitations;
create policy invitations_select on public.invitations for select using (
  public.is_org_admin(org_id)
  or lower(email) = lower((select email from public.profiles where id = auth.uid()))
);
drop policy if exists invitations_insert on public.invitations;
create policy invitations_insert on public.invitations for insert with check (public.is_org_admin(org_id));
drop policy if exists invitations_update on public.invitations;
create policy invitations_update on public.invitations for update using (
  public.is_org_admin(org_id)
  or lower(email) = lower((select email from public.profiles where id = auth.uid()))
);
drop policy if exists invitations_delete on public.invitations;
create policy invitations_delete on public.invitations for delete using (public.is_org_admin(org_id));

-- ----- טבלאות תוכן: קריאה לכל חבר ארגון; שינוי מבנה לאדמין -----
-- שימו לב: אין מדיניות DELETE בכוונה — מחיקה פיזית חסומה (מחיקה רכה בלבד
-- דרך is_archived). CASCADE של מחיקת ארגון ע"י סופר-אדמין עוקף RLS.

-- workspaces (מבנה → אדמין)
drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces for select using (public.is_org_member(org_id));
drop policy if exists workspaces_insert on public.workspaces;
create policy workspaces_insert on public.workspaces for insert with check (public.is_org_admin(org_id));
drop policy if exists workspaces_update on public.workspaces;
create policy workspaces_update on public.workspaces for update using (public.is_org_admin(org_id));

-- boards (מבנה → אדמין)
drop policy if exists boards_select on public.boards;
create policy boards_select on public.boards for select using (public.is_org_member(org_id));
drop policy if exists boards_insert on public.boards;
create policy boards_insert on public.boards for insert with check (public.is_org_admin(org_id));
drop policy if exists boards_update on public.boards;
create policy boards_update on public.boards for update using (public.is_org_admin(org_id));

-- columns (מבנה → אדמין)
drop policy if exists columns_select on public.columns;
create policy columns_select on public.columns for select using (public.is_org_member(org_id));
drop policy if exists columns_insert on public.columns;
create policy columns_insert on public.columns for insert with check (public.is_org_admin(org_id));
drop policy if exists columns_update on public.columns;
create policy columns_update on public.columns for update using (public.is_org_admin(org_id));

-- groups (מבנה → אדמין)
drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups for select using (public.is_org_member(org_id));
drop policy if exists groups_insert on public.groups;
create policy groups_insert on public.groups for insert with check (public.is_org_admin(org_id));
drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups for update using (public.is_org_admin(org_id));

-- items (תוכן → כל חבר ארגון כותב, איש לא מוחק)
drop policy if exists items_select on public.items;
create policy items_select on public.items for select using (public.is_org_member(org_id));
drop policy if exists items_insert on public.items;
create policy items_insert on public.items for insert with check (public.is_org_member(org_id));
drop policy if exists items_update on public.items;
create policy items_update on public.items for update using (public.is_org_member(org_id));

-- ----------------------------------------------------------------------------
-- 7. CRM — לקוחות, אנשי קשר, פייפליין ושדות מותאמים
--    (המקור המלא כולל seeding: migration_004_crm.sql)
-- ----------------------------------------------------------------------------
-- הטבלאות: client_statuses (פייפליין לכל ארגון), client_fields (שדות מותאמים
-- לכל ארגון, אותם סוגים כמו עמודות בורד), clients (שדות בסיס + custom_values
-- jsonb + status_id + owner_id), contacts (אנשי קשר של לקוח).
-- כולן עם org_id + is_archived, RLS ללא DELETE:
--   קריאה — חברי ארגון; clients/contacts כתיבה — חברים;
--   client_statuses/client_fields כתיבה — אדמין בלבד.
-- טריגר on_org_created_seed_statuses יוצר פייפליין ברירת מחדל לארגון חדש:
--   ליד → בטיפול → לקוח פעיל → לא פעיל.
-- קישור משימות: עמודת בורד מסוג 'client' שערכה client_id (נתמך באינדקס GIN
-- idx_items_values על items.values).

-- ----------------------------------------------------------------------------
-- 8. קליטת לידים חיצוניים (המקור המלא: migration_005_leads.sql)
-- ----------------------------------------------------------------------------
-- lead_sources — מקורות פר-ארגון עם token סודי (SELECT לאדמין בלבד);
-- leads — יומן קליטה בלתי-ניתן-לשינוי (SELECT לחברים, אין INSERT/UPDATE/DELETE);
-- ingest_lead(p_token, p_payload) — RPC ציבורי (anon) security definer:
-- מאמת טוקן פעיל, ממפה שדות (name/phone/email בעברית ואנגלית), מזהה כפילות
-- לפי אימייל/טלפון, יוצר לקוח בשלב הראשון בפייפליין ורושם ביומן.

-- ============================================================================
-- לאחר הרשמת המשתמש הראשי, הפכו אותו לסופר-אדמין:
--   update public.profiles set is_super_admin = true where email = 'guyco42@gmail.com';
-- ============================================================================
