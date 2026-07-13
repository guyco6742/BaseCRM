-- ============================================================================
-- מיגרציה 019 — אינדקסי טריגרם לחיפוש טקסט חופשי בלקוחות (חלק מ-Item 7, עימוד — F8)
-- הריצו ב-Supabase → SQL Editor (בטוח להריץ שוב, idempotent).
--
-- הבעיה: עם עימוד בצד השרת, ClientsPage מבצע חיפוש "מכיל" (ilike '%q%') על
-- name/email/phone ישירות מול ה-DB עם count מדויק לכל הקלדה (עם debounce).
-- ilike עם % מוביל (infix search) לא יכול להשתמש באינדקס btree רגיל —
-- idx_clients_org_lower_name (מיגרציה 017) עוזר רק לחיפוש prefix. בלי אינדקס
-- מתאים, כל חיפוש הוא סריקה מלאה (Seq Scan) של טבלת clients.
--
-- הפתרון: הרחבת pg_trgm + אינדקס GIN לכל אחת משלוש עמודות החיפוש
-- (name/email/phone) — מאפשר ל-Postgres להשתמש באינדקס גם לתבניות ilike
-- infix (%q%), לא רק prefix.
--
-- הערה חשובה על org_id: אי אפשר לבנות אינדקס GIN יחיד שמשלב גם org_id וגם
-- trigram-similarity על טקסט (זה לא מקרה composite רגיל — GIN על טקסט לא
-- תומך בעמודת שוויון נוספת באותו אינדקס בצורה שימושית כאן). זה בסדר: ה-planner
-- משלב bitmap scan בין אינדקס ה-GIN החדש (מסנן לפי דמיון-טקסט) לבין
-- idx_clients_org_status / idx_clients_org_lower_name הקיימים (ממיגרציה 017,
-- מסננים לפי org_id) לפי הסלקטיביות בפועל של השאילתה — כלומר סינון org_id
-- עדיין יעיל, רק לא "בתוך" אותו אינדקס טריגרם עצמו.
-- ============================================================================

create extension if not exists pg_trgm;

create index if not exists idx_clients_name_trgm on public.clients using gin (name gin_trgm_ops);
create index if not exists idx_clients_email_trgm on public.clients using gin (email gin_trgm_ops);
create index if not exists idx_clients_phone_trgm on public.clients using gin (phone gin_trgm_ops);
