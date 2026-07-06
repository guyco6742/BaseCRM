-- ============================================================================
-- מיגרציה 006 — תיקון חסימת מחיקת משתמשים + הקשחות מביקורת קוד
-- הריצו ב-Supabase → SQL Editor (בטוח להריץ שוב, idempotent).
--
-- הבעיה: organizations.created_by / invitations.invited_by / clients.owner_id
-- הפנו ל-profiles בלי כלל מחיקה (NO ACTION) — ולכן מחיקת משתמש שיצר ארגון
-- נחסמה ב-Auth. התיקון: ON DELETE SET NULL — המחיקה מנקה את ההפניה
-- ומשאירה את הנתונים שלמים.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. תיקון ה-FK-ים החוסמים מחיקת משתמש
-- ----------------------------------------------------------------------------
alter table public.organizations drop constraint if exists organizations_created_by_fkey;
alter table public.organizations add constraint organizations_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.invitations drop constraint if exists invitations_invited_by_fkey;
alter table public.invitations add constraint invitations_invited_by_fkey
  foreign key (invited_by) references public.profiles(id) on delete set null;

alter table public.clients drop constraint if exists clients_owner_id_fkey;
alter table public.clients add constraint clients_owner_id_fkey
  foreign key (owner_id) references public.profiles(id) on delete set null;

-- ----------------------------------------------------------------------------
-- 2. הקשחות מביקורת הקוד
-- ----------------------------------------------------------------------------

-- מניעת הזמנות כפולות: לא ניתן ליצור שתי הזמנות ממתינות לאותו אימייל באותו ארגון
create unique index if not exists uq_invitations_pending
  on public.invitations (org_id, lower(email))
  where status = 'pending';

-- הקשחת קליטת לידים: הגבלת גודל payload וקיצוץ אורכי שדות (הגנה מהצפת זבל)
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
  if length(p_payload::text) > 20000 then
    raise exception 'payload too large';
  end if;

  select * into v_source
  from public.lead_sources
  where token = p_token and is_active = true and is_archived = false;

  if v_source.id is null then
    raise exception 'invalid or inactive token';
  end if;

  v_name := left(nullif(trim(coalesce(
    p_payload->>'name', p_payload->>'full_name', p_payload->>'שם',
    nullif(trim(concat(coalesce(p_payload->>'first_name',''), ' ', coalesce(p_payload->>'last_name',''))), '')
  )), ''), 200);
  v_phone := left(nullif(trim(coalesce(p_payload->>'phone', p_payload->>'phone_number', p_payload->>'טלפון')), ''), 50);
  v_email := left(nullif(lower(trim(coalesce(p_payload->>'email', p_payload->>'אימייל'))), ''), 200);

  if v_name is null then
    v_name := coalesce(v_email, v_phone, 'ליד ללא שם');
  end if;

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

  insert into public.leads (org_id, source_id, client_id, name, phone, email, payload, deduped)
  values (v_source.org_id, v_source.id, v_client_id, v_name, v_phone, v_email, p_payload, v_deduped);

  return jsonb_build_object('ok', true, 'client_id', v_client_id, 'deduped', v_deduped);
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. מחיקת משתמשי הבדיקה (עכשיו זה יעבוד!)
--    profiles נמחק ב-cascade; created_by יתאפס ל-NULL; שאר הנתונים נשארים.
-- ----------------------------------------------------------------------------
delete from auth.users
where email in ('sa@basecrm.local', 'member@basecrm.local', 'smoketest@basecrm.local')
   or email like 'membera_%@basecrm.local';
