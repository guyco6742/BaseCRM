-- ============================================================================
-- טוניקה — המרת שדות "בחירה מרשימה" לשדות מסוג status (תגיות צבעוניות)
-- ממשיך את supabase/setup_org_tonika.sql. הריצו ב-Supabase → SQL Editor.
-- בטוח להריץ שוב (אידמפוטנטי): שדה שכבר הומר לא ייגע, וה-UUID של התוויות לא ישוחזר.
--
-- מקור הרשימות: הגיליון "פניות 2026" (הבחירות סופקו ע"י המשתמש).
--   סטטוס (פייפליין):  פניה חדשה / לחזור לשיחה נוספת / הוזמן לשיעור נסיון /
--                      משתתף בחוג / לא מתאים / רשימת המתנה / המתנה לשנה הבאה
--   מקור פניה:         פרסום שלנו / המלצה ממשתתפים / גוגל / המלצות ברשת / לא ידוע
--   מין:               בן / בת
--   עיר:               חיפה / מוצקין
--   חוג:               ריתמוזיקה / יצירות מוסקליות / שרים ומנגנים א' /
--                      שרים ומנגנים ב' / מחזמר / פיתוח קול
--   שפה:               עברית / רוסית
-- שדות שנשארים כמות שהם: שם הילד/ה (טקסט), גיל (מספר), תאריך פניה, להיתקשר ב-.
-- ============================================================================

do $$
declare
  v_org uuid;
begin
  select id into v_org from public.organizations where name = 'טוניקה' limit 1;

  if v_org is null then
    raise notice 'org טוניקה לא נמצא — הריצו קודם setup_org_tonika.sql';
    return;
  end if;

  -- ==========================================================================
  -- 1) פייפליין הסטטוסים (client_statuses) — מוחלף לרשימה מהגיליון.
  --    מחיקה + הזרקה מחדש רק אם אין לקוחות שכבר משויכים לסטטוס (טוניקה עדיין ריקה),
  --    כדי לא לשבור מפתח זר clients.status_id.
  -- ==========================================================================
  if not exists (select 1 from public.clients c
                 where c.org_id = v_org and c.status_id is not null) then
    delete from public.client_statuses where org_id = v_org;
    insert into public.client_statuses (org_id, label, color, position) values
      (v_org, 'פניה חדשה',          '#579bfc', 0),
      (v_org, 'לחזור לשיחה נוספת',  '#fdab3d', 1),
      (v_org, 'הוזמן לשיעור נסיון', '#a25ddc', 2),
      (v_org, 'משתתף בחוג',         '#00c875', 3),
      (v_org, 'לא מתאים',           '#e2445c', 4),
      (v_org, 'רשימת המתנה',        '#66ccff', 5),
      (v_org, 'המתנה לשנה הבאה',    '#c4c4c4', 6);
    raise notice 'פייפליין טוניקה עודכן (7 סטטוסים)';
  else
    raise notice 'לטוניקה יש לקוחות עם סטטוס — הפייפליין לא הוחלף אוטומטית (ערכו ידנית)';
  end if;

  -- ==========================================================================
  -- 2) שדות בחירה (client_fields) — המרה במקום ל-type=status עם labels.
  --    השארת אותו id/מיקום. WHERE type <> 'status' → אידמפוטנטי (לא מריצים שוב).
  --    פורמט ה-settings זהה למנוע העמודות של הבורד: { labels:[{id,label,color}] }.
  -- ==========================================================================

  -- מין
  update public.client_fields set type = 'status',
    settings = jsonb_build_object('labels', jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid()::text, 'label', 'בן', 'color', '#579bfc'),
      jsonb_build_object('id', gen_random_uuid()::text, 'label', 'בת', 'color', '#e2445c')
    ))
  where org_id = v_org and name = 'מין' and type <> 'status';

  -- עיר
  update public.client_fields set type = 'status',
    settings = jsonb_build_object('labels', jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid()::text, 'label', 'חיפה',  'color', '#00c875'),
      jsonb_build_object('id', gen_random_uuid()::text, 'label', 'מוצקין', 'color', '#fdab3d')
    ))
  where org_id = v_org and name = 'עיר' and type <> 'status';

  -- חוג
  update public.client_fields set type = 'status',
    settings = jsonb_build_object('labels', jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid()::text, 'label', 'ריתמוזיקה',         'color', '#579bfc'),
      jsonb_build_object('id', gen_random_uuid()::text, 'label', 'יצירות מוסקליות',   'color', '#a25ddc'),
      jsonb_build_object('id', gen_random_uuid()::text, 'label', 'שרים ומנגנים א''',  'color', '#00c875'),
      jsonb_build_object('id', gen_random_uuid()::text, 'label', 'שרים ומנגנים ב''',  'color', '#fdab3d'),
      jsonb_build_object('id', gen_random_uuid()::text, 'label', 'מחזמר',             'color', '#e2445c'),
      jsonb_build_object('id', gen_random_uuid()::text, 'label', 'פיתוח קול',         'color', '#66ccff')
    ))
  where org_id = v_org and name = 'חוג' and type <> 'status';

  -- שפה
  update public.client_fields set type = 'status',
    settings = jsonb_build_object('labels', jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid()::text, 'label', 'עברית', 'color', '#579bfc'),
      jsonb_build_object('id', gen_random_uuid()::text, 'label', 'רוסית', 'color', '#fdab3d')
    ))
  where org_id = v_org and name = 'שפה' and type <> 'status';

  -- מקור פניה
  update public.client_fields set type = 'status',
    settings = jsonb_build_object('labels', jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid()::text, 'label', 'פרסום שלנו',      'color', '#579bfc'),
      jsonb_build_object('id', gen_random_uuid()::text, 'label', 'המלצה ממשתתפים',  'color', '#00c875'),
      jsonb_build_object('id', gen_random_uuid()::text, 'label', 'גוגל',            'color', '#fdab3d'),
      jsonb_build_object('id', gen_random_uuid()::text, 'label', 'המלצות ברשת',     'color', '#a25ddc'),
      jsonb_build_object('id', gen_random_uuid()::text, 'label', 'לא ידוע',         'color', '#c4c4c4')
    ))
  where org_id = v_org and name = 'מקור פניה' and type <> 'status';

  raise notice 'שדות הבחירה של טוניקה הומרו ל-status (מין, עיר, חוג, שפה, מקור פניה)';
end $$;
