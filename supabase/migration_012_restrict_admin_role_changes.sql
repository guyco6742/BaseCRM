-- ============================================================================
-- מיגרציה 012 — הגבלת שינוי תפקיד של מנהל/ת: רק סופר-אדמין יכול לגעת בשורת
-- חברות שהתפקיד הנוכחי בה הוא 'admin' (הורדה בדרגה או כל עדכון אחר).
-- סוגר פרצה: אדמין-ארגון רגיל היה יכול להוריד מנהל/ת אחר/ת לדרגת עובד/ת
-- (memberships_update הקודמת לא הבחינה בין תפקידים) ואז למחוק אותו/ה כעובד/ת
-- רגיל/ה — ובכך לעקוף את הכלל "רק סופר-אדמין מוחק מנהל/ת" מהמיגרציה 011.
-- קידום עובד/ת לתפקיד מנהל/ת ע"י אדמין-ארגון רגיל ממשיך לעבוד כרגיל.
-- הריצו ב-Supabase → SQL Editor. בטוח להריץ שוב (idempotent).
-- ============================================================================

drop policy if exists memberships_update on public.memberships;
create policy memberships_update on public.memberships for update
using (
  public.is_super_admin()
  or (public.is_org_admin(org_id) and role = 'member')
)
with check (
  public.is_super_admin()
  or public.is_org_admin(org_id)
);
