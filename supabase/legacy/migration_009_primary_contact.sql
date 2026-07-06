-- ============================================================================
-- מיגרציה 009 — איש קשר ראשי = הלקוח עצמו (כברירת מחדל)
--
-- מוסיף לטבלת clients את השדות הדרושים כדי לתמוך במצב שבו איש הקשר הראשי
-- הוא הלקוח עצמו (ברירת מחדל, ללא צורך במילוי נתונים), ורק כשמסמנים שאיש
-- הקשר שונה מהלקוח נשמרים עבורו שם/תפקיד/טלפון/אימייל נפרדים.
-- לא נוגע בטבלת contacts (רשימת אנשי הקשר הנוספים) — ללא שינוי שם.
-- הריצו ב-Supabase → SQL Editor. בטוח להריץ שוב (idempotent).
-- ============================================================================

alter table public.clients add column if not exists contact_is_self boolean not null default true;
alter table public.clients add column if not exists contact_name  text;
alter table public.clients add column if not exists contact_role  text;
alter table public.clients add column if not exists contact_phone text;
alter table public.clients add column if not exists contact_email text;
