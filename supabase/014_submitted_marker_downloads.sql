-- Run after 013. Downloads are generated on demand; no files or snapshots are stored.
begin;

create or replace function public.app_export_marker_students(p_test_id uuid,p_marker_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t public.marks_tests%rowtype; marker public.profiles%rowtype; participant public.test_participants%rowtype;
begin
  if not app_private.is_active_member() then raise exception 'An active account is required.'; end if;
  if not app_private.is_admin() and p_marker_id is distinct from auth.uid() then raise exception 'You can download only your own marker batch.'; end if;
  select * into t from public.marks_tests where id=p_test_id;
  if not found then raise exception 'Test not found.'; end if;
  if t.status not in ('Open','Closed') then raise exception 'Cancelled tests cannot be downloaded.'; end if;
  select * into participant from public.test_participants where test_id=t.id and marker_id=p_marker_id;
  if not found then raise exception 'Marker is not a participant in this test.'; end if;
  if participant.submitted_at is null or participant.submitted_revision is null or participant.submitted_revision is distinct from participant.batch_revision then raise exception 'This marker has not submitted their latest batch.'; end if;
  select * into marker from public.profiles where id=p_marker_id;
  return jsonb_build_object('test',to_jsonb(t),'exam_year',(select exam_year from public.exam_groups where id=t.group_id),
    'marker',jsonb_build_object('id',marker.id,'name',marker.display_name),
    'submission',jsonb_build_object('revision',participant.submitted_revision,'submitted_at',participant.submitted_at),
    'rows',coalesce((select jsonb_agg(jsonb_build_object('student_code',e.student_code,'name',s.name,'school',sc.name,'stream',e.stream,'cents',ts.cents) order by s.name,e.student_code)
      from public.test_scores ts join public.enrolments e on e.id=ts.enrolment_id join public.students s on s.id=e.student_id join public.schools sc on sc.id=e.school_id
      where ts.test_id=t.id and ts.marker_id=p_marker_id and ts.source='Paper' and not ts.is_deleted),'[]'::jsonb));
end; $$;

revoke all on function public.app_export_marker_students(uuid,uuid) from public,anon,authenticated;
grant execute on function public.app_export_marker_students(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
