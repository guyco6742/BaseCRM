-- ============================================================================
-- מיגרציה 015 — הגבלת קצב (rate limiting) ל-RPC-ים הציבוריים + ניקוי דגל
--                send_contract שהוסר מהפרונט.
-- הריצו ב-Supabase → SQL Editor (בטוח להריץ שוב, idempotent).
--
-- הבעיה: ingest_lead ו-get_invitation_by_token נחשפים ל-anon בלי שום הגבלת
-- קצב. טוקן lead_sources שדלף, או סקריפט מנחש-טוקנים על get_invitation_by_token,
-- יכולים להציף ארגון בלידים או לבצע brute-force על הזמנות ללא שום חסם.
--
-- הפתרון: טבלת rate_limits + פונקציית check_rate_limit גנרית (fixed window,
-- ניקוי הזדמנותי של חלונות ישנים, בלי pg_cron) — נקראת בתחילת שתי הפונקציות.
-- ראו §7 (Item 3) ב-docs/superpowers/specs/2026-07-08-remediation-prd-and-tech-spec.md.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. טבלת rate_limits — נעולה לחלוטין ל-RLS, גישה רק דרך פונקציות security definer
-- ----------------------------------------------------------------------------
create table if not exists public.rate_limits (
  bucket_key   text not null,
  window_start timestamptz not null,
  hits         int not null default 1,
  primary key (bucket_key, window_start)
);

alter table public.rate_limits enable row level security;
-- אין policies בכוונה — הטבלה נגישה אך ורק דרך check_rate_limit (security definer).

-- ----------------------------------------------------------------------------
-- 2. check_rate_limit — מונה חלון-קבוע (fixed window) גנרי
--    p_key: מפתח הדלי (למשל 'ingest:<token>' או 'invite_ip:<ip>')
--    p_max: מספר קריאות מותר בחלון
--    p_window: אורך החלון (למשל interval '1 minute')
-- ----------------------------------------------------------------------------
create or replace function public.check_rate_limit(p_key text, p_max int, p_window interval)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_start timestamptz := date_bin(p_window, now(), timestamptz 'epoch');
  v_hits int;
begin
  insert into public.rate_limits (bucket_key, window_start, hits)
  values (p_key, v_start, 1)
  on conflict (bucket_key, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;

  -- ניקוי הזדמנותי: מוחקים חלונות ישנים של אותו מפתח (לא scheduler ייעודי)
  delete from public.rate_limits
  where bucket_key = p_key and window_start < v_start - p_window;

  return v_hits <= p_max;
end;
$$;

-- פונקציית עזר פנימית בלבד — לא נקראת ישירות דרך ה-API, רק מתוך פונקציות
-- security definer אחרות (שרצות בהרשאות הבעלים בכל מקרה).
revoke all on function public.check_rate_limit(text, int, interval) from public;

-- ----------------------------------------------------------------------------
-- 3. ingest_lead — מחדש מ-migration_006, בתוספת הגבלת קצב לפי טוקן ולפי IP.
--    כל שאר ההתנהגות (מכסת 20KB, קיצוץ שדות, מיפוי facebook/zapier, דה-דופ
--    לפי אימייל/טלפון, יצירת לקוח בשלב הראשון, רישום ביומן leads, צורת ה-jsonb
--    המוחזרת) נשמרת אחד לאחד.
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
  v_ip text;
begin
  -- מזהה IP למגבלת קצב (X-Forwarded-For, השדה הראשון אם יש כמה proxies).
  -- הכותרת עשויה לא להיות קיימת כלל (למשל בקריאה מה-SQL editor) — לא זורקים שגיאה.
  begin
    v_ip := split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1);
  exception when others then
    v_ip := null;
  end;
  v_ip := coalesce(nullif(v_ip, ''), '?');

  -- הגבלת קצב: לפי טוקן (60/דקה) ולפי IP (120/דקה) — נבדק *לפני* בדיקת תקינות
  -- הטוקן, כדי שתגובת "rate_limited" לא תחשוף (בזמן תגובה) האם טוקן תקין או לא.
  if not public.check_rate_limit('ingest:' || p_token, 60, interval '1 minute') then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  if not public.check_rate_limit('ingest_ip:' || v_ip, 120, interval '1 minute') then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

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

revoke all on function public.ingest_lead(text, jsonb) from public;
grant execute on function public.ingest_lead(text, jsonb) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. get_invitation_by_token — הומר מ-sql ל-plpgsql כדי להוסיף הגבלת קצב לפי
--    IP (20/דקה). אותה חתימה, אותה טבלת תוצאה, אותו grant — חריגה ממכסה
--    מחזירה סט ריק (לא שגיאה).
-- ----------------------------------------------------------------------------
create or replace function public.get_invitation_by_token(p_token text)
returns table (id uuid, org_id uuid, email text, role member_role, status invite_status, org_name text)
language plpgsql security definer set search_path = public as $$
declare
  v_ip text;
begin
  begin
    v_ip := split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1);
  exception when others then
    v_ip := null;
  end;
  v_ip := coalesce(nullif(v_ip, ''), '?');

  if not public.check_rate_limit('invite_ip:' || v_ip, 20, interval '1 minute') then
    return; -- סט ריק, בלי שגיאה
  end if;

  return query
  select i.id, i.org_id, i.email, i.role, i.status, o.name
  from public.invitations i
  join public.organizations o on o.id = i.org_id
  where i.token = p_token;
end;
$$;

grant execute on function public.get_invitation_by_token(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. ניקוי דגל send_contract — הפיצ'ר הוסר מהפרונט (P1-A); מנקים את הדאטה.
-- ----------------------------------------------------------------------------
update public.organizations set features = features - 'send_contract';

-- ----------------------------------------------------------------------------
-- 6. אכיפת גודל קובץ בצד השרת (F2) — הוולידציה בצד לקוח (10MB) ניתנת לעקיפה
--    בקריאה ישירה ל-Storage API; מגבלת ה-bucket היא שכבת האכיפה האמיתית.
--    upsert: מבטיח שה-bucket קיים עם המגבלה גם בסביבה שבה מיגרציה 002 לא רצה.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 10485760) -- 10MB
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- ============================================================================
-- SQL Smoke Test (dev בלבד) — לא רץ כחלק מהמיגרציה. הסירו את ה-comment והריצו
-- ידנית ב-SQL editor של dev כדי לוודא שהגבלת הקצב עובדת:
-- 20 קריאות ראשונות מחזירות את ההזמנה, הקריאה ה-21 ואילך מוחזרת ריקה.
-- ============================================================================
-- do $$
-- declare
--   v_token text := 'smoke-test-token-' || substr(md5(random()::text), 1, 12);
--   v_org_id uuid;
--   v_id uuid;              -- scalar target: unambiguously NULL on zero rows
--                            -- (unlike an untyped `record`, which can raise
--                            -- "record ... is not assigned yet" on zero rows)
--   i int;
--   v_empty_from int := null;
-- begin
--   select id into v_org_id from public.organizations limit 1;
--   if v_org_id is null then
--     raise notice 'no organizations found in this project — skipping smoke test';
--     return;
--   end if;
--
--   insert into public.invitations (org_id, email, role, status, token)
--   values (v_org_id, 'smoke-test@example.com', 'member', 'pending', v_token);
--
--   for i in 1..25 loop
--     v_id := null;
--     select id into v_id from public.get_invitation_by_token(v_token) limit 1;
--     if v_id is null and v_empty_from is null then
--       v_empty_from := i;
--     end if;
--   end loop;
--
--   if v_empty_from is null then
--     raise exception 'smoke test FAILED: no call was rate-limited across 25 tries';
--   elsif v_empty_from <> 21 then
--     raise warning 'smoke test: expected call #21 to be first rate-limited, got call #%', v_empty_from;
--   else
--     raise notice 'smoke test OK: calls 1-20 returned the invitation, call #21 was rate-limited (max=20/min)';
--   end if;
--
--   delete from public.invitations where token = v_token;
--   delete from public.rate_limits where bucket_key = 'invite_ip:?';
-- end $$;
