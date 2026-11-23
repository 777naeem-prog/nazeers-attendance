-- Already applied to the Supabase project "nazeers-parts-board" (oregkflpywtkdkqfrpbz).
-- Owner-only: one shared login for the owner's family. The manager login was removed.
delete from auth.users where email = 'manager@nms-staff.invalid';
-- nms_reset_login (see 002) now also lets the owner replace the shared login's own link
-- (lost phone): every phone that used the old link is signed out at once.
create or replace function public.nms_reset_login(target_user uuid, new_secret text)
returns text
language plpgsql security definer set search_path = '' as $$
declare caller_role text; target_email text;
begin
  select role into caller_role from public.nms_members where user_id = (select auth.uid());
  if caller_role is distinct from 'owner' then
    raise exception 'Only the owner can do this' using errcode = '42501';
  end if;
  if length(coalesce(new_secret, '')) < 24 then
    raise exception 'Secret too short' using errcode = '22023';
  end if;
  if not exists (select 1 from public.nms_members where user_id = target_user) then
    raise exception 'Not a member' using errcode = '22023';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(new_secret, extensions.gen_salt('bf')),
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"must_change_password": false}'::jsonb,
         updated_at = now()
   where id = target_user
  returning email into target_email;
  delete from auth.sessions where user_id = target_user;
  return split_part(target_email, '@', 1);
end;
$$;
revoke all on function public.nms_reset_login(uuid, text) from public, anon;
grant execute on function public.nms_reset_login(uuid, text) to authenticated;
