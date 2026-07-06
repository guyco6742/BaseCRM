-- ============================================================================
-- BaseCRM — מיגרציה מאוחדת (בטוח להריץ שוב, idempotent)
-- הריצו הכל ב-Supabase → SQL Editor → New query → Run.
-- כולל: מחיקה רכה, עמודת קבצים, "נוצר בתאריך", ולוגו ארגון.
-- ============================================================================

-- ---- מחיקה רכה ----
alter table public.columns add column if not exists is_archived boolean not null default false;
alter table public.groups  add column if not exists is_archived boolean not null default false;
alter table public.items   add column if not exists is_archived boolean not null default false;

-- ---- עמודת מערכת "נוצר בתאריך" לכל בורד קיים ----
insert into public.columns (org_id, board_id, name, type, settings, position)
select b.org_id, b.id, 'נוצר בתאריך', 'created_at', '{}'::jsonb, 9999
from public.boards b
where not exists (select 1 from public.columns c where c.board_id = b.id and c.type = 'created_at');

-- ---- אחסון קבצים מצורפים (bucket פרטי) ----
insert into storage.buckets (id, name, public) values ('attachments','attachments', false)
on conflict (id) do nothing;

drop policy if exists attachments_read on storage.objects;
create policy attachments_read on storage.objects for select to authenticated
using (bucket_id = 'attachments' and public.is_org_member(((storage.foldername(name))[1])::uuid));

drop policy if exists attachments_insert on storage.objects;
create policy attachments_insert on storage.objects for insert to authenticated
with check (bucket_id = 'attachments' and public.is_org_member(((storage.foldername(name))[1])::uuid));

drop policy if exists attachments_update on storage.objects;
create policy attachments_update on storage.objects for update to authenticated
using (bucket_id = 'attachments' and public.is_org_member(((storage.foldername(name))[1])::uuid));

-- ---- לוגו לארגון ----
alter table public.organizations add column if not exists logo_url text;

-- bucket ציבורי ללוגואים (קריאה ציבורית כדי שאפשר יהיה להציג ב-<img>)
insert into storage.buckets (id, name, public) values ('logos','logos', true)
on conflict (id) do nothing;

drop policy if exists logos_read on storage.objects;
create policy logos_read on storage.objects for select
using (bucket_id = 'logos');

-- העלאה/עדכון לוגו — רק אדמין הארגון (או סופר-אדמין). נתיב: {org_id}/...
drop policy if exists logos_insert on storage.objects;
create policy logos_insert on storage.objects for insert to authenticated
with check (bucket_id = 'logos' and public.is_org_admin(((storage.foldername(name))[1])::uuid));

drop policy if exists logos_update on storage.objects;
create policy logos_update on storage.objects for update to authenticated
using (bucket_id = 'logos' and public.is_org_admin(((storage.foldername(name))[1])::uuid));

-- RPC לעדכון כתובת הלוגו על שורת הארגון (אדמין הארגון או סופר-אדמין בלבד)
create or replace function public.set_org_logo(p_org_id uuid, p_logo_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_org_admin(p_org_id) then
    raise exception 'not authorized';
  end if;
  update public.organizations set logo_url = p_logo_url where id = p_org_id;
end;
$$;

grant execute on function public.set_org_logo(uuid, text) to authenticated;
