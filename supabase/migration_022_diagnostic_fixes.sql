-- ============================================================================
-- מיגרציה 022 — תיקוני אבחון (diagnostic fixes): אינדקסים מרוכבים, RPC-ים
--                לאגרגציה, תפוגת הזמנות, ואכיפת עקביות org_id בין טבלאות (FK).
-- הריצו ב-Supabase → SQL Editor (בטוח להריץ שוב, idempotent).
--
-- מה הקובץ עושה:
--   1. אינדקסים מרוכבים תומכי-דפדוף/סינון על clients / payments / contacts,
--      + אינדקס טריגרם על clients.company_number לחיפוש ilike (כמו מיגרציה 019).
--   2. שני RPC-ים בטוחים (security definer + guard is_org_member בשורה הראשונה,
--      בדיוק לפי המוסכמה של get_org_dashboard/get_org_report במיגרציה 017):
--        get_client_status_counts(p_org_id) — ספירת לקוחות פעילים לפי status_id.
--        get_payment_totals(p_org_id, p_status, p_from, p_to) — סכום תשלומים לפי סטטוס.
--   3. invitations.expires_at (ברירת מחדל now()+7 ימים) + backfill; הזמנה שפגה
--      נחשבת "לא נמצאה" ב-get_invitation_by_token, וגם ב-path של memberships_insert.
--   4. טריגרים BEFORE INSERT/UPDATE שאוסרים הפניה חוצת-ארגון (cross-tenant):
--        items.board_id/group_id חייבים להשתייך ל-items.org_id;
--        payments.client_id חייב להשתייך ל-payments.org_id.
--
-- אין CREATE INDEX CONCURRENTLY — לא חוקי בתוך טרנזקציית מיגרציה; אינדקס רגיל.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. אינדקסים מרוכבים (Item — ביצועים)
-- ----------------------------------------------------------------------------
-- clients: דפדוף/סינון רשימת הלקוחות הפעילים לפי position ולפי שם (case-insensitive).
create index if not exists idx_clients_org_archived_position
  on public.clients (org_id, is_archived, position);
create index if not exists idx_clients_org_archived_lower_name
  on public.clients (org_id, is_archived, lower(name));

-- payments: רשימת/דוחות תשלומים פעילים לפי זמן יצירה.
create index if not exists idx_payments_org_archived_created
  on public.payments (org_id, is_archived, created_at);

-- contacts: אנשי הקשר (הפעילים) של לקוח בודד.
create index if not exists idx_contacts_client_archived
  on public.contacts (client_id, is_archived);

-- אינדקס טריגרם על company_number (ח.פ/ע.מ) לחיפוש ilike '%q%' — מקביל למיגרציה 019.
-- נוצר רק אם העמודה קיימת (הגנה מפני סביבה שבה מיגרציה 004 שונתה/לא רצה).
create extension if not exists pg_trgm;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clients' and column_name = 'company_number'
  ) then
    create index if not exists idx_clients_company_number_trgm
      on public.clients using gin (company_number gin_trgm_ops);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. RPC-ים לאגרגציה (security definer + guard is_org_member, לפי מוסכמת §7 / מיגרציה 017)
-- ----------------------------------------------------------------------------

-- get_client_status_counts — ספירת לקוחות לא-בארכיון לפי status_id.
-- כולל את דלי ה-NULL (לקוחות בלי status_id) כשורה עם status_id IS NULL.
-- הערה: האגרגציה עטופה בתת-שאילתה עם aliasים ייחודיים (cnt) כדי להימנע
-- מהתנגשות בין count(*) לבין עמודת הפלט בשם count ב-RETURNS TABLE.
create or replace function public.get_client_status_counts(p_org_id uuid)
returns table (status_id uuid, count bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'forbidden';
  end if;

  return query
  select t.status_id, t.cnt
  from (
    select c.status_id as status_id, count(*)::bigint as cnt
    from public.clients c
    where c.org_id = p_org_id and c.is_archived = false
    group by c.status_id
  ) t;
end;
$$;

revoke all on function public.get_client_status_counts(uuid) from public;
grant execute on function public.get_client_status_counts(uuid) to authenticated;
revoke execute on function public.get_client_status_counts(uuid) from anon;

-- get_payment_totals — סכום amount לפי status על תשלומים לא-בארכיון של הארגון,
-- עם סינון אופציונלי לפי status ולפי טווח created_at (מופעל רק כשהארגומנט לא-NULL).
create or replace function public.get_payment_totals(
  p_org_id uuid,
  p_status text default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (status text, total numeric)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'forbidden';
  end if;

  return query
  select t.status, t.total
  from (
    select p.status as status, coalesce(sum(p.amount), 0)::numeric as total
    from public.payments p
    where p.org_id = p_org_id
      and p.is_archived = false
      and (p_status is null or p.status = p_status)
      and (p_from is null or p.created_at >= p_from)
      and (p_to is null or p.created_at <= p_to)
    group by p.status
  ) t;
end;
$$;

revoke all on function public.get_payment_totals(uuid, text, timestamptz, timestamptz) from public;
grant execute on function public.get_payment_totals(uuid, text, timestamptz, timestamptz) to authenticated;
revoke execute on function public.get_payment_totals(uuid, text, timestamptz, timestamptz) from anon;

-- ----------------------------------------------------------------------------
-- 3. תפוגת הזמנות (invitations.expires_at)
-- ----------------------------------------------------------------------------
-- הוספת העמודה + backfill לשורות קיימות ל-created_at + 7 ימים.
alter table public.invitations
  add column if not exists expires_at timestamptz not null default (now() + interval '7 days');

-- backfill: שורות שנוצרו לפני ההגירה קיבלו את ברירת-המחדל (זמן ההגירה); מיישרים
-- אותן לפי created_at המקורי כדי לשמר את חלון 7 הימים המקורי.
update public.invitations
set expires_at = created_at + interval '7 days'
where expires_at <> created_at + interval '7 days';

-- get_invitation_by_token — משמר חתימה/טבלת-תוצאה/grant מדויקים ממיגרציה 015,
-- ומוסיף: הזמנה שפג תוקפה (expires_at <= now()) מוחזרת כסט ריק (כמו "לא נמצאה"),
-- כך שהמוזמן לא יכול לקבל אותה, ובלי לחשוף שהטוקן קיים אך פג.
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
  where i.token = p_token
    and i.expires_at > now(); -- הזמנה שפגה — כאילו לא נמצאה
end;
$$;

grant execute on function public.get_invitation_by_token(text) to anon, authenticated;

-- memberships_insert — מהדקים את ה-path של קבלת הזמנה כך שהזמנה שפגה לא תאפשר
-- יצירת חברות. שאר התנאים (org_id תואם, status='pending', אימייל תואם, user=self)
-- נשמרים אחד-לאחד משכמת schema.sql:331-343, כדי לא לשבור קבלות תקפות.
drop policy if exists memberships_insert on public.memberships;
create policy memberships_insert on public.memberships for insert with check (
  public.is_org_admin(org_id)
  -- מאפשר גם למוזמן ליצור לעצמו חברות בעת קבלת הזמנה תקפה (שלא פגה)
  or exists (
    select 1 from public.invitations i
    join public.profiles p on p.id = auth.uid()
    where i.org_id = memberships.org_id
      and i.status = 'pending'
      and i.expires_at > now()
      and lower(i.email) = lower(p.email)
      and memberships.user_id = auth.uid()
  )
);

-- ----------------------------------------------------------------------------
-- 4. אכיפת עקביות org_id בין ילד להורה (cross-tenant FK) — BEFORE INSERT/UPDATE
--    (סגנון טריגר לפי protect_super_admin_flag / protect_provider_payment_fields)
-- ----------------------------------------------------------------------------
-- items: board_id ו-group_id חייבים להשתייך לאותו org_id של ה-item. מדלגים על
-- עמודת FK שהיא NULL (אף שכיום שתיהן NOT NULL — הגנה עתידית).
create or replace function public.assert_items_org_consistency()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.board_id is not null and not exists (
    select 1 from public.boards b
    where b.id = new.board_id and b.org_id = new.org_id
  ) then
    raise exception 'cross-tenant reference: board % does not belong to org %', new.board_id, new.org_id;
  end if;

  if new.group_id is not null and not exists (
    select 1 from public.groups g
    where g.id = new.group_id and g.org_id = new.org_id
  ) then
    raise exception 'cross-tenant reference: group % does not belong to org %', new.group_id, new.org_id;
  end if;

  return new;
end;
$$;

drop trigger if exists assert_items_org_consistency_trigger on public.items;
create trigger assert_items_org_consistency_trigger
  before insert or update on public.items
  for each row execute function public.assert_items_org_consistency();

-- פונקציית טריגר — לא אמורה להיות ניתנת לקריאה כ-RPC דרך ה-REST API.
revoke all on function public.assert_items_org_consistency() from anon, authenticated, public;

-- payments: client_id חייב להשתייך לאותו org_id של התשלום.
create or replace function public.assert_payments_org_consistency()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.client_id is not null and not exists (
    select 1 from public.clients c
    where c.id = new.client_id and c.org_id = new.org_id
  ) then
    raise exception 'cross-tenant reference: client % does not belong to org %', new.client_id, new.org_id;
  end if;

  return new;
end;
$$;

drop trigger if exists assert_payments_org_consistency_trigger on public.payments;
create trigger assert_payments_org_consistency_trigger
  before insert or update on public.payments
  for each row execute function public.assert_payments_org_consistency();

-- פונקציית טריגר — לא אמורה להיות ניתנת לקריאה כ-RPC דרך ה-REST API.
revoke all on function public.assert_payments_org_consistency() from anon, authenticated, public;

-- ============================================================================
-- SQL Smoke Test (dev בלבד) — לא רץ כחלק מהמיגרציה. הסירו את ה-comment והריצו
-- ידנית ב-SQL editor של dev כדי לוודא את ה-RPC-ים והטריגרים.
-- ============================================================================
-- do $$
-- declare
--   v_org_id     uuid;
--   v_other_org  uuid;
--   v_client     uuid;
--   v_board      uuid;
--   v_group      uuid;
--   v_status_rows int;
--   v_total_rows  int;
--   v_blocked     boolean;
-- begin
--   select id into v_org_id from public.organizations order by created_at limit 1;
--   select id into v_other_org from public.organizations where id <> v_org_id limit 1;
--   if v_org_id is null then
--     raise notice 'no organizations — skipping smoke test';
--     return;
--   end if;
--
--   -- 2a. get_client_status_counts — אמור להחזיר שורה אחת לפחות פר status_id קיים
--   select count(*) into v_status_rows from public.get_client_status_counts(v_org_id);
--   raise notice 'get_client_status_counts returned % rows', v_status_rows;
--
--   -- 2b. get_payment_totals — ללא סינון, ואז עם סינון status
--   select count(*) into v_total_rows from public.get_payment_totals(v_org_id);
--   raise notice 'get_payment_totals (no filter) returned % rows', v_total_rows;
--   perform public.get_payment_totals(v_org_id, 'paid', now() - interval '30 days', now());
--
--   -- 3. תפוגת הזמנה: הזמנה שפגה לא מוחזרת
--   -- (הכניסו invitation עם expires_at בעבר ובדקו ש-get_invitation_by_token ריק)
--
--   -- 4. cross-tenant: ניסיון לקשר payment ללקוח מארגון אחר אמור להיכשל
--   if v_other_org is not null then
--     select id into v_client from public.clients where org_id = v_other_org limit 1;
--     if v_client is not null then
--       v_blocked := false;
--       begin
--         insert into public.payments (org_id, client_id, amount)
--         values (v_org_id, v_client, 1);   -- לקוח מ-v_other_org תחת org=v_org_id
--       exception when others then
--         v_blocked := true;
--       end;
--       if v_blocked then
--         raise notice 'cross-tenant payment insert correctly BLOCKED';
--       else
--         raise warning 'cross-tenant payment insert was NOT blocked — check trigger';
--         -- ניקוי אם בטעות נכנס
--         delete from public.payments where org_id = v_org_id and client_id = v_client and amount = 1;
--       end if;
--     end if;
--   end if;
-- end $$;
