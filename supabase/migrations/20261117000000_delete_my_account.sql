-- Lets a signed-in user permanently delete their own account.
-- Deleting the auth.users row cascades to public.user_profiles and from there
-- to every other FinFeast table (all use "on delete cascade").
-- security definer: runs with the function owner's rights so it can delete from
-- auth.users, but only ever the caller's own row (auth.uid()).
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication is required to delete an account';
  end if;

  delete from auth.users where id = current_user_id;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
