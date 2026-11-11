-- Physics - Samitha Rathnayake | Account profiles, stage 2
-- Run in your Supabase project's SQL Editor.
-- Before running, replace REPLACE_WITH_YOUR_LOGIN_EMAIL near the bottom.
-- This creates account profiles only; students and marks are not imported.

begin;

create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (
    char_length(display_name) between 1 and 100 and btrim(display_name) <> ''
  ),
  role text not null default 'marker' check (role in ('admin', 'marker')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Only trusted server/database operations may change profiles.
-- A browser cannot grant itself admin, change its name, or reactivate itself.
revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;

-- These helpers check the database on each request rather than trusting
-- user-editable login metadata. They avoid recursive profile policies.
create or replace function app_private.is_active_member()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and is_active
  );
$$;

create or replace function app_private.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and is_active and role = 'admin'
  );
$$;

revoke all on function app_private.is_active_member() from public, anon, authenticated;
revoke all on function app_private.is_admin() from public, anon, authenticated;
grant execute on function app_private.is_active_member() to authenticated;
grant execute on function app_private.is_admin() to authenticated;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
for select to authenticated
using (
  -- A disabled user may read their own status so the app can explain it.
  id = (select auth.uid())
  or (
    (select app_private.is_active_member())
    and (is_active or (select app_private.is_admin()))
  )
);

-- Accounts created in Authentication > Users receive a marker profile.
-- Never copy an admin role from user-editable metadata.
create or replace function app_private.create_marker_profile()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, role, is_active)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 'New marker'), 100),
    'marker',
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function app_private.create_marker_profile() from public, anon, authenticated;
drop trigger if exists physics_create_marker_profile on auth.users;
create trigger physics_create_marker_profile
after insert on auth.users
for each row execute function app_private.create_marker_profile();

-- Include accounts you created before this script, without changing profiles
-- or roles that already exist. Passwords are never copied.
insert into public.profiles (id, display_name, role, is_active)
select
  id,
  left(coalesce(nullif(btrim(raw_user_meta_data ->> 'display_name'), ''), 'New marker'), 100),
  'marker',
  true
from auth.users
on conflict (id) do nothing;

-- One-time setup for your own admin account.
-- EDIT THE EMAIL BELOW to the email you use to sign into the app.
do $$
declare
  owner_email text := 'REPLACE_WITH_YOUR_LOGIN_EMAIL';
  matched_users integer;
begin
  update public.profiles p
  set display_name = 'Sasindu', role = 'admin', is_active = true
  from auth.users u
  where p.id = u.id and lower(u.email) = lower(btrim(owner_email));

  get diagnostics matched_users = row_count;
  if matched_users <> 1 then
    raise exception 'Admin setup expected one matching account, found %. Check the login email in owner_email. No changes were saved.', matched_users;
  end if;
end;
$$;

commit;

-- Expected result: your row should say Sasindu | admin | true.
select display_name, role, is_active
from public.profiles
order by created_at;
