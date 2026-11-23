-- Already applied to the Supabase project "nazeers-parts-board" (oregkflpywtkdkqfrpbz).
-- Kept here as a record, and to set up a fresh project the same way.
-- Nazeer's Motor Spares: shared attendance & pay records.
-- Every member (owner and manager) sees and edits the same records. Nobody else sees anything.

create schema if not exists nms_private;

create table public.nms_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'manager' check (role in ('owner', 'manager')),
  name text not null default '',
  created_at timestamptz not null default now()
);

create or replace function nms_private.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.nms_members where user_id = (select auth.uid()));
$$;
revoke all on function nms_private.is_member() from public, anon;
grant usage on schema nms_private to authenticated;
grant execute on function nms_private.is_member() to authenticated;

alter table public.nms_members enable row level security;
create policy "members can see who else is a member" on public.nms_members
  for select to authenticated using ((select nms_private.is_member()));

-- one row per record: settings, employee, mark (one person on one day), closed day, advance, payment
create table public.nms_records (
  kind text not null check (kind in ('settings', 'employee', 'mark', 'closed', 'advance', 'payment')),
  id text not null check (length(id) between 1 and 120),
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) < 200000),
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (kind, id)
);
create index nms_records_updated_at on public.nms_records (updated_at);

create or replace function nms_private.stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end;
$$;
create trigger nms_records_stamp before insert or update on public.nms_records
  for each row execute function nms_private.stamp();

alter table public.nms_records enable row level security;
create policy "members read records" on public.nms_records
  for select to authenticated using ((select nms_private.is_member()));
create policy "members add records" on public.nms_records
  for insert to authenticated with check ((select nms_private.is_member()));
create policy "members change records" on public.nms_records
  for update to authenticated using ((select nms_private.is_member())) with check ((select nms_private.is_member()));
-- no delete policy: records are marked deleted so other devices learn about it

revoke all on public.nms_records, public.nms_members from anon;
revoke delete, truncate on public.nms_records from authenticated;
revoke insert, update, delete, truncate on public.nms_members from authenticated;
