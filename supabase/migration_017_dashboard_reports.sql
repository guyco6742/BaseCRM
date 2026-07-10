-- ============================================================================
-- מיגרציה 017 — דשבורד + דוחות פר-ארגון (F6), ואינדקסים תומכי-דפדוף (F8)
-- הריצו ב-Supabase → SQL Editor (בטוח להריץ שוב, idempotent).
--
-- הבעיה: אין שום מסך שמראה מצב-עסק (לידים החודש, פייפליין, תשלומים פתוחים,
-- משימות באיחור) — ואין דרך לדוח/לייצא נתונים מסוננים לפי תאריך. במקביל,
-- Item 7 (עימוד) צריך אינדקסים תומכים על clients/payments — ממוקמים כאן כי
-- שתי היכולות משתפות את אותן טבלאות ותבניות שאילתה.
--
-- הפתרון: שני RPC-ים בטוחים (security definer + guard is_org_member בשורה
-- הראשונה, בדיוק לפי המוסכמה שנקבעה ב-§7 Conventions):
--   1. get_org_dashboard(p_org_id) — payload אחד ל-KPI-ים + פייפליין + תשלומים
--      + משימות באיחור, בסריקה אחת פר-ישות (לא טבלאות זמניות).
--   2. get_org_report(p_org_id, p_report, p_from, p_to) — 4 דוחות מסוננים לפי
--      טווח תאריכים (עבור overdue_items הטווח מתעלם — נקודתי-בזמן, ר' §7).
-- ראו §7 (Item 5) ב-docs/superpowers/specs/2026-07-08-remediation-prd-and-tech-spec.md.
--
-- הנחת אזור-זמן: האפליקציה משרתת ארגונים בישראל בלבד. כל גבולות "היום" ו-
-- "החודש" (כאן ובדוחות) מחושבים באזור הזמן Asia/Jerusalem במפורש, ולא לפי
-- אזור-הזמן של סשן ה-DB (בד"כ UTC) — אחרת גבול היום/חודש היה זז ב-2-3 שעות.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. get_org_dashboard — payload יחיד לדשבורד הארגון
-- ----------------------------------------------------------------------------
create or replace function public.get_org_dashboard(p_org_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tz constant text := 'Asia/Jerusalem';
  v_today date;
  v_month_start timestamptz;
  v_next_month timestamptz;
  v_prev_month timestamptz;
  v_leads_this_month int;
  v_leads_prev_month int;
  v_new_clients_this_month int;
  v_pipeline jsonb;
  v_no_status_count int;
  v_payments jsonb;
  v_overdue_tasks int;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'forbidden';
  end if;

  -- כל גבולות "היום"/"החודש" מחושבים באזור הזמן Asia/Jerusalem (ר' הערה
  -- בראש הקובץ), ולא לפי אזור-הזמן של סשן ה-DB.
  v_today := (now() at time zone v_tz)::date;
  v_month_start := date_trunc('month', now() at time zone v_tz) at time zone v_tz;
  v_next_month := (date_trunc('month', now() at time zone v_tz) + interval '1 month') at time zone v_tz;
  v_prev_month := (date_trunc('month', now() at time zone v_tz) - interval '1 month') at time zone v_tz;

  -- לידים החודש הנוכחי / החודש הקודם (יומן leads הוא append-only)
  select count(*) into v_leads_this_month
  from public.leads
  where org_id = p_org_id
    and created_at >= v_month_start
    and created_at < v_next_month;

  select count(*) into v_leads_prev_month
  from public.leads
  where org_id = p_org_id
    and created_at >= v_prev_month
    and created_at < v_month_start;

  -- לקוחות חדשים (לא בארכיון) שנוצרו החודש
  select count(*) into v_new_clients_this_month
  from public.clients
  where org_id = p_org_id
    and is_archived = false
    and created_at >= v_month_start
    and created_at < v_next_month;

  -- פייפליין: כל שלבי הסטטוס הפעילים של הארגון, כולל שלבים עם 0 לקוחות,
  -- מסודר לפי position; ספירה = לקוחות לא-בארכיון בכל שלב.
  select coalesce(jsonb_agg(jsonb_build_object(
    'status_id', cs.id,
    'label', cs.label,
    'color', cs.color,
    'count', coalesce(cnt.count, 0)
  ) order by cs.position), '[]'::jsonb)
  into v_pipeline
  from public.client_statuses cs
  left join (
    select status_id, count(*) as count
    from public.clients
    where org_id = p_org_id and is_archived = false
    group by status_id
  ) cnt on cnt.status_id = cs.id
  where cs.org_id = p_org_id and cs.is_archived = false;

  -- לקוחות (לא בארכיון) בלי סטטוס תקין: status_id ריק, או מצביע לסטטוס
  -- שנמצא בארכיון (או לא קיים) — בלי הדלי הזה הם נעלמים בשקט מהפייפליין
  -- כי השאילתה למעלה נשענת על client_statuses הלא-בארכיון.
  select count(*) into v_no_status_count
  from public.clients c
  where c.org_id = p_org_id and c.is_archived = false
    and not exists (
      select 1 from public.client_statuses cs2
      where cs2.id = c.status_id and cs2.is_archived = false
    );

  if v_no_status_count > 0 then
    v_pipeline := coalesce(v_pipeline, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'status_id', null,
      'label', 'ללא סטטוס',
      'color', '#c4c4c4',
      'count', v_no_status_count
    ));
  end if;

  -- תשלומים (לא בארכיון): ממתינים (מונה+סכום), שולם החודש, ופיגורים
  -- (ממתין + תאריך יעד עבר) — סריקה אחת עם filter, לא שאילתות נפרדות.
  select jsonb_build_object(
    'pending_count', coalesce(count(*) filter (where status = 'pending'), 0),
    'pending_sum', coalesce(sum(amount) filter (where status = 'pending'), 0),
    'paid_this_month_sum', coalesce(sum(amount) filter (
      where status = 'paid'
        and paid_at >= v_month_start
        and paid_at < v_next_month
    ), 0),
    'overdue_count', coalesce(count(*) filter (where status = 'pending' and due_date < v_today), 0)
  )
  into v_payments
  from public.payments
  where org_id = p_org_id and is_archived = false;

  -- משימות באיחור: כל item (לא בארכיון) עם ערך בעמודת-תאריך (לא בארכיון) בעבר.
  -- הביטוי הרגולרי מגן על ה-cast ל-date (ערכים לא-תאריכיים בג'ייסון לא יפילו את השאילתה).
  select count(distinct i.id) into v_overdue_tasks
  from public.items i
  join public.columns c on c.board_id = i.board_id and c.type = 'date' and not c.is_archived
  where i.org_id = p_org_id and not i.is_archived
    and (i.values->>(c.id::text)) ~ '^\d{4}-\d{2}-\d{2}'
    and (i.values->>(c.id::text))::date < v_today;

  return jsonb_build_object(
    'leads_this_month', v_leads_this_month,
    'leads_prev_month', v_leads_prev_month,
    'new_clients_this_month', v_new_clients_this_month,
    'pipeline', v_pipeline,
    'payments', v_payments,
    'overdue_tasks', coalesce(v_overdue_tasks, 0)
  );
end;
$$;

revoke all on function public.get_org_dashboard(uuid) from public;
grant execute on function public.get_org_dashboard(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. get_org_report — 4 דוחות מסוננים לפי טווח תאריכים (p_from/p_to; null = ללא הגבלה)
--    p_to מתפרש כולל (עד סוף אותו יום, בזמן ישראל) — משווים created_at < p_to + 1 יום.
--    overdue_items מתעלם מהטווח בכוונה (דוח נקודתי-בזמן, ר' §7 Non-Goals).
-- ----------------------------------------------------------------------------
create or replace function public.get_org_report(p_org_id uuid, p_report text, p_from date, p_to date)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tz constant text := 'Asia/Jerusalem';
  v_today date;
  v_from_ts timestamptz;
  v_to_ts timestamptz;
  v_rows jsonb;
  v_no_status_count int;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'forbidden';
  end if;

  -- גבולות הטווח וה"היום" מחושבים באזור הזמן Asia/Jerusalem (ר' הערה בראש הקובץ),
  -- ולא לפי אזור-הזמן של סשן ה-DB.
  v_today := (now() at time zone v_tz)::date;
  v_from_ts := case when p_from is null then null else (p_from::timestamp at time zone v_tz) end;
  v_to_ts := case when p_to is null then null else ((p_to + 1)::timestamp at time zone v_tz) end;

  if p_report = 'leads_by_source_by_month' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'month', t.month,
      'source', t.source,
      'count', t.count,
      'deduped_count', t.deduped_count
    ) order by t.month, t.source), '[]'::jsonb)
    into v_rows
    from (
      select
        to_char(date_trunc('month', l.created_at at time zone v_tz), 'YYYY-MM') as month,
        coalesce(ls.name, 'ללא מקור') as source,
        count(*) as count,
        count(*) filter (where l.deduped) as deduped_count
      from public.leads l
      left join public.lead_sources ls on ls.id = l.source_id
      where l.org_id = p_org_id
        and (p_from is null or l.created_at >= v_from_ts)
        and (p_to is null or l.created_at < v_to_ts)
      group by 1, 2
    ) t;

  elsif p_report = 'payments_by_status' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'status', t.status,
      'count', t.count,
      'sum', t.sum
    ) order by t.status), '[]'::jsonb)
    into v_rows
    from (
      select p.status, count(*) as count, coalesce(sum(p.amount), 0) as sum
      from public.payments p
      where p.org_id = p_org_id and p.is_archived = false
        and (p_from is null or p.created_at >= v_from_ts)
        and (p_to is null or p.created_at < v_to_ts)
      group by p.status
    ) t;

  elsif p_report = 'clients_by_status' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'status_id', cs.id,
      'label', cs.label,
      'color', cs.color,
      'count', coalesce(cnt.count, 0)
    ) order by cs.position), '[]'::jsonb)
    into v_rows
    from public.client_statuses cs
    left join (
      select status_id, count(*) as count
      from public.clients
      where org_id = p_org_id and is_archived = false
        and (p_from is null or created_at >= v_from_ts)
        and (p_to is null or created_at < v_to_ts)
      group by status_id
    ) cnt on cnt.status_id = cs.id
    where cs.org_id = p_org_id and cs.is_archived = false;

    -- לקוחות (לא בארכיון, בתוך הטווח) בלי סטטוס תקין — אותה בעיית "היעלמות
    -- בשקט" כמו ב-get_org_dashboard, ר' ההערה המקבילה שם.
    select count(*) into v_no_status_count
    from public.clients c
    where c.org_id = p_org_id and c.is_archived = false
      and (p_from is null or c.created_at >= v_from_ts)
      and (p_to is null or c.created_at < v_to_ts)
      and not exists (
        select 1 from public.client_statuses cs2
        where cs2.id = c.status_id and cs2.is_archived = false
      );

    if v_no_status_count > 0 then
      v_rows := coalesce(v_rows, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'status_id', null,
        'label', 'ללא סטטוס',
        'color', '#c4c4c4',
        'count', v_no_status_count
      ));
    end if;

  elsif p_report = 'overdue_items' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'item_id', t.item_id,
      'item_name', t.item_name,
      'board_id', t.board_id,
      'board_name', t.board_name,
      'group_name', t.group_name,
      'due_date', t.due_date
    ) order by t.due_date asc), '[]'::jsonb)
    into v_rows
    from (
      -- הערה: שורה אחת פר (item, עמודת-תאריך) בכוונה — item עם כמה עמודות-תאריך
      -- באיחור יופיע כאן כמה פעמים, בניגוד ל-get_org_dashboard שסופר distinct(item.id).
      select
        i.id as item_id,
        i.name as item_name,
        b.id as board_id,
        b.name as board_name,
        g.name as group_name,
        (i.values->>(c.id::text))::date as due_date
      from public.items i
      join public.boards b on b.id = i.board_id
      join public.groups g on g.id = i.group_id
      join public.columns c on c.board_id = i.board_id and c.type = 'date' and not c.is_archived
      where i.org_id = p_org_id and not i.is_archived
        and (i.values->>(c.id::text)) ~ '^\d{4}-\d{2}-\d{2}'
        and (i.values->>(c.id::text))::date < v_today
    ) t;

  else
    raise exception 'unknown report';
  end if;

  return jsonb_build_object('report', p_report, 'rows', v_rows);
end;
$$;

revoke all on function public.get_org_report(uuid, text, date, date) from public;
grant execute on function public.get_org_report(uuid, text, date, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. אינדקסים תומכי-דפדוף (Item 7 — נחתים כאן כי הם משרתים גם את הדוחות)
-- ----------------------------------------------------------------------------
create index if not exists idx_clients_org_lower_name on public.clients (org_id, lower(name));
create index if not exists idx_clients_org_status on public.clients (org_id, status_id);
create index if not exists idx_payments_org_due on public.payments (org_id, due_date);
