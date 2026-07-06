-- ============================================================================
-- הקמת ארגון "טוניקה" — חוגים לילדים, מעקב פניות
-- שדות מותאמים לפי הגיליון "פניות 2026".
-- הריצו ב-Supabase → SQL Editor (בטוח להריץ שוב — לא ייווצר כפול).
-- ============================================================================

do $$
declare
  v_org uuid;
  v_creator uuid;
begin
  select id into v_creator from public.profiles where email = 'guyco42@gmail.com';
  select id into v_org from public.organizations where name = 'טוניקה' limit 1;

  if v_org is null then
    insert into public.organizations (name, slug, created_by)
    values ('טוניקה', 'tonika-' || floor(extract(epoch from now()))::text, v_creator)
    returning id into v_org;

    -- הטריגר יצר פייפליין ברירת מחדל — מחליפים בפייפליין פניות
    delete from public.client_statuses where org_id = v_org;
    insert into public.client_statuses (org_id, label, color, position) values
      (v_org, 'פנייה חדשה',   '#579bfc', 0),
      (v_org, 'יצירת קשר',    '#fdab3d', 1),
      (v_org, 'שיעור ניסיון', '#a25ddc', 2),
      (v_org, 'נרשם/ה',       '#00c875', 3),
      (v_org, 'לא רלוונטי',   '#c4c4c4', 4);

    -- שדות מותאמים לפי עמודות הגיליון (מעבר לשם/טלפון/הערות/סטטוס שהם שדות בסיס)
    insert into public.client_fields (org_id, name, type, settings, position) values
      (v_org, 'שם הילד/ה',   'text',   '{}'::jsonb, 0),
      (v_org, 'גיל',          'number', '{"unit":""}'::jsonb, 1),
      (v_org, 'מין',          'text',   '{}'::jsonb, 2),
      (v_org, 'עיר',          'text',   '{}'::jsonb, 3),
      (v_org, 'חוג',          'text',   '{}'::jsonb, 4),
      (v_org, 'שפה',          'text',   '{}'::jsonb, 5),
      (v_org, 'תאריך פניה',   'text',   '{}'::jsonb, 6),
      (v_org, 'מקור פניה',    'text',   '{}'::jsonb, 7),
      (v_org, 'להיתקשר ב-',   'text',   '{}'::jsonb, 8);

    raise notice 'Created org טוניקה with id %', v_org;
  else
    raise notice 'org טוניקה already exists (id %) — skipping', v_org;
  end if;
end $$;
