-- ============================================================================
-- מיגרציה 018 — זיהוי כפילויות בייבוא CSV של לקוחות (F7)
-- הריצו ב-Supabase → SQL Editor (בטוח להריץ שוב, idempotent).
--
-- הבעיה: ImportClientsModal מכניס כל שורה מהקובץ כלקוח חדש, בלי שום בדיקה
-- מול הלקוחות הקיימים של הארגון — ייבוא חוזר של אותו קובץ (או קובץ שמכיל
-- שורות שכבר קיימות) מכפיל את רשימת הלקוחות.
--
-- הפתרון: שני RPC-ים —
--   1. normalize_phone(text) — פונקציית עזר גנרית וטהורה (immutable): ספרות
--      בלבד, 9 הספרות האחרונות (כך ש-+972-52-1234567 ו-052-1234567 ייחשבו
--      זהים). נשארת גנרית בכוונה — ללא סף אורך-מינימום — כדי שתשמש שוב את
--      search_org במיגרציה 021 (ר' §10 טבלת סדר המיגרציות בספק).
--   2. find_import_duplicates(p_org_id, p_rows) — לכל שורה בקובץ ({i,name,
--      email,phone}) בודקת אם קיים לקוח לא-בארכיון של הארגון עם אותו שם
--      מנורמל, וגם (אימייל מנורמל תואם OR טלפון מנורמל תואם).
--
-- כלל הכפילות (ניתן ע"י המשתמש, מחייב — תואם אחד-לאחד את src/lib/importDedup.js,
-- ר' ההשוואה צד-לצד בהערות שם):
--   norm(name) תואם  AND  (norm(email) תואם  OR  norm(phone) תואם)
--   norm(name):  lower(trim), רווחים פנימיים מכווצים לרווח בודד.
--   norm(email): lower(trim); מחרוזת ריקה => לא נחשבת "יש אימייל".
--   norm(phone): ספרות בלבד, השוואה על 9 הספרות האחרונות; טלפון ריק/קצר
--     מדי (פחות מ-7 ספרות) לעולם לא נחשב תואם — לא ל-null ולא לעצמו. הסף
--     הזה אינו חלק מ-normalize_phone (השארנו אותה גנרית, ר' למעלה); הוא
--     נאכף כאן במפורש על שני הצדדים *לפני* השוואת normalize_phone.
--
-- ר' §7 (Item 6) ב-docs/superpowers/specs/2026-07-08-remediation-prd-and-tech-spec.md.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. normalize_phone — מנרמל טלפון: ספרות בלבד, 9 הספרות האחרונות.
--    מחזירה null עבור null/מחרוזת ריקה (ואם אחרי ניקוי הספרות לא נשאר כלום).
--    בכוונה *לא* אוכפת כאן סף-אורך מינימלי — זו אחריות הקורא (ר' סעיף 2).
-- ----------------------------------------------------------------------------
create or replace function public.normalize_phone(p text)
returns text
language sql immutable as $$
  select nullif(right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 9), '');
$$;

revoke all on function public.normalize_phone(text) from public;
grant execute on function public.normalize_phone(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. find_import_duplicates — בודק כל שורת ייבוא מול לקוחות קיימים (לא בארכיון)
--    של הארגון.
--    קלט  p_rows: jsonb array של  {i: int, name: text, email: text, phone: text}
--    פלט: jsonb array של {i, client_id, matched_on} — matched_on: 'email' | 'phone'
--    (אימייל מנצח אם שני התנאים מתקיימים בו-זמנית); עד התאמה אחת ראשונה לכל שורה.
-- ----------------------------------------------------------------------------
create or replace function public.find_import_duplicates(p_org_id uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'forbidden';
  end if;

  -- מכסת payload — ר' התבנית הזהה ב-ingest_lead (migration_006/017). השורות
  -- כאן הן שלישיות {i,name,email,phone} בלבד, כך ש-100KB מכסה בנוחות אלפי שורות.
  if length(p_rows::text) > 100000 then
    raise exception 'payload too large';
  end if;

  with rows as (
    select
      (row->>'i')::int as i,
      -- norm(name): lower(trim), רווחים פנימיים מכווצים לרווח בודד
      lower(regexp_replace(trim(coalesce(row->>'name', '')), '\s+', ' ', 'g')) as v_name,
      -- norm(email): lower(trim); מחרוזת ריקה => null (לא "יש אימייל")
      nullif(lower(trim(row->>'email')), '') as v_email,
      row->>'phone' as v_phone_raw,
      length(regexp_replace(coalesce(row->>'phone', ''), '\D', '', 'g')) as v_phone_digit_len
    from jsonb_array_elements(p_rows) as row
  ),
  matches as (
    select distinct on (r.i)
      r.i,
      c.id as client_id,
      case
        when r.v_email is not null and lower(trim(c.email)) = r.v_email then 'email'
        else 'phone'
      end as matched_on
    from rows r
    join public.clients c
      on c.org_id = p_org_id
      and c.is_archived = false
      and r.v_name <> ''
      and lower(regexp_replace(trim(coalesce(c.name, '')), '\s+', ' ', 'g')) = r.v_name
      and (
        -- norm(email) תואם
        (r.v_email is not null and lower(trim(c.email)) = r.v_email)
        or (
          -- norm(phone) תואם — רק כששני הצדדים מכילים לפחות 7 ספרות גולמיות
          r.v_phone_digit_len >= 7
          and length(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')) >= 7
          and public.normalize_phone(c.phone) = public.normalize_phone(r.v_phone_raw)
        )
      )
    -- אימייל מנצח אם שתי ההתאמות מתקיימות בו-זמנית עבור אותה שורה
    order by r.i,
      case when r.v_email is not null and lower(trim(c.email)) = r.v_email then 0 else 1 end
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'i', m.i,
    'client_id', m.client_id,
    'matched_on', m.matched_on
  ) order by m.i), '[]'::jsonb)
  into v_result
  from matches m;

  return v_result;
end;
$$;

revoke all on function public.find_import_duplicates(uuid, jsonb) from public;
grant execute on function public.find_import_duplicates(uuid, jsonb) to authenticated;
