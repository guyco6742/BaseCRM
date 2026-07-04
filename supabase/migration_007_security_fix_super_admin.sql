-- ============================================================================
-- מיגרציה 007 — תיקון אבטחה קריטי: מניעת שדרוג-עצמי לסופר-אדמין
--
-- הבעיה: מדיניות ה-RLS על profiles הייתה
--   "for update using (id = auth.uid())"
-- בלי WITH CHECK, מה שאפשר לכל משתמש מחובר לעדכן את כל השורה שלו —
-- כולל is_super_admin — ולהעניק לעצמו הרשאת סופר-אדמין מלאה על כל
-- הארגונים במערכת! אומת בפועל: משתמש רגיל הצליח לשנות את עצמו
-- ל-is_super_admin=true דרך קריאת update רגילה.
--
-- התיקון: טריגר שמאפס בחזרה כל ניסיון שינוי ל-is_super_admin שלא בוצע
-- ע"י סופר-אדמין קיים (נבדק לפי המצב לפני העדכון, כי זה BEFORE trigger).
-- הריצו ב-Supabase → SQL Editor. בטוח להריץ שוב.
-- ============================================================================

create or replace function public.protect_super_admin_flag()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_super_admin is distinct from old.is_super_admin then
    if not public.is_super_admin() then
      -- לא סופר-אדמין קיים מנסה לשנות את הדגל — מתעלמים מהשינוי ומשאירים כמות שהיה
      new.is_super_admin := old.is_super_admin;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_super_admin_flag_trigger on public.profiles;
create trigger protect_super_admin_flag_trigger
  before update on public.profiles
  for each row execute function public.protect_super_admin_flag();
