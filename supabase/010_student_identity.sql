-- Run after 009. Preserves marks and immutable report snapshots.
begin;
create table if not exists public.student_id_aliases (
 group_id uuid not null references public.exam_groups(id), student_code text not null,
 enrolment_id uuid not null, created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), primary key(group_id,student_code),
 foreign key(enrolment_id,group_id) references public.enrolments(id,group_id) on delete cascade
);
alter table public.student_id_aliases enable row level security;
revoke all on public.student_id_aliases from public,anon,authenticated;
grant select on public.student_id_aliases to authenticated;
drop policy if exists aliases_read on public.student_id_aliases;
create policy aliases_read on public.student_id_aliases for select to authenticated using ((select app_private.is_active_member()));

create or replace function public.app_search_student_identities(p_query text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q text:=btrim(coalesce(p_query,''));
begin
 if not app_private.is_admin() then raise exception 'Only active admins can link student identities.'; end if;
 if char_length(q) not between 2 and 100 then raise exception 'Enter 2 to 100 characters of a name or full ID.'; end if;
 if q~'^[0-9]+$' then raise exception 'Use a full SC/year/number ID when searching earlier years.';end if;
 return coalesce((select jsonb_agg(to_jsonb(r)) from (
  select e.id,e.student_id,e.student_code,e.version,g.exam_year,g.is_archived,s.name,s.version as student_version,sc.name as school,e.stream,e.is_active
  from public.enrolments e join public.students s on s.id=e.student_id join public.exam_groups g on g.id=e.group_id join public.schools sc on sc.id=e.school_id
  where strpos(lower(s.name),lower(q))>0 or strpos(lower(e.student_code),lower(q))>0
   or exists(select 1 from public.student_id_aliases a where a.enrolment_id=e.id and strpos(lower(a.student_code),lower(q))>0)
  order by g.exam_year desc,s.name,e.id limit 100) r),'[]'::jsonb);
end; $$;

create or replace function public.app_replace_temporary_id(p_enrolment_id uuid,p_official_id text,p_expected_version bigint,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.enrolments%rowtype; g public.exam_groups%rowtype; code text; result jsonb; payload jsonb;
begin
 if not app_private.is_admin() then raise exception 'Only active admins can replace temporary IDs.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 payload:=jsonb_build_array('replace temporary ID',p_enrolment_id,p_official_id,p_expected_version,p_reason);
 result:=app_private.marks_receipt(p_request_id,payload);if result is not null then return result;end if;
 select * into e from public.enrolments where id=p_enrolment_id;
 if not found then raise exception 'Student enrolment not found.';end if;
 select * into g from public.exam_groups where id=e.group_id for update;
 if g.is_archived then raise exception 'Restore the archived group before replacing an ID.';end if;
 select * into e from public.enrolments where id=p_enrolment_id for update;
 if e.version is distinct from p_expected_version then raise exception 'Student changed. Refresh and review the ID again.';end if;
 if e.student_code not like 'TEMP/%' then raise exception 'This student already has an official ID.';end if;
 code:=app_private.online_import_code(p_official_id,g.exam_year);
 if code is null or char_length(code)>100 then raise exception 'Enter an official number or SC/year/number matching this group.';end if;
 if char_length(btrim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'Give a reason for replacing this ID.';end if;
 if exists(select 1 from public.enrolments where group_id=g.id and student_code=code)
  or exists(select 1 from public.student_id_aliases where group_id=g.id and student_code=code) then
  raise exception 'This ID already belongs to another record. Review the existing student and correct duplicate entries before continuing. Marks will not be merged.';
 end if;
 insert into public.student_id_aliases(group_id,student_code,enrolment_id,created_by) values(g.id,e.student_code,e.id,auth.uid());
 update public.enrolments set student_code=code,version=version+1 where id=e.id;
 insert into public.student_change_history(enrolment_id,actor_id,action,before_values,after_values)
 values(e.id,auth.uid(),'Replaced temporary ID: '||btrim(p_reason),jsonb_build_object('student_code',e.student_code),jsonb_build_object('student_code',code));
 update public.marks_tests set revision=revision+1 where id in(select test_id from public.test_scores where enrolment_id=e.id);
 result:=jsonb_build_object('id',e.id,'student_code',code);
 insert into public.marks_write_requests values(p_request_id,auth.uid(),payload,result,now());return result;
end; $$;

create or replace function public.app_link_returning_student(
 p_group_id uuid,p_source_enrolment_id uuid,p_target_enrolment_id uuid,p_official_id text,p_school text,p_stream text,
 p_expected_target_version bigint,p_expected_source_student_version bigint,p_expected_source_person_id uuid,p_reason text,p_confirmed boolean,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare src public.enrolments%rowtype; dst public.enrolments%rowtype; person public.students%rowtype;
 g public.exam_groups%rowtype; source_year integer; old_person uuid; old_name text; result jsonb; payload jsonb;
begin
 if not app_private.is_admin() then raise exception 'Only active admins can link returning students.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 payload:=jsonb_build_array('link returning student',p_group_id,p_source_enrolment_id,p_target_enrolment_id,p_official_id,p_school,p_stream,p_expected_target_version,p_expected_source_student_version,p_expected_source_person_id,p_reason,p_confirmed);
 result:=app_private.marks_receipt(p_request_id,payload);if result is not null then return result;end if;
 if not coalesce(p_confirmed,false) or char_length(btrim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'Confirm the same person and give a linking reason.';end if;
 select * into src from public.enrolments where id=p_source_enrolment_id;
 if not found then raise exception 'Earlier enrolment not found.';end if;
 perform 1 from public.exam_groups where id in(p_group_id,src.group_id) order by id for update;
 select * into g from public.exam_groups where id=p_group_id;
 if not found or g.is_archived then raise exception 'Choose an active target exam-year group.';end if;
 select exam_year into source_year from public.exam_groups where id=src.group_id;
 if g.exam_year<=source_year then raise exception 'Choose an enrolment from an earlier exam year.';end if;
 select * into src from public.enrolments where id=p_source_enrolment_id for update;
 if not found or src.student_id is distinct from p_expected_source_person_id then raise exception 'Earlier enrolment changed. Search again.';end if;
 if p_target_enrolment_id is not null then
  select * into dst from public.enrolments where id=p_target_enrolment_id for update;
  if not found or dst.group_id<>g.id then raise exception 'Choose a student in the target group.';end if;
  if dst.version is distinct from p_expected_target_version then raise exception 'Target student changed. Refresh and review again.';end if;
 end if;
 perform 1 from public.students where id in(src.student_id,dst.student_id) order by id for update;
 select * into person from public.students where id=src.student_id;
 if person.version is distinct from p_expected_source_student_version then raise exception 'Earlier student details changed. Search and review again.';end if;
 if exists(select 1 from public.enrolments where group_id=g.id and student_id=src.student_id and id is distinct from dst.id) then
  raise exception 'This person already has an enrolment in the target year. Review that record; duplicate marks are never combined.';
 end if;
 if dst.id is not null and dst.student_id<>src.student_id and exists(select 1 from public.enrolments where student_id=dst.student_id and id<>dst.id) then
  raise exception 'The target is already linked to other years. Review those links before changing its identity.';
 end if;
 if dst.id is null then
  result:=public.app_add_student(g.id,person.name,p_school,p_stream,p_official_id,gen_random_uuid());
  select * into dst from public.enrolments where id=(result->>'id')::uuid;
 end if;
 old_person:=dst.student_id;select name into old_name from public.students where id=old_person;
 if old_person<>src.student_id then
  update public.enrolments set student_id=src.student_id,version=version+1 where id=dst.id;
  insert into public.student_change_history(enrolment_id,actor_id,action,before_values,after_values)
   values(dst.id,auth.uid(),'Linked returning student: '||btrim(p_reason),jsonb_build_object('student_id',old_person,'name',old_name),jsonb_build_object('student_id',src.student_id,'name',person.name,'source_enrolment_id',src.id));
  delete from public.students s where s.id=old_person and not exists(select 1 from public.enrolments where student_id=s.id);
  update public.marks_tests set revision=revision+1 where id in(select test_id from public.test_scores where enrolment_id=dst.id);
 end if;
 result:=jsonb_build_object('id',dst.id,'student_code',dst.student_code,'name',person.name);
 insert into public.marks_write_requests values(p_request_id,auth.uid(),payload,result,now());return result;
end; $$;
revoke all on function public.app_search_student_identities(text),public.app_replace_temporary_id(uuid,text,bigint,text,uuid),public.app_link_returning_student(uuid,uuid,uuid,text,text,text,bigint,bigint,uuid,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.app_search_student_identities(text),public.app_replace_temporary_id(uuid,text,bigint,text,uuid),public.app_link_returning_student(uuid,uuid,uuid,text,text,text,bigint,bigint,uuid,text,boolean,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
