-- ============================================================================
-- מיגרציה 015 — הקשחת אבטחת מודול התשלומים
--
-- שלושה תיקונים (ראו סקירת אבטחה):
--   1) api_password של ספק הסליקה — כתיבה-בלבד + הצפנה ב-rest.
--      עד היום הסיסמה נשמרה כטקסט גלוי בתוך credentials jsonb והוחזרה
--      לדפדפן לכל אדמין. עכשיו: נשמרת מוצפנת בעמודה נפרדת (pgp_sym_encrypt
--      עם מפתח מ-Supabase Vault), נכתבת רק דרך RPC, ולעולם לא מוחזרת ללקוח.
--   2) (בפונקציות ה-Edge) webhook secret — מטופל שם.
--   3) תשלומים — כתיבה לאדמינים בלבד; חברי ארגון רגילים רק צופים.
--
-- הריצו ב-Supabase → SQL Editor. בטוח להריץ שוב (idempotent).
--
-- הערה לתפעול: אחרי המיגרציה, הגדירו את סוד ה-webhook לפונקציות ה-Edge:
--   supabase secrets set PAYMENT_WEBHOOK_SECRET=<מחרוזת אקראית ארוכה>
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------------
-- 1) מפתח הצפנה ב-Vault — נוצר פעם אחת אם עדיין אין (בטוח להריץ שוב)
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'payment_creds_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'payment_creds_key',
      'Symmetric key for encrypting payment_provider_accounts.api_password'
    );
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2) עמודת סיסמה מוצפנת + הגירת הטקסט הגלוי הקיים לתוכה, ואז מחיקתו מה-jsonb
-- ----------------------------------------------------------------------------
alter table public.payment_provider_accounts
  add column if not exists api_password_enc bytea;

do $$
declare v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'payment_creds_key' limit 1;

  update public.payment_provider_accounts
    set api_password_enc = extensions.pgp_sym_encrypt(credentials->>'api_password', v_key)
    where credentials ? 'api_password'
      and coalesce(credentials->>'api_password', '') <> ''
      and api_password_enc is null;

  -- מסירים את הסיסמה הגלויה מה-jsonb (גם אם הייתה ריקה)
  update public.payment_provider_accounts
    set credentials = credentials - 'api_password'
    where credentials ? 'api_password';
end $$;

-- ----------------------------------------------------------------------------
-- 3) נתיב כתיבה: RPC לאדמינים בלבד. הסיסמה היא כתיבה-בלבד —
--    מתעדכנת רק כשמוסרת סיסמה חדשה לא-ריקה, אחרת נשמרת הקיימת.
-- ----------------------------------------------------------------------------
create or replace function public.save_payment_provider(
  p_org_id uuid,
  p_terminal text,
  p_api_name text,
  p_api_password text,
  p_auto_invoice boolean default true
) returns uuid
language plpgsql security definer set search_path = public, extensions, vault as $$
declare
  v_id  uuid;
  v_key text;
begin
  if not public.is_org_admin(p_org_id) then
    raise exception 'not authorized';
  end if;

  select id into v_id from public.payment_provider_accounts
    where org_id = p_org_id and provider = 'cardcom' and is_archived = false
    order by created_at limit 1;

  if v_id is null then
    insert into public.payment_provider_accounts (org_id, provider, display_name, credentials, settings)
    values (
      p_org_id, 'cardcom', 'Cardcom',
      jsonb_build_object('terminal_number', trim(p_terminal), 'api_name', trim(p_api_name)),
      jsonb_build_object('auto_invoice', coalesce(p_auto_invoice, true), 'document_type', 'invoice_receipt', 'language', 'he')
    )
    returning id into v_id;
  else
    update public.payment_provider_accounts set
      credentials = jsonb_build_object('terminal_number', trim(p_terminal), 'api_name', trim(p_api_name)),
      settings    = jsonb_build_object('auto_invoice', coalesce(p_auto_invoice, true), 'document_type', 'invoice_receipt', 'language', 'he')
    where id = v_id;
  end if;

  -- כתיבה-בלבד: מעדכנים את הסיסמה רק אם נמסרה חדשה
  if p_api_password is not null and length(trim(p_api_password)) > 0 then
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'payment_creds_key' limit 1;
    update public.payment_provider_accounts
      set api_password_enc = extensions.pgp_sym_encrypt(trim(p_api_password), v_key)
      where id = v_id;
  end if;

  return v_id;
end $$;

revoke all on function public.save_payment_provider(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.save_payment_provider(uuid, text, text, text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) נתיב קריאה: view בטוח ללא הצופן — חושף רק has_password (בוליאני).
--    security_invoker=on כדי שמדיניות ה-RLS (אדמינים בלבד) תמשיך לחול.
-- ----------------------------------------------------------------------------
create or replace view public.payment_provider_accounts_safe
with (security_invoker = on) as
select
  id, org_id, provider, display_name, credentials, settings,
  is_active, is_archived, created_at,
  (api_password_enc is not null) as has_password
from public.payment_provider_accounts;

grant select on public.payment_provider_accounts_safe to authenticated;

-- ----------------------------------------------------------------------------
-- 5) פענוח בצד-שרת לפונקציות Edge (service_role בלבד) — שמור לשימוש עתידי
--    (פעולות ספק שידרשו את הסיסמה; כיום אף אחת לא דורשת).
-- ----------------------------------------------------------------------------
create or replace function public.get_payment_provider_secret(p_account_id uuid)
returns text
language plpgsql security definer set search_path = public, extensions, vault as $$
declare v_key text; v_enc bytea;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'not authorized';
  end if;
  select api_password_enc into v_enc from public.payment_provider_accounts where id = p_account_id;
  if v_enc is null then return null; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'payment_creds_key' limit 1;
  return extensions.pgp_sym_decrypt(v_enc, v_key);
end $$;

revoke all on function public.get_payment_provider_secret(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6) תשלומים — כתיבה לאדמינים בלבד; חברי ארגון רגילים רואים בלבד.
--    (שדות שהוסדרו ע"י הספק כבר נעולים ע"י טריגר ממיגרציה 014.)
-- ----------------------------------------------------------------------------
drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments for insert
  with check (public.is_org_admin(org_id));

drop policy if exists payments_update on public.payments;
create policy payments_update on public.payments for update
  using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

-- payments_select נשאר is_org_member (צפייה לכל חברי הארגון).
