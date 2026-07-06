-- ============================================================================
-- מיגרציה 002 — מחיקה רכה (archive), עמודת קבצים, ועמודת "נוצר בתאריך"
-- הריצו ב-Supabase → SQL Editor (פעם אחת).
-- ============================================================================

-- 1) דגלי מחיקה רכה — במקום מחיקה מה-DB
alter table public.columns add column if not exists is_archived boolean not null default false;
alter table public.groups  add column if not exists is_archived boolean not null default false;
alter table public.items   add column if not exists is_archived boolean not null default false;

-- 2) עמודת מערכת "נוצר בתאריך" לכל בורד קיים שאין לו כזו
insert into public.columns (org_id, board_id, name, type, settings, position)
select b.org_id, b.id, 'נוצר בתאריך', 'created_at', '{}'::jsonb, 9999
from public.boards b
where not exists (
  select 1 from public.columns c where c.board_id = b.id and c.type = 'created_at'
);

-- 3) אחסון קבצים — bucket פרטי + הרשאות לחברי הארגון
--    מוסכמת נתיב: {org_id}/{item_id}/{filename}
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

drop policy if exists attachments_read on storage.objects;
create policy attachments_read on storage.objects for select to authenticated
using (
  bucket_id = 'attachments'
  and public.is_org_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists attachments_insert on storage.objects;
create policy attachments_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'attachments'
  and public.is_org_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists attachments_update on storage.objects;
create policy attachments_update on storage.objects for update to authenticated
using (
  bucket_id = 'attachments'
  and public.is_org_member(((storage.foldername(name))[1])::uuid)
);
