-- migration_014_payments.sql — מודול תשלומים (שלב א: לקוחות משלמים לארגון)
-- ראו docs/superpowers/specs/2026-07-07-payments-design.md

-- חשבון סליקה של הארגון (Cardcom וכו') — קריאה/כתיבה לאדמינים בלבד
create table if not exists public.payment_provider_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null default 'cardcom' check (provider in ('cardcom','grow','payplus')),
  display_name text,
  credentials jsonb not null default '{}'::jsonb,  -- cardcom: { terminal_number, api_name, api_password }
  settings jsonb not null default '{}'::jsonb,     -- { auto_invoice: true, document_type: 'invoice_receipt', language: 'he' }
  is_active boolean not null default true,
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- יומן תשלומים — שורה לכל חיוב/תשלום
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  provider_account_id uuid references public.payment_provider_accounts(id),
  kind text not null default 'one_time' check (kind in ('one_time','subscription_charge')),
  method text check (method in ('credit_card','bit','cash','bank_transfer','check','other')),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'ILS' check (currency = 'ILS'),
  description text,
  status text not null default 'pending' check (status in ('pending','paid','failed','canceled','refunded')),
  due_date date,
  paid_at timestamptz,
  payment_link text,
  provider_ref text unique,        -- מזהה עסקה אצל הספק — מפתח אידמפוטנטיות ל-webhook
  invoice_url text,
  invoice_number text,
  raw_webhook jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- הוראות קבע (שלב ג — הטבלה מוכנה, אין UI עדיין)
create table if not exists public.payment_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  provider_account_id uuid references public.payment_provider_accounts(id),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'ILS' check (currency = 'ILS'),
  description text,
  day_of_month int check (day_of_month between 1 and 28),
  status text not null default 'active' check (status in ('active','paused','canceled')),
  provider_ref text unique,
  next_charge_at timestamptz,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payments_org on public.payments(org_id);
create index if not exists idx_payments_client on public.payments(client_id);
create index if not exists idx_payments_org_status on public.payments(org_id, status);
create index if not exists idx_ppa_org on public.payment_provider_accounts(org_id);
create index if not exists idx_psub_org on public.payment_subscriptions(org_id);

-- updated_at אוטומטי (משתמש בפונקציה הקיימת set_updated_at אם קיימת; אחרת יוצר)
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists payments_updated_at on public.payments;
create trigger payments_updated_at before update on public.payments
  for each row execute function public.tg_set_updated_at();
drop trigger if exists psub_updated_at on public.payment_subscriptions;
create trigger psub_updated_at before update on public.payment_subscriptions
  for each row execute function public.tg_set_updated_at();

-- הקשחה: תשלום שמקושר לספק (provider_ref) — שדות הסליקה משתנים רק דרך service_role (webhook)
create or replace function public.protect_provider_payment_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.provider_ref is not null
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    if new.status is distinct from old.status
       or new.paid_at is distinct from old.paid_at
       or new.invoice_url is distinct from old.invoice_url
       or new.invoice_number is distinct from old.invoice_number
       or new.provider_ref is distinct from old.provider_ref
       or new.amount is distinct from old.amount then
      raise exception 'payment settled by provider — fields are read-only';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists protect_provider_payment on public.payments;
create trigger protect_provider_payment before update on public.payments
  for each row execute function public.protect_provider_payment_fields();

-- RLS
alter table public.payment_provider_accounts enable row level security;
alter table public.payments enable row level security;
alter table public.payment_subscriptions enable row level security;

-- חשבון סליקה: אדמינים בלבד (כמו lead_sources)
drop policy if exists ppa_select on public.payment_provider_accounts;
create policy ppa_select on public.payment_provider_accounts for select using (public.is_org_admin(org_id));
drop policy if exists ppa_insert on public.payment_provider_accounts;
create policy ppa_insert on public.payment_provider_accounts for insert with check (public.is_org_admin(org_id));
drop policy if exists ppa_update on public.payment_provider_accounts;
create policy ppa_update on public.payment_provider_accounts for update using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
-- אין policy למחיקה — מחיקה רכה בלבד

-- תשלומים: כל חברי הארגון
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select using (public.is_org_member(org_id));
drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments for insert with check (public.is_org_member(org_id));
drop policy if exists payments_update on public.payments;
create policy payments_update on public.payments for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- הוראות קבע: חברי הארגון רואים, אדמינים מנהלים
drop policy if exists psub_select on public.payment_subscriptions;
create policy psub_select on public.payment_subscriptions for select using (public.is_org_member(org_id));
drop policy if exists psub_insert on public.payment_subscriptions;
create policy psub_insert on public.payment_subscriptions for insert with check (public.is_org_admin(org_id));
drop policy if exists psub_update on public.payment_subscriptions;
create policy psub_update on public.payment_subscriptions for update using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
