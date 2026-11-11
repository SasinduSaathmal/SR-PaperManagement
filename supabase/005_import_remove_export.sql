-- Run once in Supabase SQL Editor after 004_shared_test_marks.sql.
-- Adds functions only. Existing students, scores and test history are retained.
begin;

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
    school_text := regexp_replace(btrim(item->>'school'),'\s+',' ','g');
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
      select * into existing from public.enrolments where group_id=g.id and student_code=code;
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

create or replace function public.app_remove_empty_test(p_test_id uuid,p_expected_revision bigint,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.marks_tests%rowtype; payload jsonb; result jsonb;
begin
  if not app_private.is_admin() then raise exception 'Only active admins can remove tests.'; end if;
  if p_request_id is null then raise exception 'A request ID is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  payload := jsonb_build_array('remove empty test',p_test_id,p_expected_revision);
  result := app_private.marks_receipt(p_request_id,payload);
  if result is not null then return result; end if;
  t := app_private.lock_marks_test(p_test_id);
  if t.id is null then raise exception 'Test no longer exists.'; end if;
  if t.revision is distinct from p_expected_revision then raise exception 'This test changed. Refresh before removing it.'; end if;
  if exists(select 1 from public.test_scores where test_id=t.id)
     or exists(select 1 from public.test_mark_history where test_id=t.id and action<>'Created test')
     or exists(select 1 from public.test_participants where test_id=t.id and (batch_revision<>0 or submitted_revision is not null)) then
    raise exception 'This test has recorded work or history. Cancel it instead of removing it.';
  end if;
  delete from public.test_participants where test_id=t.id;
  delete from public.test_mark_history where test_id=t.id and action='Created test';
  delete from public.marks_tests where id=t.id;
  result := jsonb_build_object('removed',true);
  -- Receipt also retains the administrator and removal target for audit/retry.
  insert into public.marks_write_requests values(p_request_id,auth.uid(),payload,result,now());
  return result;
end; $$;

create or replace function public.app_export_marker_students(p_test_id uuid,p_marker_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t public.marks_tests%rowtype; marker public.profiles%rowtype; participant public.test_participants%rowtype;
begin
  if not app_private.is_active_member() then raise exception 'An active account is required.'; end if;
  if not app_private.is_admin() and p_marker_id is distinct from auth.uid() then raise exception 'You can download only your own marker batch.'; end if;
  select * into t from public.marks_tests where id=p_test_id;
  if not found then raise exception 'Test not found.'; end if;
  if t.status<>'Closed' then raise exception 'Close this test before downloading marker data.'; end if;
  select * into participant from public.test_participants where test_id=t.id and marker_id=p_marker_id;
  if not found then raise exception 'Marker is not a participant in this test.'; end if;
  if participant.submitted_revision is distinct from participant.batch_revision then raise exception 'This marker has not submitted their latest batch.'; end if;
  select * into marker from public.profiles where id=p_marker_id;
  return jsonb_build_object('test',to_jsonb(t),'exam_year',(select exam_year from public.exam_groups where id=t.group_id),
    'marker',jsonb_build_object('id',marker.id,'name',marker.display_name),
    'rows',coalesce((select jsonb_agg(jsonb_build_object('student_code',e.student_code,'name',s.name,'school',sc.name,'stream',e.stream,'cents',ts.cents) order by s.name,e.student_code)
      from public.test_scores ts join public.enrolments e on e.id=ts.enrolment_id join public.students s on s.id=e.student_id join public.schools sc on sc.id=e.school_id
      where ts.test_id=t.id and ts.marker_id=p_marker_id and ts.source='Paper' and not ts.is_deleted),'[]'::jsonb));
end; $$;

revoke all on function public.app_import_students(uuid,jsonb,uuid), public.app_remove_empty_test(uuid,bigint,uuid), public.app_export_marker_students(uuid,uuid) from public,anon,authenticated;
grant execute on function public.app_import_students(uuid,jsonb,uuid), public.app_remove_empty_test(uuid,bigint,uuid), public.app_export_marker_students(uuid,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
