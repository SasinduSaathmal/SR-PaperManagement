-- Run after 014. Adds controls; does not delete reports or change marks on install.
begin;

-- Keep report version numbers increasing even when the latest snapshot is deleted.
alter table public.exam_groups add column if not exists report_version integer not null default 0 check(report_version>=0);
update public.exam_groups g set report_version=greatest(g.report_version,coalesce((select max(r.version) from public.saved_reports r where r.group_id=g.id),0));

create or replace function public.app_delete_saved_report(p_report_id uuid,p_expected_version integer,p_expected_created_at timestamptz,p_confirmed boolean,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.saved_reports%rowtype;payload jsonb;result jsonb;
begin
  if not app_private.is_admin() then raise exception 'Only active admins can delete saved reports.';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  payload:=jsonb_build_array('delete saved report',p_report_id,p_expected_version,p_expected_created_at,p_confirmed);
  result:=app_private.marks_receipt(p_request_id,payload);if result is not null then return result;end if;
  if not coalesce(p_confirmed,false) then raise exception 'Confirm permanent deletion of this saved report.';end if;
  select * into r from public.saved_reports where id=p_report_id;
  if not found then raise exception 'Report no longer exists. Refresh the report list.';end if;
  perform 1 from public.exam_groups where id=r.group_id for update;
  select * into r from public.saved_reports where id=p_report_id for update;
  if not found then raise exception 'Report no longer exists. Refresh the report list.';end if;
  if r.version is distinct from p_expected_version or r.created_at is distinct from p_expected_created_at then
    raise exception 'Report changed. Refresh and review it before deleting.';
  end if;
  update public.exam_groups set report_version=greatest(report_version,r.version) where id=r.group_id;
  delete from public.saved_report_tests where report_id=r.id;
  delete from public.saved_reports where id=r.id;
  -- A timed-out generation retry must not return the deleted snapshot as a success.
  update public.marks_write_requests w set payload=jsonb_build_array('Deleted saved report',r.id),result=jsonb_build_object('deleted',true)
    where w.result->>'id'=r.id::text;
  result:=jsonb_build_object('deleted',true,'id',r.id,'version',r.version);
  insert into public.marks_write_requests values(p_request_id,auth.uid(),payload,result,now());return result;
end $$;

create index if not exists test_mark_history_student_index on public.test_mark_history(enrolment_id,test_id,created_at desc,id desc);

-- Current saved scores use the same active-member visibility as the test workspace.
-- Private score-change history is exposed separately, to admins only.
create or replace function public.app_student_marks_history(p_enrolment_id uuid,p_include_linked_years boolean,p_limit integer default 25,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare root public.enrolments%rowtype;eids uuid[];entries jsonb;total bigint;admin boolean;
begin
  if not app_private.is_active_member() then raise exception 'An active account is required.';end if;
  if p_include_linked_years is null or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0 then raise exception 'Choose a history scope and a page size from 1 to 100.';end if;
  select * into root from public.enrolments where id=p_enrolment_id;
  if not found then raise exception 'Student enrolment no longer exists. Refresh the student directory.';end if;
  admin:=app_private.is_admin();
  select array_agg(id) into eids from public.enrolments where case when p_include_linked_years then student_id=root.student_id else id=root.id end;
  select count(*) into total from public.enrolments e join public.marks_tests t on t.group_id=e.group_id where e.id=any(eids);
  select coalesce(jsonb_agg(to_jsonb(q) order by q.exam_year desc,q.test_date desc,q.phase,q.paper,q.test_id),'[]'::jsonb) into entries from (
    select e.id as enrolment_id,e.student_code,e.stream,g.exam_year,g.is_archived,t.id as test_id,t.phase,t.paper,t.test_date,t.status,t.max_cents,
      s.test_id is not null as has_score,coalesce(s.is_deleted,false) as is_deleted,
      case when not s.is_deleted then s.cents end as cents,s.source,s.updated_at,u.display_name as marker_name,
      original.display_name as original_marker_name,
      case when admin then (select count(*) from public.test_mark_history h where h.enrolment_id=e.id and h.test_id=t.id) end as change_count
    from public.enrolments e join public.exam_groups g on g.id=e.group_id join public.marks_tests t on t.group_id=e.group_id
    left join public.test_scores s on s.enrolment_id=e.id and s.test_id=t.id
    left join public.profiles u on u.id=s.marker_id left join public.profiles original on original.id=s.original_marker_id
    where e.id=any(eids) order by g.exam_year desc,t.test_date desc,t.phase,t.paper,t.id limit p_limit offset p_offset
  ) q;
  return jsonb_build_object('student',jsonb_build_object('id',root.student_id,'name',(select name from public.students where id=root.student_id),'student_code',root.student_code),
    'is_admin',admin,'total',total,'entries',entries,
    'enrolments',(select jsonb_agg(jsonb_build_object('id',e.id,'exam_year',g.exam_year,'student_code',e.student_code) order by g.exam_year desc) from public.enrolments e join public.exam_groups g on g.id=e.group_id where e.id=any(eids)));
end $$;

create or replace function public.app_student_mark_changes(p_enrolment_id uuid,p_test_id uuid,p_limit integer default 25,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare entries jsonb;total bigint;
begin
  if not app_private.is_admin() then raise exception 'Only active admins can inspect score changes.';end if;
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0 then raise exception 'Choose a page size from 1 to 100.';end if;
  if not exists(select 1 from public.enrolments e join public.marks_tests t on t.group_id=e.group_id where e.id=p_enrolment_id and t.id=p_test_id) then raise exception 'Student and test were not found in the same exam year.';end if;
  select count(*) into total from public.test_mark_history where enrolment_id=p_enrolment_id and test_id=p_test_id;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id desc),'[]'::jsonb) into entries from (
    select h.id,h.created_at,h.action,h.before_cents,h.after_cents,u.display_name as actor_name
    from public.test_mark_history h join public.profiles u on u.id=h.actor_id
    where h.enrolment_id=p_enrolment_id and h.test_id=p_test_id order by h.created_at desc,h.id desc limit p_limit offset p_offset
  ) q;
  return jsonb_build_object('total',total,'entries',entries);
end $$;

create or replace function public.app_generate_report(p_group_id uuid,p_test_ids uuid[],p_title text,p_layout text,p_include_ids boolean,p_top_n integer,p_request_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare g public.exam_groups%rowtype; t public.marks_tests%rowtype; tid uuid; result jsonb; payload jsonb;
 rid uuid:=gen_random_uuid(); final_report boolean:=true; tests jsonb; rows jsonb; maximum bigint; ver integer; creator text; generated timestamptz:=now();
begin
 if not app_private.is_admin() then raise exception 'Only active admins can generate reports.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 payload:=jsonb_build_array('generate report',p_group_id,p_test_ids,p_title,p_layout,p_include_ids,p_top_n);
 result:=app_private.marks_receipt(p_request_id,payload); if result is not null then return (result->>'id')::uuid; end if;
 select * into g from public.exam_groups where id=p_group_id for update;
 if not found then raise exception 'Exam group not found.'; end if;
 if coalesce(cardinality(p_test_ids),0) not between 1 and 30 or exists(select 1 from unnest(p_test_ids) x where x is null) or cardinality(p_test_ids)<>(select count(distinct x) from unnest(p_test_ids) x) then raise exception 'Choose 1 to 30 distinct tests.'; end if;
 if char_length(btrim(coalesce(p_title,''))) not between 1 and 200 or p_layout is null or p_layout not in ('summary','detailed','both') or p_include_ids is null or p_top_n is null or p_top_n not between 0 and 1000 then raise exception 'Enter a heading, layout, and Top N (zero for full list).'; end if;
 -- Same group-first order as score writes: all report inputs are read while writers are excluded.
 for tid in select x from unnest(p_test_ids) x order by x loop
   select * into t from public.marks_tests where id=tid for update;
   if not found or t.group_id<>g.id then raise exception 'All selected tests must belong to this exam group.'; end if;
   if t.status='Cancelled' then raise exception 'Cancelled tests cannot be included in reports.'; end if;
   if t.status<>'Closed' then final_report:=false; end if;
 end loop;
 update public.exam_groups set report_version=greatest(report_version,coalesce((select max(version) from public.saved_reports where group_id=g.id),0))+1 where id=g.id returning report_version into ver;
 select display_name into creator from public.profiles where id=auth.uid();
 select jsonb_agg(jsonb_build_object('id',mt.id,'phase',mt.phase,'paper',mt.paper,'date',mt.test_date,'max_cents',mt.max_cents,'revision',mt.revision,'status',mt.status) order by u.pos),sum(mt.max_cents)::bigint into tests,maximum
 from unnest(p_test_ids) with ordinality u(id,pos) join public.marks_tests mt on mt.id=u.id;
 with totals as (
   select e.id,e.student_code,s.name,sc.name as school,e.stream,
     sum(ts.cents)::bigint as total_cents,
     (select jsonb_agg((select to_jsonb(v.cents) from public.test_scores v where v.test_id=u.id and v.enrolment_id=e.id and not v.is_deleted) order by u.pos) from unnest(p_test_ids) with ordinality u(id,pos)) as scores
   from public.enrolments e join public.students s on s.id=e.student_id join public.schools sc on sc.id=e.school_id
     join public.test_scores ts on ts.enrolment_id=e.id and ts.test_id=any(p_test_ids) and not ts.is_deleted
   where e.group_id=g.id group by e.id,e.student_code,s.name,sc.name,e.stream
 ), ranked as (select *,rank() over(partition by stream order by total_cents desc) as rank from totals)
 select coalesce(jsonb_agg(to_jsonb(r) order by stream,rank,name,id),'[]'::jsonb) into rows from ranked r where p_top_n=0 or rank<=p_top_n;
 insert into public.saved_reports(id,group_id,version,title,is_final,created_by,created_at,snapshot)
 values(rid,g.id,ver,btrim(p_title),final_report,auth.uid(),generated,jsonb_build_object('id',rid,'version',ver,'title',btrim(p_title),'exam_year',g.exam_year,'is_final',final_report,'created_at',generated,'creator',creator,'tests',tests,'max_cents',maximum,'layout',p_layout,'include_ids',p_include_ids,'top_n',p_top_n,'rows',rows));
 insert into public.saved_report_tests(report_id,test_id,revision,position)
 select rid,mt.id,mt.revision,u.pos from unnest(p_test_ids) with ordinality u(id,pos) join public.marks_tests mt on mt.id=u.id;
 insert into public.marks_write_requests values(p_request_id,auth.uid(),payload,jsonb_build_object('id',rid),now()); return rid;
end; $$;

revoke all on function public.app_delete_saved_report(uuid,integer,timestamptz,boolean,uuid),public.app_student_marks_history(uuid,boolean,integer,integer),public.app_student_mark_changes(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.app_delete_saved_report(uuid,integer,timestamptz,boolean,uuid),public.app_student_marks_history(uuid,boolean,integer,integer),public.app_student_mark_changes(uuid,uuid,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
