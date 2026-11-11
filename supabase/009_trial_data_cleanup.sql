-- Run after 008. Adds cleanup controls; running this script deletes nothing.
begin;
create table if not exists public.trial_cleanup_runs (
 request_id uuid primary key, actor_id uuid not null references public.profiles(id),
 group_id uuid not null references public.exam_groups(id), payload jsonb not null,
 result jsonb not null, created_at timestamptz not null default now()
);
create table if not exists public.cleared_student_requests (
 request_id uuid primary key, cleanup_id uuid not null references public.trial_cleanup_runs(request_id)
);
alter table public.trial_cleanup_runs enable row level security;
alter table public.cleared_student_requests enable row level security;
revoke all on public.trial_cleanup_runs,public.cleared_student_requests from public,anon,authenticated;

-- Old browser retries must not recreate a student removed by cleanup.
create or replace function app_private.reject_cleared_student_request()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.cleared_student_requests where request_id=new.request_id) then
   raise exception 'This student save belongs to cleared trial data. Start a new student entry.';
 end if;
 return new;
end; $$;
drop trigger if exists reject_cleared_student_request on public.enrolments;
create trigger reject_cleared_student_request before insert on public.enrolments
 for each row execute function app_private.reject_cleared_student_request();

-- Only the fingerprint and a summary leave this function. The underlying
-- rows are included in the hash so a changed record invalidates a preview.
create or replace function app_private.trial_cleanup_snapshot(p_group_id uuid,p_remove_students boolean)
returns jsonb language plpgsql set search_path='' as $$
declare g public.exam_groups%rowtype; state jsonb; counts jsonb; tests jsonb;
begin
 select * into g from public.exam_groups where id=p_group_id;
 select jsonb_build_object(
  'group',to_jsonb(g),'remove_students',p_remove_students,
  'tests',(select jsonb_agg(to_jsonb(t) order by t.id) from public.marks_tests t where t.group_id=g.id),
  'scores',(select jsonb_agg(to_jsonb(s) order by s.test_id,s.enrolment_id) from public.test_scores s where s.group_id=g.id),
  'participants',(select jsonb_agg(to_jsonb(p) order by p.test_id,p.marker_id) from public.test_participants p join public.marks_tests t on t.id=p.test_id where t.group_id=g.id),
  'history',(select jsonb_agg(to_jsonb(h) order by h.id) from public.test_mark_history h join public.marks_tests t on t.id=h.test_id where t.group_id=g.id),
  'files',(select jsonb_agg(to_jsonb(b) order by b.id) from public.online_import_batches b join public.marks_tests t on t.id=b.test_id where t.group_id=g.id),
  'rows',(select jsonb_agg(to_jsonb(r) order by r.id) from public.online_import_rows r join public.marks_tests t on t.id=r.test_id where t.group_id=g.id),
  'file_receipts',(select jsonb_agg(to_jsonb(r) order by r.test_id,r.rows_hash) from public.online_file_import_receipts r join public.marks_tests t on t.id=r.test_id where t.group_id=g.id),
  'reports',(select jsonb_agg(to_jsonb(r) order by r.id) from public.saved_reports r where r.group_id=g.id),
  'report_tests',(select jsonb_agg(to_jsonb(rt) order by rt.report_id,rt.position) from public.saved_report_tests rt join public.saved_reports r on r.id=rt.report_id where r.group_id=g.id),
  'students',(select jsonb_agg(jsonb_build_array(to_jsonb(e),to_jsonb(s),sc.name) order by e.id) from public.enrolments e join public.students s on s.id=e.student_id join public.schools sc on sc.id=e.school_id where e.group_id=g.id),
  'student_history',case when p_remove_students then (select jsonb_agg(to_jsonb(h) order by h.id) from public.student_change_history h join public.enrolments e on e.id=h.enrolment_id where e.group_id=g.id) end
 ) into state;
 counts:=jsonb_build_object(
  'tests',coalesce(jsonb_array_length(nullif(state->'tests','null'::jsonb)),0),
  'scores',coalesce(jsonb_array_length(nullif(state->'scores','null'::jsonb)),0),
  'participants',coalesce(jsonb_array_length(nullif(state->'participants','null'::jsonb)),0),
  'history',coalesce(jsonb_array_length(nullif(state->'history','null'::jsonb)),0)+coalesce(jsonb_array_length(nullif(state->'student_history','null'::jsonb)),0),
  'import_files',coalesce(jsonb_array_length(nullif(state->'files','null'::jsonb)),0),
  'import_rows',coalesce(jsonb_array_length(nullif(state->'rows','null'::jsonb)),0),
  'reports',coalesce(jsonb_array_length(nullif(state->'reports','null'::jsonb)),0),
  'students',case when p_remove_students then coalesce(jsonb_array_length(nullif(state->'students','null'::jsonb)),0) else 0 end,
  'students_kept',case when p_remove_students then 0 else coalesce(jsonb_array_length(nullif(state->'students','null'::jsonb)),0) end
 );
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'phase',t.phase,'paper',t.paper,'status',t.status) order by t.phase,t.paper,t.id),'[]'::jsonb)
 into tests from public.marks_tests t where t.group_id=g.id;
 return jsonb_build_object('group_id',g.id,'exam_year',g.exam_year,'remove_students',p_remove_students,
  'fingerprint',md5(state::text),'counts',counts,'tests',tests,'confirmation','CLEAR TRIAL '||g.exam_year);
end; $$;

create or replace function public.app_preview_trial_cleanup(p_group_id uuid,p_remove_students boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare g public.exam_groups%rowtype;
begin
 if not app_private.is_admin() then raise exception 'Only active admins can clear trial data.'; end if;
 if p_remove_students is null then raise exception 'Choose whether student records are included.'; end if;
 select * into g from public.exam_groups where id=p_group_id for update;
 if not found then raise exception 'Exam group not found.'; end if;
 if g.is_archived then raise exception 'Restore the archived group before clearing its trial data.'; end if;
 return app_private.trial_cleanup_snapshot(g.id,p_remove_students);
end; $$;

create or replace function public.app_clear_trial_data(p_group_id uuid,p_remove_students boolean,p_expected_fingerprint text,p_confirmation text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare g public.exam_groups%rowtype; preview jsonb; payload jsonb; previous public.trial_cleanup_runs%rowtype;
 result jsonb; tids uuid[]; eids uuid[]; sids uuid[]; affected_ids text[];
begin
 if not app_private.is_admin() then raise exception 'Only active admins can clear trial data.'; end if;
 if p_request_id is null or p_remove_students is null then raise exception 'A cleanup request and student choice are required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 payload:=jsonb_build_array(p_group_id,p_remove_students,p_expected_fingerprint,p_confirmation);
 select * into previous from public.trial_cleanup_runs where request_id=p_request_id;
 if found then
  if previous.actor_id<>auth.uid() or previous.payload<>payload then raise exception 'This cleanup request belongs to a different action.'; end if;
  return previous.result;
 end if;
 select * into g from public.exam_groups where id=p_group_id for update;
 if not found then raise exception 'Exam group not found.'; end if;
 if g.is_archived then raise exception 'Restore the archived group before clearing its trial data.'; end if;
 if p_confirmation is distinct from 'CLEAR TRIAL '||g.exam_year then raise exception 'Type CLEAR TRIAL followed by this exam year exactly.'; end if;
 perform 1 from public.marks_tests where group_id=g.id order by id for update;
 if p_remove_students then
  perform 1 from public.students where id in(select student_id from public.enrolments where group_id=g.id) order by id for update;
 end if;
 preview:=app_private.trial_cleanup_snapshot(g.id,p_remove_students);
 if p_expected_fingerprint is distinct from preview->>'fingerprint' then raise exception 'Data changed since preview. Review the cleanup again.'; end if;
 select coalesce(array_agg(id),'{}') into tids from public.marks_tests where group_id=g.id;
 select coalesce(array_agg(id),'{}'),coalesce(array_agg(student_id),'{}') into eids,sids from public.enrolments where group_id=g.id;
 result:=jsonb_build_object('cleared',true,'group_id',g.id,'exam_year',g.exam_year,'counts',preview->'counts','removed_test_ids',to_jsonb(tids));
 insert into public.trial_cleanup_runs(request_id,actor_id,group_id,payload,result) values(p_request_id,auth.uid(),g.id,payload,result);
 if p_remove_students then
  insert into public.cleared_student_requests(request_id,cleanup_id) select request_id,p_request_id from public.enrolments where group_id=g.id;
 end if;
 -- Remove dependent reports first, then score history before import rows.
 delete from public.saved_report_tests where report_id in(select id from public.saved_reports where group_id=g.id);
 delete from public.saved_reports where group_id=g.id;
 delete from public.test_mark_history where test_id=any(tids);
 delete from public.test_scores where test_id=any(tids);
 delete from public.test_participants where test_id=any(tids);
 delete from public.online_file_import_receipts where test_id=any(tids);
 delete from public.online_import_rows where test_id=any(tids);
 delete from public.online_import_batches where test_id=any(tids);
 delete from public.marks_tests where id=any(tids);
 if p_remove_students then
  delete from public.student_change_history where enrolment_id=any(eids);
  delete from public.enrolments where id=any(eids);
  delete from public.students s where s.id=any(sids) and not exists(select 1 from public.enrolments e where e.student_id=s.id);
 end if;
 -- Receipts may contain trial names/marks. Keep a minimal retry tombstone
 -- instead of the old payload so delayed writes cannot replay cleared work.
 affected_ids:=array[g.id::text]||tids::text[]||case when p_remove_students then eids::text[] else '{}'::text[] end;
 update public.marks_write_requests w set payload=jsonb_build_array('Cleared trial data',g.id,p_request_id),result=jsonb_build_object('cleared',true)
 where exists(select 1 from unnest(affected_ids) target where w.payload::text like '%'||target||'%' or w.result::text like '%'||target||'%');
 -- Keep group, temporary-ID counter, schools, accounts and other exam years.
 return result;
end; $$;
revoke all on function app_private.reject_cleared_student_request(),app_private.trial_cleanup_snapshot(uuid,boolean) from public,anon,authenticated;
revoke all on function public.app_preview_trial_cleanup(uuid,boolean),public.app_clear_trial_data(uuid,boolean,text,text,uuid) from public,anon,authenticated;
grant execute on function public.app_preview_trial_cleanup(uuid,boolean),public.app_clear_trial_data(uuid,boolean,text,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
