-- ============================================================================
-- מיגרציה 011 — מחיקת משתמשים (הסרה מארגון / מחיקת חשבון) + הקשחת RLS
-- הריצו ב-Supabase → SQL Editor. בטוח להריץ שוב (idempotent).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. delete_user — פעולה מאוחדת מארגון מסוים:
--    יעד בכמה ארגונים → הסרה מהארגון הזה; יעד בארגון יחיד → מחיקת חשבון מלאה.
--    כל בדיקות ההרשאה מתבצעות כאן (מקור אמת יחיד).
-- ----------------------------------------------------------------------------
create or replace function public.delete_user(p_user_id uuid, p_org_id uuid)
returns text
language plpgsql security definer set search_path = public, auth as $$
declare
  v_target_role   member_role;
  v_target_super  boolean;
  v_total_mships  int;
begin
  if not (public.is_super_admin() or public.is_org_admin(p_org_id)) then
    raise exception 'not authorized';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'cannot delete yourself';
  end if;

  select role into v_target_role
  from public.memberships
  where org_id = p_org_id and user_id = p_user_id;
  if v_target_role is null then
    raise exception 'user is not a member of this org';
  end if;

  select is_super_admin into v_target_super
  from public.profiles where id = p_user_id;
  if v_target_super then
    raise exception 'cannot delete a super admin';
  end if;

  if v_target_role = 'admin' and not public.is_super_admin() then
    raise exception 'only super admin can delete an admin';
  end if;

  select count(*) into v_total_mships
  from public.memberships where user_id = p_user_id;

  if v_total_mships > 1 then
    delete from public.memberships
    where org_id = p_org_id and user_id = p_user_id;
    return 'removed_from_org';
  else
    delete from auth.users where id = p_user_id;
    return 'account_deleted';
  end if;
end;
$$;

revoke all on function public.delete_user(uuid, uuid) from public, anon;
grant execute on function public.delete_user(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. delete_user_account — מחיקת חשבון מלאה מהעמוד הגלובלי (סופר-אדמין בלבד)
-- ----------------------------------------------------------------------------
create or replace function public.delete_user_account(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_super_admin() then
    raise exception 'not authorized';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot delete yourself';
  end if;
  if (select is_super_admin from public.profiles where id = p_user_id) then
    raise exception 'cannot delete a super admin';
  end if;
  delete from auth.users where id = p_user_id;
end;
$$;

revoke all on function public.delete_user_account(uuid) from public, anon;
grant execute on function public.delete_user_account(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. הקשחת מדיניות מחיקת חברויות:
--    סופר-אדמין → כל שורה; אדמין-ארגון רגיל → רק שורות של 'member'.
--    (מונע עקיפת הכלל "רק סופר-אדמין מוחק אדמין" דרך ה-REST API הישיר.)
-- ----------------------------------------------------------------------------
drop policy if exists memberships_delete on public.memberships;
create policy memberships_delete on public.memberships for delete using (
  public.is_super_admin()
  or (public.is_org_admin(org_id) and role = 'member')
);
