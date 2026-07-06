-- ============================================================================
-- מיגרציה 004 — מודול CRM: לקוחות, אנשי קשר, פייפליין סטטוסים, שדות מותאמים
-- הריצו ב-Supabase → SQL Editor (בטוח להריץ שוב, idempotent).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. טבלאות
-- ----------------------------------------------------------------------------

-- שלבי פייפליין ללקוחות — מותאם לכל ארגון
create table if not exists public.client_statuses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  label text not null,
  color text not null default '#579bfc',
  position double precision not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- שדות מותאמים ללקוחות — מותאם לכל ארגון (אותם סוגים כמו עמודות בורד)
create table if not exists public.client_fields (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  type text not null,
  settings jsonb not null default '{}'::jsonb,
  position double precision not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- לקוחות
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  status_id uuid references public.client_statuses(id),
  company_number text,          -- ח.פ / ע.מ
  phone text,
  email text,
  address text,
  website text,
  notes text,
  owner_id uuid references public.profiles(id),   -- אחראי לקוח
  custom_values jsonb not null default '{}'::jsonb, -- { field_id: value }
  position double precision not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- אנשי קשר של לקוח
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  role text,
  phone text,
  email text,
  notes text,
  position double precision not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_client_statuses_org on public.client_statuses(org_id);
create index if not exists idx_client_fields_org on public.client_fields(org_id);
create index if not exists idx_clients_org on public.clients(org_id);
create index if not exists idx_contacts_client on public.contacts(client_id);
-- אינדקס לחיפוש משימות מקושרות ללקוח (values @> ...)
create index if not exists idx_items_values on public.items using gin (values jsonb_path_ops);

-- ----------------------------------------------------------------------------
-- 2. RLS — קריאה לחברי ארגון; אין DELETE (מחיקה רכה בלבד)
-- ----------------------------------------------------------------------------
alter table public.client_statuses enable row level security;
alter table public.client_fields   enable row level security;
alter table public.clients         enable row level security;
alter table public.contacts        enable row level security;

-- פייפליין ושדות — ניהול ע"י אדמין
drop policy if exists client_statuses_select on public.client_statuses;
create policy client_statuses_select on public.client_statuses for select using (public.is_org_member(org_id));
drop policy if exists client_statuses_insert on public.client_statuses;
create policy client_statuses_insert on public.client_statuses for insert with check (public.is_org_admin(org_id));
drop policy if exists client_statuses_update on public.client_statuses;
create policy client_statuses_update on public.client_statuses for update using (public.is_org_admin(org_id));

drop policy if exists client_fields_select on public.client_fields;
create policy client_fields_select on public.client_fields for select using (public.is_org_member(org_id));
drop policy if exists client_fields_insert on public.client_fields;
create policy client_fields_insert on public.client_fields for insert with check (public.is_org_admin(org_id));
drop policy if exists client_fields_update on public.client_fields;
create policy client_fields_update on public.client_fields for update using (public.is_org_admin(org_id));

-- לקוחות ואנשי קשר — תוכן: כל חבר ארגון כותב
drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients for select using (public.is_org_member(org_id));
drop policy if exists clients_insert on public.clients;
create policy clients_insert on public.clients for insert with check (public.is_org_member(org_id));
drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients for update using (public.is_org_member(org_id));

drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts for select using (public.is_org_member(org_id));
drop policy if exists contacts_insert on public.contacts;
create policy contacts_insert on public.contacts for insert with check (public.is_org_member(org_id));
drop policy if exists contacts_update on public.contacts;
create policy contacts_update on public.contacts for update using (public.is_org_member(org_id));

-- ----------------------------------------------------------------------------
-- 3. פייפליין ברירת מחדל — לארגונים קיימים + טריגר לארגונים חדשים
-- ----------------------------------------------------------------------------
insert into public.client_statuses (org_id, label, color, position)
select o.id, s.label, s.color, s.pos
from public.organizations o
cross join (values ('ליד','#579bfc',0.0), ('בטיפול','#fdab3d',1.0), ('לקוח פעיל','#00c875',2.0), ('לא פעיל','#c4c4c4',3.0)) as s(label, color, pos)
where not exists (select 1 from public.client_statuses cs where cs.org_id = o.id);

create or replace function public.seed_client_statuses()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.client_statuses (org_id, label, color, position) values
    (new.id, 'ליד', '#579bfc', 0),
    (new.id, 'בטיפול', '#fdab3d', 1),
    (new.id, 'לקוח פעיל', '#00c875', 2),
    (new.id, 'לא פעיל', '#c4c4c4', 3);
  return new;
end;
$$;

drop trigger if exists on_org_created_seed_statuses on public.organizations;
create trigger on_org_created_seed_statuses
  after insert on public.organizations
  for each row execute function public.seed_client_statuses();
