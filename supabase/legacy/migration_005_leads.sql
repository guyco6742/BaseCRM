-- ============================================================================
-- מיגרציה 005 — קליטת לידים חיצוניים (פייסבוק / Webhook) פר-ארגון
-- הריצו ב-Supabase → SQL Editor (בטוח להריץ שוב, idempotent).
--
-- ארכיטקטורה: כל ארגון מגדיר "מקורות לידים". לכל מקור טוקן סודי ייחודי.
-- שירות חיצוני (Zapier/Make המחובר ל-Facebook Lead Ads, טופס אתר וכו')
-- קורא ל-RPC הציבורי ingest_lead עם הטוקן — והליד נוצר כלקוח בשלב הראשון
-- בפייפליין, עם זיהוי כפילויות לפי אימייל/טלפון ורישום ביומן leads.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. טבלאות
-- ----------------------------------------------------------------------------

-- מקורות לידים — לכל ארגון (פייסבוק, אתר, דף נחיתה...)
create table if not exists public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  source_type text not null default 'webhook',  -- facebook | webhook | other (תווית לתצוגה)
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  is_active boolean not null default true,
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- יומן לידים נכנסים — רישום בלתי-ניתן-לשינוי של כל קליטה
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  source_id uuid references public.lead_sources(id),
  client_id uuid references public.clients(id),   -- הלקוח שנוצר / זוהה ככפילות
  name text,
  phone text,
  email text,
  payload jsonb not null default '{}'::jsonb,      -- הנתונים הגולמיים שהתקבלו
  deduped boolean not null default false,          -- true = חובר ללקוח קיים
  created_at timestamptz not null default now()
);

create index if not exists idx_lead_sources_org on public.lead_sources(org_id);
create index if not exists idx_leads_org on public.leads(org_id);
create index if not exists idx_leads_client on public.leads(client_id);

-- ----------------------------------------------------------------------------
-- 2. RLS — הטוקנים רגישים: מקורות גלויים לאדמין בלבד; היומן לחברי הארגון.
--    אין INSERT/UPDATE ליומן (נכתב רק ע"י הפונקציה) ואין DELETE לאף אחד.
-- ----------------------------------------------------------------------------
alter table public.lead_sources enable row level security;
alter table public.leads        enable row level security;

drop policy if exists lead_sources_select on public.lead_sources;
create policy lead_sources_select on public.lead_sources for select using (public.is_org_admin(org_id));
drop policy if exists lead_sources_insert on public.lead_sources;
create policy lead_sources_insert on public.lead_sources for insert with check (public.is_org_admin(org_id));
drop policy if exists lead_sources_update on public.lead_sources;
create policy lead_sources_update on public.lead_sources for update using (public.is_org_admin(org_id));

drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select using (public.is_org_member(org_id));

-- ----------------------------------------------------------------------------
-- 3. RPC קליטת ליד — נקרא מבחוץ עם הטוקן הסודי (security definer)
--    POST https://<project>.supabase.co/rest/v1/rpc/ingest_lead
--    headers: apikey=<anon>, Content-Type: application/json
--    body: {"p_token":"...","p_payload":{"name":"...","phone":"...","email":"..."}}
-- ----------------------------------------------------------------------------
create or replace function public.ingest_lead(p_token text, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_source public.lead_sources%rowtype;
  v_name text;
  v_phone text;
  v_email text;
  v_client_id uuid;
  v_status uuid;
  v_pos double precision;
  v_deduped boolean := false;
begin
  select * into v_source
  from public.lead_sources
  where token = p_token and is_active = true and is_archived = false;

  if v_source.id is null then
    raise exception 'invalid or inactive token';
  end if;

  -- מיפוי שדות נפוצים (פייסבוק / Zapier / טפסים כלליים, עברית ואנגלית)
  v_name := nullif(trim(coalesce(
    p_payload->>'name', p_payload->>'full_name', p_payload->>'שם',
    nullif(trim(concat(coalesce(p_payload->>'first_name',''), ' ', coalesce(p_payload->>'last_name',''))), '')
  )), '');
  v_phone := nullif(trim(coalesce(p_payload->>'phone', p_payload->>'phone_number', p_payload->>'טלפון')), '');
  v_email := nullif(lower(trim(coalesce(p_payload->>'email', p_payload->>'אימייל'))), '');

  if v_name is null then
    v_name := coalesce(v_email, v_phone, 'ליד ללא שם');
  end if;

  -- זיהוי כפילות: לקוח פעיל באותו ארגון עם אותו אימייל או טלפון
  select id into v_client_id
  from public.clients
  where org_id = v_source.org_id
    and is_archived = false
    and ((v_email is not null and lower(email) = v_email)
      or (v_phone is not null and phone = v_phone))
  limit 1;

  if v_client_id is not null then
    v_deduped := true;
  else
    -- לקוח חדש בשלב הראשון של הפייפליין
    select id into v_status
    from public.client_statuses
    where org_id = v_source.org_id and is_archived = false
    order by position limit 1;

    select coalesce(max(position), 0) + 1 into v_pos
    from public.clients where org_id = v_source.org_id;

    insert into public.clients (org_id, name, phone, email, status_id, notes, position)
    values (v_source.org_id, v_name, v_phone, v_email, v_status,
            'התקבל ממקור: ' || v_source.name, v_pos)
    returning id into v_client_id;
  end if;

  -- רישום ביומן הלידים (תמיד — גם בכפילות)
  insert into public.leads (org_id, source_id, client_id, name, phone, email, payload, deduped)
  values (v_source.org_id, v_source.id, v_client_id, v_name, v_phone, v_email, p_payload, v_deduped);

  return jsonb_build_object('ok', true, 'client_id', v_client_id, 'deduped', v_deduped);
end;
$$;

revoke all on function public.ingest_lead(text, jsonb) from public;
grant execute on function public.ingest_lead(text, jsonb) to anon, authenticated;
