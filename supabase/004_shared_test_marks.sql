-- Run after 001, 002 and 003. Preserves existing students and browser practice data.
begin;
create table if not exists public.marks_tests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.exam_groups(id),
  phase text not null check (char_length(phase) between 1 and 100 and btrim(phase) <> ''),
  paper integer not null check (paper between 1 and 999),
  test_date date not null,
  max_cents integer not null check (max_cents between 1 and 100000000),
  status text not null default 'Open' check (status in ('Open','Closed','Cancelled')),
  revision bigint not null default 1,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(id,group_id)
);
create unique index if not exists marks_tests_paper_unique on public.marks_tests(group_id,lower(phase),paper);
create unique index if not exists enrolments_id_group_unique on public.enrolments(id,group_id);
create table if not exists public.test_participants (
  test_id uuid not null references public.marks_tests(id),
  marker_id uuid not null references public.profiles(id),
  batch_revision bigint not null default 0,
  submitted_revision bigint,
  submitted_at timestamptz,
  primary key(test_id,marker_id)
);
create table if not exists public.test_scores (
  test_id uuid not null,
  enrolment_id uuid not null,
  group_id uuid not null,
  cents integer not null check(cents >= 0),
  marker_id uuid references public.profiles(id),
  source text not null check(source in ('Paper','Zero fill')),
  version bigint not null default 1,
  is_deleted boolean not null default false,
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key(test_id,enrolment_id),
  foreign key(test_id,group_id) references public.marks_tests(id,group_id),
  foreign key(enrolment_id,group_id) references public.enrolments(id,group_id)
);
create table if not exists public.test_mark_history (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.marks_tests(id),
  enrolment_id uuid references public.enrolments(id),
  actor_id uuid not null references public.profiles(id),
  action text not null,
  before_cents integer,
  after_cents integer,
  created_at timestamptz not null default now()
);
create index if not exists test_mark_history_test_index on public.test_mark_history(test_id,created_at);
create table if not exists public.marks_write_requests (
  request_id uuid primary key,
  actor_id uuid not null references public.profiles(id),
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.marks_tests enable row level security;
alter table public.test_participants enable row level security;
alter table public.test_scores enable row level security;
alter table public.test_mark_history enable row level security;
alter table public.marks_write_requests enable row level security;
revoke all on public.marks_tests, public.test_participants, public.test_scores, public.test_mark_history, public.marks_write_requests from public,anon,authenticated;
grant select on public.marks_tests, public.test_participants, public.test_scores, public.test_mark_history to authenticated;
drop policy if exists marks_tests_read on public.marks_tests;
create policy marks_tests_read on public.marks_tests for select to authenticated using ((select app_private.is_active_member()));
drop policy if exists test_participants_read on public.test_participants;
create policy test_participants_read on public.test_participants for select to authenticated using ((select app_private.is_active_member()));
drop policy if exists test_scores_read on public.test_scores;
create policy test_scores_read on public.test_scores for select to authenticated using ((select app_private.is_active_member()));
drop policy if exists test_mark_history_read on public.test_mark_history;
create policy test_mark_history_read on public.test_mark_history for select to authenticated using ((select app_private.is_admin()));

-- All writers take group then test locks, serialising with archive and student
-- status writes. A close cannot race past a score save or batch submission.
create or replace function app_private.lock_marks_test(p_test_id uuid)
returns public.marks_tests language plpgsql security definer set search_path = '' as $$
declare t public.marks_tests%rowtype; g public.exam_groups%rowtype;
begin
  if not app_private.is_active_member() then raise exception 'An active account is required.'; end if;
  select * into t from public.marks_tests where id=p_test_id;
  if not found then raise exception 'Test not found.'; end if;
  select * into g from public.exam_groups where id=t.group_id for update;
  if g.is_archived then raise exception 'Archived groups are read-only. Restore the group first.'; end if;
  select * into t from public.marks_tests where id=p_test_id for update;
  return t;
end; $$;

create or replace function app_private.marks_receipt(p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.marks_write_requests%rowtype;
begin
  if p_request_id is null then raise exception 'A save request ID is required.'; end if;
  select * into r from public.marks_write_requests where request_id=p_request_id;
  if not found then return null; end if;
  if r.actor_id is distinct from auth.uid() or r.payload is distinct from p_payload then
    raise exception 'This request ID was already used for a different save.';
  end if;
  return r.result;
end; $$;

create or replace function public.app_create_marks_test(
 p_group_id uuid,p_phase text,p_paper integer,p_date date,p_max_text text,p_markers uuid[],p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare g public.exam_groups%rowtype; result jsonb; tid uuid; maximum integer; payload jsonb;
begin
  if not app_private.is_admin() then raise exception 'Only active admins can create tests.'; end if;
  -- Locks the request ID globally even if a bad retry switches exam groups.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  payload:=jsonb_build_array('create',p_group_id,p_phase,p_paper,p_date,p_max_text,p_markers);
  result:=app_private.marks_receipt(p_request_id,payload); if result is not null then return result; end if;
  select * into g from public.exam_groups where id=p_group_id for update;
  if not found then raise exception 'Exam group not found.'; end if;
  if g.is_archived then raise exception 'Archived groups are read-only.'; end if;
  if p_phase is null or char_length(btrim(p_phase)) not between 1 and 100 or p_paper is null or p_paper not between 1 and 999 or p_date is null then
    raise exception 'Enter a phase, paper number and date.';
  end if;
  if p_max_text is null or p_max_text !~ '^[0-9]{1,7}(\.[0-9]{1,2})?$' then raise exception 'Enter a positive maximum with up to two decimal places.'; end if;
  if p_max_text::numeric*100 not between 1 and 100000000 then raise exception 'Maximum marks must be greater than zero and no more than 1000000.'; end if;
  maximum:=(p_max_text::numeric*100)::integer;
  if coalesce(cardinality(p_markers),0)=0 or exists(select 1 from unnest(p_markers) x where x is null or not exists(select 1 from public.profiles p where p.id=x and p.is_active)) then
    raise exception 'Choose at least one active participating marker.';
  end if;
  if exists(select 1 from public.marks_tests where group_id=p_group_id and lower(phase)=lower(btrim(p_phase)) and paper=p_paper) then
    raise exception 'This phase and paper already exist in this exam group.';
  end if;
  insert into public.marks_tests(group_id,phase,paper,test_date,max_cents,created_by)
    values(p_group_id,btrim(p_phase),p_paper,p_date,maximum,auth.uid()) returning id into tid;
  insert into public.test_participants(test_id,marker_id) select tid,x from (select distinct unnest(p_markers) x) q;
  insert into public.test_mark_history(test_id,actor_id,action) values(tid,auth.uid(),'Created test');
  result:=jsonb_build_object('id',tid);
  insert into public.marks_write_requests values(p_request_id,auth.uid(),payload,result,now());
  return result;
end; $$;

create or replace function public.app_save_test_score(
 p_test_id uuid,p_enrolment_id uuid,p_text text,p_expected_version bigint,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.marks_tests%rowtype; e public.enrolments%rowtype; old public.test_scores%rowtype;
 value integer; ver bigint; result jsonb; payload jsonb; owner_id uuid; own_batch boolean;
begin
  if not app_private.is_active_member() then raise exception 'An active account is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  payload:=jsonb_build_array('score',p_test_id,p_enrolment_id,p_text,p_expected_version);
  result:=app_private.marks_receipt(p_request_id,payload); if result is not null then return result; end if;
  t:=app_private.lock_marks_test(p_test_id);
  if t.status<>'Open' then raise exception 'This test is not open. Your draft has been kept.'; end if;
  select * into e from public.enrolments where id=p_enrolment_id;
  if not found or e.group_id<>t.group_id or not e.is_active then raise exception 'Choose an active student in this exam group.'; end if;
  select * into old from public.test_scores where test_id=p_test_id and enrolment_id=p_enrolment_id for update;
  if p_expected_version is distinct from coalesce(old.version,0) then
    raise exception 'This score changed since you started editing. Refresh and review the saved value before retrying.';
  end if;
  if old.test_id is not null and not old.is_deleted then
    owner_id:=old.marker_id;
    if owner_id is distinct from auth.uid() and not app_private.is_admin() then
      raise exception 'This score belongs to another marker or an admin zero-fill. Ask an admin to review it.';
    end if;
  else owner_id:=auth.uid(); end if;
  own_batch:=owner_id is not distinct from auth.uid();
  if own_batch and not exists(select 1 from public.test_participants where test_id=p_test_id and marker_id=auth.uid()) then
    raise exception 'You are not a participating marker for this test.';
  end if;
  if p_text is null or p_text !~ '^[0-9]{1,7}(\.[0-9]{1,2})?$' then raise exception 'Enter a score with up to two decimal places.'; end if;
  if p_text::numeric*100 > t.max_cents then raise exception 'Score exceeds this test maximum.'; end if;
  value:=(p_text::numeric*100)::integer;
  if old.test_id is not null and not old.is_deleted and old.cents=value then
    result:=jsonb_build_object('version',old.version,'cents',value);
  else
    insert into public.test_scores(test_id,enrolment_id,group_id,cents,marker_id,source,updated_by)
      values(p_test_id,p_enrolment_id,t.group_id,value,owner_id,'Paper',auth.uid())
    on conflict(test_id,enrolment_id) do update set cents=excluded.cents,marker_id=excluded.marker_id,
      source=case when public.test_scores.is_deleted then 'Paper' else public.test_scores.source end,
      is_deleted=false,version=public.test_scores.version+1,updated_by=auth.uid(),updated_at=now()
    returning version into ver;
    if own_batch then update public.test_participants set batch_revision=batch_revision+1 where test_id=p_test_id and marker_id=auth.uid(); end if;
    update public.marks_tests set revision=revision+1 where id=p_test_id;
    insert into public.test_mark_history(test_id,enrolment_id,actor_id,action,before_cents,after_cents)
      values(p_test_id,p_enrolment_id,auth.uid(),'Saved score',case when old.is_deleted then null else old.cents end,value);
    result:=jsonb_build_object('version',ver,'cents',value);
  end if;
  insert into public.marks_write_requests values(p_request_id,auth.uid(),payload,result,now());
  return result;
end; $$;

create or replace function public.app_remove_test_score(p_test_id uuid,p_enrolment_id uuid,p_expected_version bigint,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.marks_tests%rowtype; old public.test_scores%rowtype; payload jsonb; result jsonb;
begin
  if not app_private.is_active_member() then raise exception 'An active account is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  payload:=jsonb_build_array('remove',p_test_id,p_enrolment_id,p_expected_version);
  result:=app_private.marks_receipt(p_request_id,payload); if result is not null then return result; end if;
  t:=app_private.lock_marks_test(p_test_id);
  if t.status<>'Open' then raise exception 'Only open test entries can be removed.'; end if;
  select * into old from public.test_scores where test_id=p_test_id and enrolment_id=p_enrolment_id for update;
  if not found or old.is_deleted then raise exception 'There is no score to remove.'; end if;
  if p_expected_version is distinct from old.version then raise exception 'This score changed. Refresh before removing it.'; end if;
  if not app_private.is_admin() and (old.marker_id is distinct from auth.uid() or not exists(select 1 from public.test_participants where test_id=p_test_id and marker_id=auth.uid())) then
    raise exception 'You can only remove your own scores.';
  end if;
  update public.test_scores set is_deleted=true,version=version+1,updated_by=auth.uid(),updated_at=now() where test_id=p_test_id and enrolment_id=p_enrolment_id;
  if old.marker_id=auth.uid() then update public.test_participants set batch_revision=batch_revision+1 where test_id=p_test_id and marker_id=auth.uid(); end if;
  update public.marks_tests set revision=revision+1 where id=p_test_id;
  insert into public.test_mark_history(test_id,enrolment_id,actor_id,action,before_cents) values(p_test_id,p_enrolment_id,auth.uid(),'Removed score',old.cents);
  result:=jsonb_build_object('removed',true);
  insert into public.marks_write_requests values(p_request_id,auth.uid(),payload,result,now()); return result;
end; $$;

create or replace function public.app_submit_test_batch(p_test_id uuid,p_expected_batch_revision bigint,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.marks_tests%rowtype; p public.test_participants%rowtype; payload jsonb; result jsonb;
begin
  if not app_private.is_active_member() then raise exception 'An active account is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  payload:=jsonb_build_array('submit',p_test_id,p_expected_batch_revision);
  result:=app_private.marks_receipt(p_request_id,payload); if result is not null then return result; end if;
  t:=app_private.lock_marks_test(p_test_id);
  if t.status<>'Open' then raise exception 'Only an open test can be submitted.'; end if;
  select * into p from public.test_participants where test_id=p_test_id and marker_id=auth.uid() for update;
  if not found then raise exception 'Only participating markers can submit.'; end if;
  if p_expected_batch_revision is distinct from p.batch_revision then raise exception 'Your batch changed in another tab. Refresh and review before submitting.'; end if;
  update public.test_participants set submitted_revision=batch_revision,submitted_at=now() where test_id=p_test_id and marker_id=auth.uid();
  update public.marks_tests set revision=revision+1 where id=p_test_id;
  insert into public.test_mark_history(test_id,actor_id,action) values(p_test_id,auth.uid(),'Submitted batch');
  result:=jsonb_build_object('submitted',true);
  insert into public.marks_write_requests values(p_request_id,auth.uid(),payload,result,now()); return result;
end; $$;

create or replace function public.app_complete_marks_test(
 p_test_id uuid,p_action text,p_expected_revision bigint,p_missing_ids uuid[],p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.marks_tests%rowtype; missing uuid[]; requested uuid[]; eid uuid; old public.test_scores%rowtype;
 payload jsonb; result jsonb;
begin
  if not app_private.is_admin() then raise exception 'Only active admins can complete tests.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  payload:=jsonb_build_array('complete',p_test_id,p_action,p_expected_revision,p_missing_ids);
  result:=app_private.marks_receipt(p_request_id,payload); if result is not null then return result; end if;
  t:=app_private.lock_marks_test(p_test_id);
  if p_expected_revision is distinct from t.revision then raise exception 'This test changed. Refresh and review the latest scores and submissions first.'; end if;
  if p_action in ('zero','close') then
    if t.status<>'Open' then raise exception 'Only open tests can be completed.'; end if;
    if exists(select 1 from public.test_participants where test_id=p_test_id and submitted_revision is distinct from batch_revision) then
      raise exception 'Every participating marker must submit their latest batch first.';
    end if;
    select coalesce(array_agg(e.id order by e.id),'{}'::uuid[]) into missing from public.enrolments e
      where e.group_id=t.group_id and e.is_active and not exists(
        select 1 from public.test_scores s where s.test_id=p_test_id and s.enrolment_id=e.id and not s.is_deleted);
    if p_action='zero' then
      select coalesce(array_agg(x order by x),'{}'::uuid[]) into requested from unnest(p_missing_ids) x;
      if missing is distinct from requested then raise exception 'The list of students without scores changed. Refresh and review it first.'; end if;
      foreach eid in array missing loop
        select * into old from public.test_scores where test_id=p_test_id and enrolment_id=eid;
        insert into public.test_scores(test_id,enrolment_id,group_id,cents,marker_id,source,updated_by)
          values(p_test_id,eid,t.group_id,0,null,'Zero fill',auth.uid())
          on conflict(test_id,enrolment_id) do update set cents=0,marker_id=null,source='Zero fill',is_deleted=false,
            version=public.test_scores.version+1,updated_by=auth.uid(),updated_at=now();
        insert into public.test_mark_history(test_id,enrolment_id,actor_id,action,after_cents) values(p_test_id,eid,auth.uid(),'Filled missing score with zero',0);
      end loop;
      result:=jsonb_build_object('added',cardinality(missing));
    else
      if cardinality(missing)>0 then raise exception 'Some active students still have no score. Enter marks or add zeroes before closing.'; end if;
      update public.marks_tests set status='Closed' where id=p_test_id;
      insert into public.test_mark_history(test_id,actor_id,action) values(p_test_id,auth.uid(),'Closed test');
      result:=jsonb_build_object('status','Closed');
    end if;
  elsif p_action='reopen' then
    if t.status not in ('Closed','Cancelled') then raise exception 'This test is already open.'; end if;
    update public.marks_tests set status='Open' where id=p_test_id;
    insert into public.test_mark_history(test_id,actor_id,action) values(p_test_id,auth.uid(),'Reopened test');
    result:=jsonb_build_object('status','Open');
  elsif p_action='cancel' then
    if t.status='Cancelled' then raise exception 'This test is already cancelled.'; end if;
    update public.marks_tests set status='Cancelled' where id=p_test_id;
    insert into public.test_mark_history(test_id,actor_id,action) values(p_test_id,auth.uid(),'Cancelled test');
    result:=jsonb_build_object('status','Cancelled');
  else raise exception 'Unknown test action.';
  end if;
  update public.marks_tests set revision=revision+1 where id=p_test_id;
  insert into public.marks_write_requests values(p_request_id,auth.uid(),payload,result,now()); return result;
end; $$;

-- A single RPC snapshot avoids mixing separately paginated score/submission
-- revisions. Test rosters are dynamic active enrolments plus historical scores.
create or replace function public.app_get_test_workspace(p_test_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t public.marks_tests%rowtype; result jsonb;
begin
  if not app_private.is_active_member() then raise exception 'An active account is required.'; end if;
  select * into t from public.marks_tests where id=p_test_id;
  if not found then raise exception 'Test not found.'; end if;
  result:=jsonb_build_object('test',to_jsonb(t),
    'group',(select to_jsonb(g) from public.exam_groups g where g.id=t.group_id),
    'participants',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('name',u.display_name,'is_active',u.is_active) order by u.display_name,p.marker_id)
      from public.test_participants p join public.profiles u on u.id=p.marker_id where p.test_id=p_test_id),'[]'::jsonb),
    'students',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',s.name,'student_code',e.student_code,'stream',e.stream,'is_active',e.is_active,'school',sc.name) order by s.name,e.id)
      from public.enrolments e join public.students s on s.id=e.student_id join public.schools sc on sc.id=e.school_id
      where e.group_id=t.group_id and (e.is_active or exists(select 1 from public.test_scores x where x.test_id=p_test_id and x.enrolment_id=e.id and not x.is_deleted))),'[]'::jsonb),
    'scores',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('marker_name',u.display_name) order by s.enrolment_id)
      from public.test_scores s left join public.profiles u on u.id=s.marker_id where s.test_id=p_test_id),'[]'::jsonb),
    'history',case when app_private.is_admin() then coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id) from (
      select h.*,u.display_name as actor_name from public.test_mark_history h join public.profiles u on u.id=h.actor_id
      where h.test_id=p_test_id order by h.created_at desc,h.id limit 100) h),'[]'::jsonb) else '[]'::jsonb end);
  return result;
end; $$;

revoke all on function app_private.lock_marks_test(uuid), app_private.marks_receipt(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.app_create_marks_test(uuid,text,integer,date,text,uuid[],uuid), public.app_save_test_score(uuid,uuid,text,bigint,uuid),
 public.app_remove_test_score(uuid,uuid,bigint,uuid), public.app_submit_test_batch(uuid,bigint,uuid),
 public.app_complete_marks_test(uuid,text,bigint,uuid[],uuid), public.app_get_test_workspace(uuid) from public,anon,authenticated;
grant execute on function public.app_create_marks_test(uuid,text,integer,date,text,uuid[],uuid), public.app_save_test_score(uuid,uuid,text,bigint,uuid),
 public.app_remove_test_score(uuid,uuid,bigint,uuid), public.app_submit_test_batch(uuid,bigint,uuid),
 public.app_complete_marks_test(uuid,text,bigint,uuid[],uuid), public.app_get_test_workspace(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
select 'Shared test marks are ready.' as result;
