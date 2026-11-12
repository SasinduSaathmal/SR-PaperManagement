-- Run after 012. Installs controls; does not remove students or merge schools.
begin;

create table if not exists public.school_name_aliases (
  name_key text primary key,
  name text not null,
  school_id uuid not null references public.schools(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.school_name_aliases enable row level security;
revoke all on public.school_name_aliases from public,anon,authenticated;
grant select on public.school_name_aliases to authenticated;
drop policy if exists school_aliases_read on public.school_name_aliases;
create policy school_aliases_read on public.school_name_aliases for select to authenticated
  using ((select app_private.is_active_member()));

-- Reuse the existing delayed-create guard for individually removed students.
alter table public.cleared_student_requests alter column cleanup_id drop not null;
alter table public.cleared_student_requests add column if not exists deletion_request_id uuid references public.marks_write_requests(request_id);
alter table public.cleared_student_requests drop constraint if exists cleared_student_request_owner;
alter table public.cleared_student_requests add constraint cleared_student_request_owner
  check ((cleanup_id is not null) <> (deletion_request_id is not null));
create or replace function app_private.reject_cleared_student_request()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.cleared_student_requests where request_id=new.request_id and cleanup_id is not null) then
    raise exception 'This student save belongs to cleared trial data. Start a new student entry.';
  end if;
  if exists(select 1 from public.cleared_student_requests where request_id=new.request_id) then
    raise exception 'This save belongs to a permanently removed student. Start a new student entry.';
  end if;
  return new;
end $$;

-- Official-ID corrections retain aliases. Both namespaces reserve an ID for
-- one enrolment; older clients cannot accidentally reuse a corrected old ID.
create or replace function app_private.protect_student_code()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.exam_groups where id=new.group_id for update;
  if tg_table_name='enrolments' then
    if exists(select 1 from public.student_id_aliases where group_id=new.group_id
      and student_code=new.student_code and enrolment_id<>new.id) then
      raise exception 'This ID is reserved as an earlier ID of another student. Search that record instead.';
    end if;
  else
    if exists(select 1 from public.enrolments where group_id=new.group_id
      and student_code=new.student_code and id<>new.enrolment_id) then
      raise exception 'This earlier ID already belongs to another student.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists protect_enrolment_code on public.enrolments;
create trigger protect_enrolment_code before insert or update of student_code,group_id on public.enrolments
  for each row execute function app_private.protect_student_code();
drop trigger if exists protect_alias_code on public.student_id_aliases;
create trigger protect_alias_code before insert or update on public.student_id_aliases
  for each row execute function app_private.protect_student_code();

create or replace function public.app_change_student_id(p_enrolment_id uuid,p_official_id text,p_expected_version bigint,p_reason text,p_confirmed boolean,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.enrolments%rowtype;g public.exam_groups%rowtype;code text;payload jsonb;result jsonb;
begin
  if not app_private.is_admin() then raise exception 'Only active admins can change student IDs.';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  payload:=jsonb_build_array('change student ID',p_enrolment_id,p_official_id,p_expected_version,p_reason,p_confirmed);
  result:=app_private.marks_receipt(p_request_id,payload);if result is not null then return result;end if;
  select * into e from public.enrolments where id=p_enrolment_id;
  if not found then raise exception 'Student enrolment not found.';end if;
  select * into g from public.exam_groups where id=e.group_id for update;
  if g.is_archived then raise exception 'Restore the archived group before changing an ID.';end if;
  select * into e from public.enrolments where id=p_enrolment_id for update;
  if e.version is distinct from p_expected_version then raise exception 'Student changed. Refresh and review the ID again.';end if;
  if not coalesce(p_confirmed,false) or char_length(btrim(coalesce(p_reason,''))) not between 1 and 500 then
    raise exception 'Confirm the same student and give a reason for changing the ID.';
  end if;
  code:=app_private.online_import_code(p_official_id,g.exam_year);
  if code is null then raise exception 'Enter an official number or SC/year/number matching this exam group.';end if;
  if code<>e.student_code then
    if exists(select 1 from public.enrolments where group_id=g.id and student_code=code and id<>e.id)
      or exists(select 1 from public.student_id_aliases where group_id=g.id and student_code=code and enrolment_id<>e.id) then
      raise exception 'This ID already belongs to another student or their earlier ID. Marks will not be merged.';
    end if;
    delete from public.student_id_aliases where group_id=g.id and student_code=code and enrolment_id=e.id;
    insert into public.student_id_aliases(group_id,student_code,enrolment_id,created_by)
      values(g.id,e.student_code,e.id,auth.uid()) on conflict(group_id,student_code) do nothing;
    update public.enrolments set student_code=code,version=version+1 where id=e.id;
    insert into public.student_change_history(enrolment_id,actor_id,action,before_values,after_values)
      values(e.id,auth.uid(),'Corrected student ID: '||btrim(p_reason),jsonb_build_object('student_code',e.student_code),jsonb_build_object('student_code',code));
    update public.marks_tests set revision=revision+1 where id in(select test_id from public.test_scores where enrolment_id=e.id);
  end if;
  result:=jsonb_build_object('id',e.id,'student_code',code);
  insert into public.marks_write_requests values(p_request_id,auth.uid(),payload,result,now());return result;
end $$;

create or replace function app_private.school_name_key(p_name text)
returns text language sql immutable set search_path='' as $$
  select lower(regexp_replace(btrim(p_name),'\s+',' ','g'));
$$;
create or replace function app_private.canonical_school_name(p_name text)
returns text language plpgsql stable security definer set search_path='' as $$
declare label text:=regexp_replace(btrim(p_name),'\s+',' ','g');canonical text;matches integer;
begin
  select s.name into canonical from public.school_name_aliases a join public.schools s on s.id=a.school_id
    where a.name_key=app_private.school_name_key(label);
  if found then return canonical;end if;
  select count(*),min(s.name) into matches,canonical from public.schools s
    where app_private.school_name_key(s.name)=app_private.school_name_key(label);
  if matches>1 then raise exception 'Multiple school spellings match this name. An admin must merge those schools first.';end if;
  return case when matches=1 then canonical else label end;
end $$;
create or replace function app_private.normalize_school_insert()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('physics school names',0));
  new.name:=app_private.canonical_school_name(new.name);return new;
end $$;
drop trigger if exists normalize_school_insert on public.schools;
create trigger normalize_school_insert before insert on public.schools
  for each row execute function app_private.normalize_school_insert();

create or replace function public.app_school_options()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not app_private.is_active_member() then raise exception 'An active account is required.';end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,
    'aliases',coalesce((select jsonb_agg(a.name order by a.name) from public.school_name_aliases a where a.school_id=s.id),'[]'::jsonb),
    'students',(select count(*) from public.enrolments e where e.school_id=s.id),
    'years',coalesce((select jsonb_agg(y.exam_year order by y.exam_year) from (select distinct g.exam_year from public.enrolments e join public.exam_groups g on g.id=e.group_id where e.school_id=s.id) y),'[]'::jsonb)
  ) order by s.name,s.id) from public.schools s),'[]'::jsonb);
end $$;

create or replace function app_private.school_merge_snapshot(p_school_ids uuid[],p_target_id uuid,p_name text)
returns jsonb language plpgsql set search_path='' as $$
declare state jsonb;schools jsonb;affected jsonb;label text:=regexp_replace(btrim(p_name),'\s+',' ','g');
begin
  if p_name is null or char_length(label) not between 1 and 200 or p_target_id is null
    or coalesce(cardinality(p_school_ids),0) not between 1 and 100
    or exists(select 1 from unnest(p_school_ids) x where x is null)
    or cardinality(p_school_ids)<>(select count(distinct x) from unnest(p_school_ids) x)
    or not p_target_id=any(p_school_ids)
    or (select count(*) from public.schools where id=any(p_school_ids))<>cardinality(p_school_ids) then
    raise exception 'Select existing school names and one school to keep, with a standard name up to 200 characters.';
  end if;
  if exists(select 1 from public.schools where not id=any(p_school_ids) and app_private.school_name_key(name)=app_private.school_name_key(label))
    or exists(select 1 from public.school_name_aliases where not school_id=any(p_school_ids) and name_key=app_private.school_name_key(label)) then
    raise exception 'This standard name already belongs to another school. Include that school and choose it as the school to keep.';
  end if;
  if exists(select 1 from public.school_name_aliases a join public.schools s on app_private.school_name_key(s.name)=a.name_key
    where s.id=any(p_school_ids) and not a.school_id=any(p_school_ids)) then
    raise exception 'A selected name is already an alias of another school. Include that school before merging.';
  end if;
  if exists(select 1 from public.enrolments e join public.exam_groups g on g.id=e.group_id where e.school_id=any(p_school_ids) and g.is_archived) then
    raise exception 'A selected school is used in an archived exam year. Restore that group before renaming or merging its school.';
  end if;
  select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'students',(select count(*) from public.enrolments where school_id=s.id),
    'samples',coalesce((select jsonb_agg(to_jsonb(r)) from (select p.name,e.student_code,g.exam_year from public.enrolments e join public.students p on p.id=e.student_id join public.exam_groups g on g.id=e.group_id where e.school_id=s.id order by g.exam_year,e.student_code limit 5) r),'[]'::jsonb)) order by s.name,s.id)
    into schools from public.schools s where s.id=any(p_school_ids);
  select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]'::jsonb) into affected from public.enrolments e
    join public.schools s on s.id=e.school_id where s.id=any(p_school_ids) and (s.id<>p_target_id or s.name<>label);
  state:=jsonb_build_object('schools',(select jsonb_agg(to_jsonb(s) order by s.id) from public.schools s where id=any(p_school_ids)),
    'aliases',(select jsonb_agg(to_jsonb(a) order by a.name_key) from public.school_name_aliases a where school_id=any(p_school_ids)),
    'enrolments',(select jsonb_agg(to_jsonb(e) order by e.id) from public.enrolments e where school_id=any(p_school_ids)),
    'groups',(select jsonb_agg(to_jsonb(g) order by g.id) from public.exam_groups g where id in(select group_id from public.enrolments where school_id=any(p_school_ids))),
    'target',p_target_id,'name',label);
  return jsonb_build_object('fingerprint',md5(state::text),'schools',schools,'name',label,'students',jsonb_array_length(affected),
    'confirmation','MERGE SCHOOLS','_affected',affected);
end $$;

create or replace function public.app_preview_school_merge(p_school_ids uuid[],p_target_id uuid,p_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not app_private.is_admin() then raise exception 'Only active admins can manage schools.';end if;
  return app_private.school_merge_snapshot(p_school_ids,p_target_id,p_name)-'_affected';
end $$;

create or replace function public.app_merge_schools(p_school_ids uuid[],p_target_id uuid,p_name text,p_reason text,p_expected_fingerprint text,p_confirmation text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb;result jsonb;preview jsonb;item jsonb;old_names text[];gids uuid[];label text:=regexp_replace(btrim(p_name),'\s+',' ','g');
begin
  if not app_private.is_admin() then raise exception 'Only active admins can manage schools.';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  payload:=jsonb_build_array('merge schools',p_school_ids,p_target_id,p_name,p_reason,p_expected_fingerprint,p_confirmation);
  result:=app_private.marks_receipt(p_request_id,payload);if result is not null then return result;end if;
  if p_confirmation is distinct from 'MERGE SCHOOLS' or char_length(btrim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'Confirm MERGE SCHOOLS and give a reason.';end if;
  -- All normal writers lock group before school names. Do not invert that order.
  perform 1 from public.exam_groups order by id for update;
  perform pg_advisory_xact_lock(hashtextextended('physics school names',0));
  perform 1 from public.schools where id=any(p_school_ids) order by id for update;
  preview:=app_private.school_merge_snapshot(p_school_ids,p_target_id,p_name);
  if p_expected_fingerprint is distinct from preview->>'fingerprint' then raise exception 'School records changed. Review the merge again.';end if;
  select array_agg(name) into old_names from public.schools where id=any(p_school_ids);
  select coalesce(array_agg(distinct (v->>'group_id')::uuid),'{}') into gids from jsonb_array_elements(preview->'_affected') v;
  for item in select value from jsonb_array_elements(preview->'_affected') loop
    insert into public.student_change_history(enrolment_id,actor_id,action,before_values,after_values)
      values((item->>'id')::uuid,auth.uid(),'Standardized school: '||btrim(p_reason),
        jsonb_build_object('school_id',item->>'school_id','school',(select name from public.schools where id=(item->>'school_id')::uuid)),
        jsonb_build_object('school_id',p_target_id,'school',label));
    update public.enrolments set school_id=p_target_id,version=version+1 where id=(item->>'id')::uuid;
  end loop;
  update public.school_name_aliases set school_id=p_target_id where school_id=any(p_school_ids);
  delete from public.schools where id=any(p_school_ids) and id<>p_target_id;
  update public.schools set name=label where id=p_target_id;
  insert into public.school_name_aliases(name_key,name,school_id,created_by)
    select distinct on(app_private.school_name_key(n)) app_private.school_name_key(n),n,p_target_id,auth.uid() from unnest(old_names) n order by app_private.school_name_key(n),n
    on conflict(name_key) do update set school_id=excluded.school_id;
  update public.marks_tests set revision=revision+1 where group_id=any(gids);
  result:=jsonb_build_object('id',p_target_id,'name',label,'students',preview->'students');
  insert into public.marks_write_requests values(p_request_id,auth.uid(),payload,result,now());return result;
end $$;

create or replace function app_private.student_removal_snapshot(p_enrolment_id uuid,p_all_years boolean)
returns jsonb language plpgsql set search_path='' as $$
declare root public.enrolments%rowtype;person public.students%rowtype;eids uuid[];gids uuid[];rids uuid[];reports uuid[];wids uuid[];
  ids text[];names text[];codes jsonb;state jsonb;roster jsonb;counts jsonb;
begin
  if p_all_years is null then raise exception 'Choose the removal scope.';end if;
  select * into root from public.enrolments where id=p_enrolment_id;
  if not found then raise exception 'Student enrolment no longer exists.';end if;
  select * into person from public.students where id=root.student_id;
  select array_agg(e.id order by e.id),array_agg(distinct e.group_id order by e.group_id) into eids,gids
    from public.enrolments e where case when p_all_years then e.student_id=root.student_id else e.id=root.id end;
  if exists(select 1 from public.exam_groups where id=any(gids) and is_archived) then
    raise exception 'This removal includes an archived exam year. Restore it first or remove only an active year.';
  end if;
  select jsonb_agg(to_jsonb(c)) into codes from (
    select e.group_id,e.student_code from public.enrolments e where e.id=any(eids)
    union select a.group_id,a.student_code from public.student_id_aliases a where a.enrolment_id=any(eids)
  ) c;
  select coalesce(array_agg(r.id order by r.id),'{}') into rids from public.online_import_rows r
    join public.marks_tests t on t.id=r.test_id join public.exam_groups g on g.id=t.group_id where t.group_id=any(gids)
    and (exists(select 1 from public.test_mark_history h where h.import_row_id=r.id and h.enrolment_id=any(eids))
      or exists(select 1 from jsonb_array_elements(codes) c where (c->>'group_id')::uuid=t.group_id
        and c->>'student_code'=app_private.online_import_code(r.raw->>'code',g.exam_year)));
  select coalesce(array_agg(r.id order by r.id),'{}') into reports from public.saved_reports r where r.group_id=any(gids)
    and exists(select 1 from jsonb_array_elements(r.snapshot->'rows') v where v->>'id'=any(eids::text[]));
  ids:=eids::text[]||reports::text[]||rids::text[];
  -- Stage/import receipts can contain original raw marks using a numeric code.
  -- Their result references the shared batch, rather than the enrolment UUID.
  ids:=ids||coalesce((select array_agg(distinct batch_id::text) from public.online_import_rows where id=any(rids)),'{}'::text[]);
  if not exists(select 1 from public.enrolments where student_id=person.id and not id=any(eids)) then ids:=ids||person.id::text;end if;
  select array_agg(distinct n) into names from (select person.name as n union all
    select before_values->>'name' from public.student_change_history where enrolment_id=any(eids) union all
    select after_values->>'name' from public.student_change_history where enrolment_id=any(eids)) q where nullif(n,'') is not null;
  select coalesce(array_agg(w.request_id order by w.request_id),'{}') into wids from public.marks_write_requests w
    where exists(select 1 from unnest(ids) x where strpos(w.payload::text,to_jsonb(x)::text)>0 or strpos(w.result::text,to_jsonb(x)::text)>0)
      or exists(select 1 from unnest(names) x where strpos(lower(w.payload::text),lower(to_jsonb(x)::text))>0)
      or exists(select 1 from jsonb_array_elements(codes) c where strpos(w.payload::text,to_jsonb(c->>'student_code')::text)>0);
  state:=jsonb_build_object('person',to_jsonb(person),
    'enrolments',(select jsonb_agg(to_jsonb(e) order by id) from public.enrolments e where id=any(eids)),
    'groups',(select jsonb_agg(to_jsonb(g) order by id) from public.exam_groups g where id=any(gids)),
    'tests',(select jsonb_agg(to_jsonb(t) order by id) from public.marks_tests t where group_id=any(gids)),
    'scores',(select jsonb_agg(to_jsonb(s) order by test_id,enrolment_id) from public.test_scores s where enrolment_id=any(eids)),
    'history',(select jsonb_agg(to_jsonb(h) order by id) from public.test_mark_history h where enrolment_id=any(eids)),
    'student_history',(select jsonb_agg(to_jsonb(h) order by id) from public.student_change_history h where enrolment_id=any(eids)),
    'aliases',(select jsonb_agg(to_jsonb(a) order by group_id,student_code) from public.student_id_aliases a where enrolment_id=any(eids)),
    'imports',(select jsonb_agg(to_jsonb(r) order by id) from public.online_import_rows r where id=any(rids)),
    'reports',(select jsonb_agg(to_jsonb(r) order by id) from public.saved_reports r where id=any(reports)),
    'receipts',(select jsonb_agg(to_jsonb(w) order by request_id) from public.marks_write_requests w where request_id=any(wids)),
    'participants',(select jsonb_agg(to_jsonb(p) order by test_id,marker_id) from public.test_participants p where exists(
      select 1 from public.test_scores s where s.enrolment_id=any(eids) and s.test_id=p.test_id and s.marker_id=p.marker_id and s.source='Paper')));
  select jsonb_agg(jsonb_build_object('id',e.id,'student_code',e.student_code,'exam_year',g.exam_year,'school',s.name,'stream',e.stream) order by g.exam_year,e.id)
    into roster from public.enrolments e join public.exam_groups g on g.id=e.group_id join public.schools s on s.id=e.school_id where e.id=any(eids);
  counts:=jsonb_build_object('enrolments',cardinality(eids),
    'scores',(select count(*) from public.test_scores where enrolment_id=any(eids)),
    'history',(select count(*) from public.test_mark_history where enrolment_id=any(eids))+(select count(*) from public.student_change_history where enrolment_id=any(eids)),
    'reports',cardinality(reports),'import_rows',cardinality(rids),'receipts',cardinality(wids));
  return jsonb_build_object('name',person.name,'all_years',p_all_years,'enrolments',roster,'counts',counts,
    'reports',coalesce((select jsonb_agg(jsonb_build_object('title',title,'version',version) order by version,id) from public.saved_reports where id=any(reports)),'[]'::jsonb),
    'confirmation','DELETE '||root.student_code,'fingerprint',md5(state::text),
    '_private',jsonb_build_object('eids',eids,'gids',gids,'rids',rids,'reports',reports,'wids',wids,'person_id',person.id));
end $$;

create or replace function public.app_preview_student_removal(p_enrolment_id uuid,p_all_years boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not app_private.is_admin() then raise exception 'Only active admins can permanently remove students.';end if;
  return app_private.student_removal_snapshot(p_enrolment_id,p_all_years)-'_private';
end $$;

create or replace function public.app_remove_student(p_enrolment_id uuid,p_all_years boolean,p_expected_fingerprint text,p_confirmation text,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare root public.enrolments%rowtype;person_id uuid;gids uuid[];now_gids uuid[];eids uuid[];rids uuid[];reports uuid[];wids uuid[];
  preview jsonb;payload jsonb;result jsonb;
begin
  if not app_private.is_admin() then raise exception 'Only active admins can permanently remove students.';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  payload:=jsonb_build_array('remove student',p_enrolment_id,p_all_years,p_expected_fingerprint,p_confirmation,p_reason);
  result:=app_private.marks_receipt(p_request_id,payload);if result is not null then return result;end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'Give a reason for permanent removal.';end if;
  select * into root from public.enrolments where id=p_enrolment_id;
  if not found then raise exception 'Student enrolment no longer exists.';end if;
  person_id:=root.student_id;
  select array_agg(distinct group_id order by group_id) into gids from public.enrolments
    where case when p_all_years then student_id=person_id else id=root.id end;
  perform 1 from public.exam_groups where id=any(gids) order by id for update;
  perform 1 from public.marks_tests where group_id=any(gids) order by id for update;
  perform 1 from public.students where id=person_id for update;
  select array_agg(distinct group_id order by group_id) into now_gids from public.enrolments
    where case when p_all_years then student_id=person_id else id=root.id end;
  if now_gids is distinct from gids or not exists(select 1 from public.enrolments where id=root.id and student_id=person_id) then
    raise exception 'Student links changed. Review the removal again.';
  end if;
  preview:=app_private.student_removal_snapshot(p_enrolment_id,p_all_years);
  if p_expected_fingerprint is distinct from preview->>'fingerprint' then raise exception 'Student records changed. Review the removal again.';end if;
  if p_confirmation is distinct from preview->>'confirmation' then raise exception 'Type the displayed DELETE phrase exactly.';end if;
  select array_agg(x::uuid) into eids from jsonb_array_elements_text(preview#>'{_private,eids}') x;
  select coalesce(array_agg(x::uuid),'{}') into rids from jsonb_array_elements_text(preview#>'{_private,rids}') x;
  select coalesce(array_agg(x::uuid),'{}') into reports from jsonb_array_elements_text(preview#>'{_private,reports}') x;
  select coalesce(array_agg(x::uuid),'{}') into wids from jsonb_array_elements_text(preview#>'{_private,wids}') x;
  result:=jsonb_build_object('deleted',true,'counts',preview->'counts');
  insert into public.marks_write_requests values(p_request_id,auth.uid(),payload,result,now());
  insert into public.cleared_student_requests(request_id,deletion_request_id)
    select request_id,p_request_id from public.enrolments where id=any(eids) on conflict(request_id) do nothing;
  delete from public.saved_report_tests where report_id=any(reports);
  delete from public.saved_reports where id=any(reports);
  -- Online rows remain as anonymous dismissed tombstones: old file hashes stay
  -- deduplicated and cannot silently recreate the removed marks on a retry.
  update public.online_import_rows set raw='{}'::jsonb,status='Dismissed',message='Student permanently removed.',reason='Student removal',resolved_by=auth.uid(),resolved_at=now() where id=any(rids);
  update public.test_participants p set batch_revision=batch_revision+1 where exists(
    select 1 from public.test_scores s join public.marks_tests t on t.id=s.test_id
    where s.enrolment_id=any(eids) and s.test_id=p.test_id and s.marker_id=p.marker_id and s.source='Paper' and t.status='Open');
  delete from public.test_mark_history where enrolment_id=any(eids);
  delete from public.test_scores where enrolment_id=any(eids);
  delete from public.student_change_history where enrolment_id=any(eids);
  delete from public.enrolments where id=any(eids);
  delete from public.students s where s.id=person_id and not exists(select 1 from public.enrolments where student_id=s.id);
  update public.marks_write_requests set payload=jsonb_build_array('Removed student data',p_request_id),result=jsonb_build_object('removed',true)
    where request_id=any(wids) and request_id<>p_request_id;
  update public.marks_tests set revision=revision+1 where group_id=any(gids);
  insert into public.test_mark_history(test_id,actor_id,action)
    select id,auth.uid(),'Student record and associated marks permanently removed by admin' from public.marks_tests where group_id=any(gids);
  return result;
end $$;

-- Match reviewed school aliases and corrected official IDs in legacy import APIs.
create or replace function public.app_import_students(p_group_id uuid, p_rows jsonb, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g public.exam_groups%rowtype; item jsonb; result jsonb; payload jsonb;
  code text; parts text[]; name_text text; school_text text; stream_text text;
  added integer := 0; skipped integer := 0; existing public.enrolments%rowtype;
begin
  if not app_private.is_admin() then raise exception 'Only active admins can bulk import students.'; end if;
  if p_request_id is null then raise exception 'An import request ID is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  payload := jsonb_build_array('student import',p_group_id,p_rows);
  result := app_private.marks_receipt(p_request_id,payload);
  if result is not null then return result; end if;
  select * into g from public.exam_groups where id=p_group_id for update;
  if not found then raise exception 'Exam group not found.'; end if;
  if g.is_archived then raise exception 'Archived groups are read-only.'; end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'Send an array of student rows.'; end if;
  if jsonb_array_length(p_rows) not between 1 and 1000 then raise exception 'Import between 1 and 1000 students at a time.'; end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    name_text := regexp_replace(btrim(item->>'name'),'\s+',' ','g');
    school_text := app_private.canonical_school_name(item->>'school');
    stream_text := item->>'stream';
    if name_text is null or char_length(name_text) not between 1 and 200 or school_text is null or char_length(school_text) not between 1 and 200 then
      raise exception 'Each row needs a name and school of up to 200 characters.';
    end if;
    if stream_text is null or stream_text not in ('Maths','Bio') then raise exception 'Each row needs Maths or Bio.'; end if;
    code := upper(btrim(coalesce(item->>'officialId','')));
    if code<>'' then
      if char_length(code)>100 then raise exception 'Student ID is too long.'; end if;
      if code ~ '^[0-9]+$' then code := 'SC/'||g.exam_year||'/'||coalesce(nullif(ltrim(code,'0'),''),'0');
      else
        parts := regexp_match(code,'^SC/([0-9]{4})/([0-9]+)$');
        if parts is null then raise exception 'Use an official number or SC/year/number.'; end if;
        if parts[1]::integer<>g.exam_year then raise exception 'Student ID year does not match the selected group.'; end if;
        code := 'SC/'||g.exam_year||'/'||coalesce(nullif(ltrim(parts[2],'0'),''),'0');
      end if;
      select * into existing from public.enrolments where group_id=g.id and (student_code=code or exists(select 1 from public.student_id_aliases a where a.enrolment_id=enrolments.id and a.student_code=code));
      if found then
        if existing.stream<>stream_text or not exists(select 1 from public.students s join public.schools sc on sc.id=existing.school_id
          where s.id=existing.student_id and lower(s.name)=lower(name_text) and lower(sc.name)=lower(school_text)) then
          raise exception 'Student ID % now exists with different details. Refresh the preview before importing.',code;
        end if;
        skipped := skipped+1; continue;
      end if;
    end if;
    -- Repeated uploads with blank IDs must not create duplicate temporary students.
    if exists(select 1 from public.enrolments e join public.students s on s.id=e.student_id join public.schools sc on sc.id=e.school_id
      where e.group_id=g.id and lower(s.name)=lower(name_text) and lower(sc.name)=lower(school_text) and e.stream=stream_text) then
      skipped := skipped+1; continue;
    end if;
    perform public.app_add_student(g.id,name_text,school_text,stream_text,code,gen_random_uuid());
    added := added+1;
  end loop;
  result := jsonb_build_object('added',added,'skipped',skipped);
  insert into public.marks_write_requests values(p_request_id,auth.uid(),payload,result,now());
  return result;
end; $$;


create or replace function app_private.apply_online_row(p_row_id uuid,p_details jsonb,p_replace boolean,p_expected_version bigint,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.online_import_rows%rowtype; t public.marks_tests%rowtype; e public.enrolments%rowtype;
 old public.test_scores%rowtype; raw_code text; parts text[]; code text; mark_text text; cents integer;
 issue text := ''; g public.exam_groups%rowtype; saved jsonb; owner_id uuid; score_source text;
begin
 select * into r from public.online_import_rows where id=p_row_id for update;
 if r.status<>'Pending' then return; end if;
 select * into t from public.marks_tests where id=r.test_id;
 select * into g from public.exam_groups where id=t.group_id;
 mark_text := btrim(coalesce(p_details->>'mark',r.raw->>'mark',''));
 raw_code := upper(btrim(coalesce(p_details->>'code',r.raw->>'code','')));
 if mark_text !~ '^[0-9]{1,7}(\.[0-9]{1,2})?(\s*/\s*[0-9]{1,7}(\.[0-9]{1,2})?)?$' then issue := 'Invalid or converted score. Enter the original score text.';
 else
   if position('/' in mark_text)>0 and btrim(split_part(mark_text,'/',2))::numeric*100<>t.max_cents then issue := 'Marks denominator does not match the test maximum.';
   elsif btrim(split_part(mark_text,'/',1))::numeric*100>t.max_cents then issue := 'Score exceeds the test maximum.';
   else cents := (btrim(split_part(mark_text,'/',1))::numeric*100)::integer; end if;
 end if;
 if issue='' and cents=0 then
   update public.online_import_rows set status='Skipped',message='Online zero skipped; existing scores preserved.',resolved_by=auth.uid(),resolved_at=now() where id=r.id; return;
 end if;
 if issue='' then
   if raw_code ~ '^[0-9]+$' and char_length(raw_code)<=100 then code := 'SC/'||g.exam_year||'/'||coalesce(nullif(ltrim(raw_code,'0'),''),'0');
   else
     parts := regexp_match(raw_code,'^SC/([0-9]{4})/([0-9]+)$');
     if parts is null or char_length(raw_code)>100 then issue := 'A valid official student ID is required.';
     elsif parts[1]::integer<>g.exam_year then issue := 'Student ID belongs to a different exam year.';
     else code := 'SC/'||g.exam_year||'/'||coalesce(nullif(ltrim(parts[2],'0'),''),'0'); end if;
   end if;
 end if;
 if issue='' then
   select * into e from public.enrolments where group_id=g.id and (student_code=code or exists(select 1 from public.student_id_aliases a where a.enrolment_id=enrolments.id and a.student_code=code));
   if not found then
     if coalesce(p_details->>'create_student','false')<>'true' then issue := 'Unknown student. Complete name, school and stream before importing.';
     elsif nullif(btrim(p_details->>'name'),'') is null or char_length(p_details->>'name')>200
       or nullif(btrim(p_details->>'school'),'') is null or char_length(p_details->>'school')>200
       or lower(btrim(p_details->>'school')) in ('other','school not updated','-','unknown') or btrim(p_details->>'school') ~ '^[0-9]+$'
       or coalesce(p_details->>'stream','') not in ('Maths','Bio') then issue := 'Supply a usable name, school and Maths/Bio stream for this new student.';
     else
       saved := public.app_add_student(g.id,p_details->>'name',p_details->>'school',p_details->>'stream',code,gen_random_uuid());
       select * into e from public.enrolments where id=(saved->>'id')::uuid;
     end if;
   end if;
   if e.id is not null and not e.is_active then issue := 'Student is inactive. Reactivate the enrolment before importing.'; end if;
 end if;
 if issue='' then
   select * into old from public.test_scores where test_id=t.id and enrolment_id=e.id for update;
   if old.test_id is not null and not old.is_deleted then
     if old.source='Online' and old.cents=cents then
       update public.online_import_rows set status='Skipped',message='Identical online score already imported.',resolved_by=auth.uid(),resolved_at=now() where id=r.id; return;
     elsif not coalesce(p_replace,false) then issue := 'Existing '||old.source||' score '||(old.cents::numeric/100)||'. Review and explicitly replace or dismiss.';
     elsif p_expected_version is distinct from old.version then raise exception 'Existing score changed. Refresh before replacing it.';
     elsif char_length(btrim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'Give a reason for replacing the existing score.';
     end if;
   elsif p_replace and p_expected_version is distinct from coalesce(old.version,0) then raise exception 'Existing score changed. Refresh before importing.';
   end if;
 end if;
 if issue<>'' then update public.online_import_rows set message=issue where id=r.id; return; end if;
 if old.test_id is not null and not old.is_deleted and old.cents=cents then
   update public.online_import_rows set status='Skipped',message='Verified existing score; original attribution preserved.',reason=btrim(p_reason),resolved_by=auth.uid(),resolved_at=now() where id=r.id;
   return;
 end if;
 owner_id := case when old.test_id is not null and not old.is_deleted and old.source<>'Zero fill' then old.marker_id else null end;
 score_source := case when old.test_id is not null and not old.is_deleted and old.source<>'Zero fill' then old.source else 'Online' end;
 insert into public.test_scores(test_id,enrolment_id,group_id,cents,marker_id,source,updated_by)
   values(t.id,e.id,g.id,cents,owner_id,score_source,auth.uid())
 on conflict(test_id,enrolment_id) do update set cents=excluded.cents,marker_id=excluded.marker_id,source=excluded.source,
   is_deleted=false,version=public.test_scores.version+1,updated_by=auth.uid(),updated_at=now();
 if owner_id=auth.uid() and score_source='Paper' and (old.is_deleted or old.cents is distinct from cents) then
   update public.test_participants set batch_revision=batch_revision+1 where test_id=t.id and marker_id=auth.uid();
 end if;
 insert into public.test_mark_history(test_id,enrolment_id,actor_id,action,before_cents,after_cents,import_row_id)
   values(t.id,e.id,auth.uid(),'Imported online score',case when old.is_deleted then null else old.cents end,cents,r.id);
 update public.online_import_rows set status='Imported',message='Saved online import. Existing student details preserved.',resolved_by=auth.uid(),reason=nullif(btrim(p_reason),''),resolved_at=now() where id=r.id;
 update public.marks_tests set revision=revision+1 where id=t.id;
end; $$;



revoke all on function app_private.protect_student_code(),app_private.school_name_key(text),app_private.canonical_school_name(text),app_private.normalize_school_insert(),app_private.school_merge_snapshot(uuid[],uuid,text),app_private.student_removal_snapshot(uuid,boolean) from public,anon,authenticated;
revoke all on function app_private.apply_online_row(uuid,jsonb,boolean,bigint,text),app_private.reject_cleared_student_request() from public,anon,authenticated;
revoke all on function public.app_change_student_id(uuid,text,bigint,text,boolean,uuid),public.app_school_options(),public.app_preview_school_merge(uuid[],uuid,text),public.app_merge_schools(uuid[],uuid,text,text,text,text,uuid),public.app_preview_student_removal(uuid,boolean),public.app_remove_student(uuid,boolean,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.app_change_student_id(uuid,text,bigint,text,boolean,uuid),public.app_school_options(),public.app_preview_school_merge(uuid[],uuid,text),public.app_merge_schools(uuid[],uuid,text,text,text,text,uuid),public.app_preview_student_removal(uuid,boolean),public.app_remove_student(uuid,boolean,text,text,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
