-- Run after 010. Existing users keep their access. No invitations are sent.
begin;
alter table public.profiles add column if not exists version bigint not null default 1;
grant select on public.profiles to service_role;
create table if not exists public.account_change_history(
 id uuid primary key default gen_random_uuid(),profile_id uuid not null references public.profiles(id),
 actor_id uuid not null references public.profiles(id),before_values jsonb not null,after_values jsonb not null,created_at timestamptz not null default now()
);
create table if not exists public.account_invitations(
 request_id uuid primary key,actor_id uuid not null references public.profiles(id),email text not null unique,
 display_name text not null,status text not null check(status in('Sending','Sent','Failed')),
 invited_user_id uuid references auth.users(id),attempted_at timestamptz not null default now(),created_at timestamptz not null default now()
);
alter table public.account_change_history enable row level security;
alter table public.account_invitations enable row level security;
revoke all on public.account_change_history,public.account_invitations from public,anon,authenticated;

create or replace function public.app_list_accounts(p_query text default '',p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not app_private.is_admin() then raise exception 'Only active admins can manage accounts.';end if;
 if p_offset is null or p_offset<0 or char_length(coalesce(p_query,''))>200 then raise exception 'Invalid account search.';end if;
 return coalesce((select jsonb_agg(to_jsonb(r)) from (
  select p.id,p.display_name,p.role,p.is_active,p.version,u.email,p.created_at
  from public.profiles p join auth.users u on u.id=p.id
  where strpos(lower(p.display_name),lower(btrim(coalesce(p_query,''))))>0 or strpos(lower(coalesce(u.email,'')),lower(btrim(coalesce(p_query,''))))>0
  order by p.created_at,p.id limit 100 offset p_offset) r),'[]'::jsonb);
end; $$;
create or replace function public.app_update_account(p_profile_id uuid,p_name text,p_role text,p_active boolean,p_expected_version bigint,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.profiles%rowtype;payload jsonb;result jsonb;name text:=regexp_replace(btrim(p_name),'\s+',' ','g');
begin
 if not app_private.is_admin() then raise exception 'Only active admins can manage accounts.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 payload:=jsonb_build_array('update account',p_profile_id,p_name,p_role,p_active,p_expected_version);
 result:=app_private.marks_receipt(p_request_id,payload);if result is not null then return result;end if;
 perform pg_advisory_xact_lock(hashtextextended('physics account administration',0));
 if not app_private.is_admin() then raise exception 'Your admin access changed. Sign in again.';end if;
 select * into old from public.profiles where id=p_profile_id for update;
 if not found then raise exception 'Account not found.';end if;
 if old.version is distinct from p_expected_version then raise exception 'Account changed. Refresh and review again.';end if;
 if name is null or char_length(name) not between 1 and 100 or p_role is null or p_role not in('admin','marker') or p_active is null then raise exception 'Enter a name, role and active status.';end if;
 if p_profile_id=auth.uid() and (not p_active or p_role<>'admin') then raise exception 'Ask another admin to disable or change your own admin role.';end if;
 if old.role='admin' and old.is_active and (not p_active or p_role<>'admin') and (select count(*) from public.profiles where role='admin' and is_active)<=1 then raise exception 'Keep at least one active admin.';end if;
 if (old.display_name,old.role,old.is_active) is distinct from (name,p_role,p_active) then
  update public.profiles set display_name=name,role=p_role,is_active=p_active,version=version+1 where id=old.id;
  insert into public.account_change_history(profile_id,actor_id,before_values,after_values)
   values(old.id,auth.uid(),jsonb_build_object('name',old.display_name,'role',old.role,'is_active',old.is_active),jsonb_build_object('name',name,'role',p_role,'is_active',p_active));
 end if;
 result:=jsonb_build_object('id',old.id);insert into public.marks_write_requests values(p_request_id,auth.uid(),payload,result,now());return result;
end; $$;

-- Only the authenticated server (secret API key) can reserve/send invitations.
create or replace function public.app_begin_account_invite(p_actor_id uuid,p_email text,p_name text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.account_invitations%rowtype;invite_email text:=lower(btrim(p_email));name text:=regexp_replace(btrim(p_name),'\s+',' ','g');
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server invitation access required.';end if;
 if not exists(select 1 from public.profiles where id=p_actor_id and role='admin' and is_active) then raise exception 'Only active admins can invite accounts.';end if;
 if p_request_id is null or invite_email is null or char_length(invite_email)>254 or invite_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or name is null or char_length(name) not between 1 and 100 then raise exception 'Enter a valid email and marker name.';end if;
 perform pg_advisory_xact_lock(hashtextextended('account invitation '||invite_email,0));
 select * into existing from public.account_invitations where request_id=p_request_id;
 if found then
  if existing.email<>invite_email or existing.display_name<>name then raise exception 'This invitation request belongs to another action.';end if;
  if existing.invited_user_id is not null or existing.status='Sent' then return jsonb_build_object('send',false,'status','Sent');end if;
  if existing.status='Sending' and existing.attempted_at>now()-interval '90 seconds' then return jsonb_build_object('send',false,'status','Sending');end if;
  update public.account_invitations set status='Sending',attempted_at=now() where request_id=p_request_id;
 else
  if exists(select 1 from auth.users u where lower(u.email)=invite_email) then raise exception 'This email already has an account. Use the account list or password reset.';end if;
  if exists(select 1 from public.account_invitations i where i.email=invite_email) then raise exception 'An invitation for this email already exists. Retry its original request or check the account list.';end if;
  insert into public.account_invitations(request_id,actor_id,email,display_name,status) values(p_request_id,p_actor_id,invite_email,name,'Sending');
 end if;
 return jsonb_build_object('send',true,'email',invite_email,'display_name',name,'status','Sending');
end; $$;
create or replace function public.app_finish_account_invite(p_request_id uuid,p_sent boolean)
returns void language plpgsql security definer set search_path='' as $$
declare invite public.account_invitations%rowtype;user_id uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server invitation access required.';end if;
 select * into invite from public.account_invitations where request_id=p_request_id for update;
 if not found then raise exception 'Invitation request not found.';end if;
 select u.id into user_id from auth.users u where lower(u.email)=invite.email and u.invited_at is not null and u.created_at>=invite.created_at-interval '5 seconds';
 if p_sent and user_id is null then raise exception 'Invited account is not ready. Retry the same request.';end if;
 if user_id is not null then
  -- Auth may set invited_at after inserting the user. Activate only after the
  -- trusted invite endpoint has created an invited account for this request.
  update public.profiles set display_name=invite.display_name,is_active=true,version=version+1 where id=user_id and not is_active and version=1;
 end if;
 update public.account_invitations set invited_user_id=user_id,status=case when user_id is not null then 'Sent' else 'Failed' end where request_id=p_request_id;
end; $$;

create or replace function public.app_list_account_invitations()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not app_private.is_admin() then raise exception 'Only active admins can manage invitations.';end if;
 return coalesce((select jsonb_agg(to_jsonb(r)) from(select i.request_id,i.email,i.display_name,i.status,i.created_at,p.display_name as created_by from public.account_invitations i join public.profiles p on p.id=i.actor_id order by i.created_at desc,i.request_id limit 100) r),'[]'::jsonb);
end; $$;

-- Existing profiles are unchanged. New access requires an admin invitation,
-- never a role or active flag supplied through user-editable auth metadata.
create or replace function app_private.create_marker_profile()
returns trigger language plpgsql security definer set search_path='' as $$
declare invite public.account_invitations%rowtype;
begin
 select * into invite from public.account_invitations i where i.email=lower(new.email) and i.status='Sending' and i.attempted_at>now()-interval '90 seconds' for update;
 insert into public.profiles(id,display_name,role,is_active)
 values(new.id,case when invite.request_id is not null and new.invited_at is not null then invite.display_name else 'Awaiting admin approval' end,'marker',invite.request_id is not null and new.invited_at is not null)
 on conflict(id) do nothing;
 if invite.request_id is not null and new.invited_at is not null then update public.account_invitations set invited_user_id=new.id where request_id=invite.request_id;end if;
 return new;
end; $$;
revoke all on function public.app_list_accounts(text,integer),public.app_list_account_invitations(),public.app_update_account(uuid,text,text,boolean,bigint,uuid) from public,anon,authenticated;
grant execute on function public.app_list_accounts(text,integer),public.app_list_account_invitations(),public.app_update_account(uuid,text,text,boolean,bigint,uuid) to authenticated;
revoke all on function public.app_begin_account_invite(uuid,text,text,uuid),public.app_finish_account_invite(uuid,boolean) from public,anon,authenticated;
grant execute on function public.app_begin_account_invite(uuid,text,text,uuid),public.app_finish_account_invite(uuid,boolean) to service_role;
revoke all on function app_private.create_marker_profile() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
