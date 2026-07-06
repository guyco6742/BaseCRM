-- ============================================================================
-- מיגרציה 003 — השלמת "מחיקה רכה" לכל המבנה + חסימת מחיקה פיזית ברמת ה-DB
-- הריצו ב-Supabase → SQL Editor (בטוח להריץ שוב, idempotent).
-- ============================================================================

-- 1) דגלי השבתה גם לוורקספייסים, בורדים וארגונים
alter table public.organizations add column if not exists is_archived boolean not null default false;
alter table public.workspaces    add column if not exists is_archived boolean not null default false;
alter table public.boards        add column if not exists is_archived boolean not null default false;

-- 2) חסימת DELETE ברמת ה-DB על טבלאות תוכן:
--    מפצלים את מדיניות ה"כתיבה" (FOR ALL שכללה גם DELETE) ל-INSERT+UPDATE בלבד.
--    בהיעדר מדיניות DELETE — מחיקה נחסמת לכולם (גם דרך ה-API הישיר).
--    הערה: מחיקת ארגון ע"י סופר-אדמין עדיין אפשרית, וה-CASCADE של המערכת עוקף RLS.

-- workspaces
drop policy if exists workspaces_write  on public.workspaces;
drop policy if exists workspaces_insert on public.workspaces;
drop policy if exists workspaces_update on public.workspaces;
create policy workspaces_insert on public.workspaces for insert with check (public.is_org_admin(org_id));
create policy workspaces_update on public.workspaces for update using (public.is_org_admin(org_id));

-- boards
drop policy if exists boards_write  on public.boards;
drop policy if exists boards_insert on public.boards;
drop policy if exists boards_update on public.boards;
create policy boards_insert on public.boards for insert with check (public.is_org_admin(org_id));
create policy boards_update on public.boards for update using (public.is_org_admin(org_id));

-- columns
drop policy if exists columns_write  on public.columns;
drop policy if exists columns_insert on public.columns;
drop policy if exists columns_update on public.columns;
create policy columns_insert on public.columns for insert with check (public.is_org_admin(org_id));
create policy columns_update on public.columns for update using (public.is_org_admin(org_id));

-- groups
drop policy if exists groups_write  on public.groups;
drop policy if exists groups_insert on public.groups;
drop policy if exists groups_update on public.groups;
create policy groups_insert on public.groups for insert with check (public.is_org_admin(org_id));
create policy groups_update on public.groups for update using (public.is_org_admin(org_id));

-- items (כל חבר ארגון כותב — אבל לא מוחק)
drop policy if exists items_write  on public.items;
drop policy if exists items_insert on public.items;
drop policy if exists items_update on public.items;
create policy items_insert on public.items for insert with check (public.is_org_member(org_id));
create policy items_update on public.items for update using (public.is_org_member(org_id));
