-- migration_021_grow_provider.sql — ספק סליקה שני: Grow (Meshulam)
-- ראו docs/superpowers/specs/2026-07-19-grow-payment-provider-design.md
-- הריצו ב-Supabase → SQL Editor. בטוח להריץ שוב (idempotent).

-- 1) מטא-דאטה של הספק לתשלום (Grow: { process_token }) — נכתב ע"י service_role בלבד
alter table public.payments add column if not exists provider_meta jsonb;

-- 2) אחד-לספק: שורה חיה אחת לכל (org, provider)
--    (אם קיימות כפילויות היסטוריות — ארכבו ידנית לפני ההרצה; האינדקס ייכשל אחרת)
create unique index if not exists uq_ppa_org_provider_live
  on public.payment_provider_accounts(org_id, provider) where is_archived = false;

-- 3) הרחבת הטריגר: גם provider_meta נעול אחרי סליקה (service_role בלבד)
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
       or new.provider_meta is distinct from old.provider_meta
       or new.amount is distinct from old.amount then
      raise exception 'payment settled by provider — fields are read-only';
    end if;
  end if;
  return new;
end $$;

-- 4) RPC כללי לשמירת חיבור ספק (אדמינים בלבד). p_secret: כתיבה-בלבד, מוצפן ב-Vault.
--    cardcom: credentials { terminal_number, api_name }, secret = API password
--    grow:    credentials { user_id, page_code, sandbox }, secret לא בשימוש
create or replace function public.save_payment_provider_v2(
  p_org_id uuid,
  p_provider text,
  p_credentials jsonb,
  p_secret text default null,
  p_settings jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public, extensions, vault as $$
declare
  v_id uuid;
  v_key text;
  v_creds jsonb;
  v_name text;
begin
  if not public.is_org_admin(p_org_id) then
    raise exception 'not authorized';
  end if;
  if p_provider not in ('cardcom', 'grow') then
    raise exception 'unsupported provider';
  end if;

  if p_provider = 'cardcom' then
    v_creds := jsonb_build_object(
      'terminal_number', trim(coalesce(p_credentials->>'terminal_number', '')),
      'api_name',        trim(coalesce(p_credentials->>'api_name', ''))
    );
    v_name := 'Cardcom';
  else
    v_creds := jsonb_build_object(
      'user_id',   trim(coalesce(p_credentials->>'user_id', '')),
      'page_code', trim(coalesce(p_credentials->>'page_code', '')),
      'sandbox',   coalesce((p_credentials->>'sandbox')::boolean, true)
    );
    v_name := 'Grow';
  end if;

  select id into v_id from public.payment_provider_accounts
    where org_id = p_org_id and provider = p_provider and is_archived = false
    order by created_at limit 1;

  if v_id is null then
    insert into public.payment_provider_accounts (org_id, provider, display_name, credentials, settings)
    values (p_org_id, p_provider, v_name, v_creds, coalesce(p_settings, '{}'::jsonb))
    returning id into v_id;
  else
    update public.payment_provider_accounts
      set credentials = v_creds, settings = coalesce(p_settings, '{}'::jsonb)
      where id = v_id;
  end if;

  if p_secret is not null and length(trim(p_secret)) > 0 then
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'payment_creds_key' limit 1;
    update public.payment_provider_accounts
      set api_password_enc = extensions.pgp_sym_encrypt(trim(p_secret), v_key)
      where id = v_id;
  end if;

  return v_id;
end $$;

revoke all on function public.save_payment_provider_v2(uuid, text, jsonb, text, jsonb) from public, anon;
grant execute on function public.save_payment_provider_v2(uuid, text, jsonb, text, jsonb) to authenticated;

-- 5) v1 — נשמר לתאימות לאחור; מאציל ל-v2
create or replace function public.save_payment_provider(
  p_org_id uuid,
  p_terminal text,
  p_api_name text,
  p_api_password text,
  p_auto_invoice boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  return public.save_payment_provider_v2(
    p_org_id, 'cardcom',
    jsonb_build_object('terminal_number', p_terminal, 'api_name', p_api_name),
    p_api_password,
    jsonb_build_object('auto_invoice', coalesce(p_auto_invoice, true), 'document_type', 'invoice_receipt', 'language', 'he')
  );
end $$;
