-- ============================================================================
-- תיקון זרימת ההזמנות — פונקציית קריאה לפי טוקן.
-- הריצו את הקטע הזה ב-Supabase → SQL Editor (פעם אחת).
-- ============================================================================

create or replace function public.get_invitation_by_token(p_token text)
returns table (id uuid, org_id uuid, email text, role member_role, status invite_status, org_name text)
language sql stable security definer set search_path = public as $$
  select i.id, i.org_id, i.email, i.role, i.status, o.name
  from public.invitations i
  join public.organizations o on o.id = i.org_id
  where i.token = p_token;
$$;

grant execute on function public.get_invitation_by_token(text) to anon, authenticated;
