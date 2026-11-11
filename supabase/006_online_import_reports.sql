-- Run after 005_import_remove_export.sql. Retains all existing data.
begin;
alter table public.test_scores drop constraint if exists test_scores_source_check;
alter table public.test_scores add constraint test_scores_source_check check(source in ('Paper','Zero fill','Online'));

create table if not exists public.online_import_batches (
 id uuid primary key default gen_random_uuid(), test_id uuid not null references public.marks_tests(id),
 filename text not null, heading text not null, content_hash text not null, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), unique(test_id,content_hash)
);
create table if not exists public.online_import_rows (
 id uuid primary key default gen_random_uuid(), batch_id uuid not null references public.online_import_batches(id),
 test_id uuid not null references public.marks_tests(id), row_number integer not null, raw jsonb not null,
 status text not null default 'Pending' check(status in ('Pending','Imported','Skipped','Dismissed')),
 message text not null default '', resolved_by uuid references public.profiles(id), reason text, resolved_at timestamptz
);
create index if not exists online_rows_pending on public.online_import_rows(test_id,status);
alter table public.test_mark_history add column if not exists import_row_id uuid references public.online_import_rows(id);
alter table public.online_import_batches enable row level security;
alter table public.online_import_rows enable row level security;
revoke all on public.online_import_batches,public.online_import_rows from public,anon,authenticated;
grant select on public.online_import_batches,public.online_import_rows to authenticated;
drop policy if exists online_batch_admin_read on public.online_import_batches;
create policy online_batch_admin_read on public.online_import_batches for select to authenticated using ((select app_private.is_admin()));
drop policy if exists online_rows_admin_read on public.online_import_rows;
create policy online_rows_admin_read on public.online_import_rows for select to authenticated using ((select app_private.is_admin()));

-- Called only with the parent group's and test's write locks held.
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
   select * into e from public.enrolments where group_id=g.id and student_code=code;
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
 owner_id := case when old.test_id is not null and not old.is_deleted then old.marker_id else null end;
 score_source := case when old.test_id is not null and not old.is_deleted then old.source else 'Online' end;
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

create or replace function public.app_stage_online_import(p_test_id uuid,p_filename text,p_heading text,p_rows jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.marks_tests%rowtype; g public.exam_groups%rowtype; payload jsonb; result jsonb; bid uuid; rid uuid; item jsonb; n integer:=0; part text[];
begin
 if not app_private.is_admin() then raise exception 'Only active admins can import online marks.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 payload := jsonb_build_array('online import',p_test_id,p_filename,p_heading,p_rows);
 result := app_private.marks_receipt(p_request_id,payload); if result is not null then return result; end if;
 t := app_private.lock_marks_test(p_test_id);
 if t.id is null or t.status<>'Open' then raise exception 'Online marks can only be imported into an open test.'; end if;
 select * into g from public.exam_groups where id=t.group_id;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'Choose student rows to import.'; end if;
 if jsonb_array_length(p_rows) not between 1 and 1000 then raise exception 'Import 1 to 1000 rows at a time.'; end if;
 if char_length(coalesce(p_filename,'')) not between 1 and 255 or char_length(coalesce(p_heading,''))>500 then raise exception 'Invalid filename or heading.'; end if;
 part := regexp_match(p_heading,'(?i)\m(20[0-9]{2})\M');
 if part is not null and part[1]::integer<>g.exam_year then raise exception 'Export year differs from this group.'; end if;
 part := regexp_match(p_heading,'(?i)paper\s*0*([0-9]+)');
 if part is not null and part[1]::integer<>t.paper then raise exception 'Export paper differs from this test.'; end if;
 part := regexp_match(p_heading,'(?i)phase\s*([0-9]+)');
 if part is not null and regexp_replace(lower(t.phase),'^phase\s*','') ~ '^[0-9]+$' and part[1]::integer<>regexp_replace(lower(t.phase),'^phase\s*','')::integer then raise exception 'Export phase differs from this test.'; end if;
 for item in select value from jsonb_array_elements(p_rows) loop
   if jsonb_typeof(item)<>'object' or octet_length(item::text)>10000 then raise exception 'Invalid import row.'; end if;
   part := regexp_match(coalesce(item->>'mark',''),'/\s*([0-9]+(\.[0-9]{1,2})?)\s*$');
   if part is not null and part[1]::numeric*100<>t.max_cents then raise exception 'Export marks denominator differs from this test maximum.'; end if;
 end loop;
 select id into bid from public.online_import_batches where test_id=t.id and content_hash=md5(p_rows::text);
 if bid is not null then
   result:=jsonb_build_object('batch_id',bid);
   insert into public.marks_write_requests values(p_request_id,auth.uid(),payload,result,now()); return result;
 end if;
 insert into public.online_import_batches(test_id,filename,heading,content_hash,created_by) values(t.id,p_filename,coalesce(p_heading,''),md5(p_rows::text),auth.uid()) returning id into bid;
 for item in select value from jsonb_array_elements(p_rows) loop
   n:=n+1;
   insert into public.online_import_rows(batch_id,test_id,row_number,raw) values(bid,t.id,n+1,item) returning id into rid;
   perform app_private.apply_online_row(rid,'{}',false,null,null);
 end loop;
 update public.marks_tests set revision=revision+1 where id=t.id;
 result:=jsonb_build_object('batch_id',bid);
 insert into public.marks_write_requests values(p_request_id,auth.uid(),payload,result,now()); return result;
end; $$;

create or replace function public.app_resolve_online_row(p_row_id uuid,p_action text,p_details jsonb,p_replace boolean,p_expected_version bigint,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.marks_tests%rowtype; r public.online_import_rows%rowtype; result jsonb; payload jsonb;
begin
 if not app_private.is_admin() then raise exception 'Only active admins can review imports.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 payload:=jsonb_build_array('resolve online row',p_row_id,p_action,p_details,p_replace,p_expected_version,p_reason);
 result:=app_private.marks_receipt(p_request_id,payload); if result is not null then return result; end if;
 select * into r from public.online_import_rows where id=p_row_id;
 if not found then raise exception 'Import row not found.'; end if;
 t:=app_private.lock_marks_test(r.test_id);
 if t.status<>'Open' then raise exception 'Reopen this test before reviewing import rows.'; end if;
 select * into r from public.online_import_rows where id=p_row_id for update;
 if r.status<>'Pending' then raise exception 'This row was already resolved. Refresh to see the outcome.'; end if;
 if p_action='dismiss' then
   if char_length(btrim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'Give a reason for dismissing this row.'; end if;
   update public.online_import_rows set status='Dismissed',message='Dismissed by admin',reason=btrim(p_reason),resolved_by=auth.uid(),resolved_at=now() where id=r.id;
 elsif p_action='import' then perform app_private.apply_online_row(r.id,p_details,p_replace,p_expected_version,p_reason);
 else raise exception 'Unknown import review action.'; end if;
 update public.marks_tests set revision=revision+1 where id=t.id;
 select jsonb_build_object('status',status,'message',message) into result from public.online_import_rows where id=r.id;
 insert into public.marks_write_requests values(p_request_id,auth.uid(),payload,result,now()); return result;
end; $$;

create or replace function public.app_get_online_imports(p_test_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
 if not app_private.is_admin() then raise exception 'Only active admins can view import details.'; end if;
 return coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.row_number) from public.online_import_rows r where r.batch_id=b.id),'[]'::jsonb)) order by b.created_at desc,b.id) from public.online_import_batches b where b.test_id=p_test_id),'[]'::jsonb);
end; $$;

create table if not exists public.saved_reports (
 id uuid primary key default gen_random_uuid(), group_id uuid not null references public.exam_groups(id),
 version integer not null, title text not null, is_final boolean not null, created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), snapshot jsonb not null, unique(group_id,version)
);
create table if not exists public.saved_report_tests (
 report_id uuid not null references public.saved_reports(id), test_id uuid not null references public.marks_tests(id),
 revision bigint not null, position integer not null, primary key(report_id,test_id)
);
alter table public.saved_reports enable row level security;
alter table public.saved_report_tests enable row level security;
revoke all on public.saved_reports,public.saved_report_tests from public,anon,authenticated;
grant select on public.saved_reports,public.saved_report_tests to authenticated;
drop policy if exists reports_read on public.saved_reports;
create policy reports_read on public.saved_reports for select to authenticated using ((select app_private.is_active_member()) and (is_final or (select app_private.is_admin())));
drop policy if exists report_tests_read on public.saved_report_tests;
create policy report_tests_read on public.saved_report_tests for select to authenticated using (exists(select 1 from public.saved_reports r where r.id=report_id));

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
 select coalesce(max(version),0)+1 into ver from public.saved_reports where group_id=g.id;
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

create or replace function public.app_list_reports(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
 if not app_private.is_active_member() then raise exception 'An active account is required.'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'version',r.version,'title',r.title,'is_final',r.is_final,'created_at',r.created_at,'creator',r.snapshot->>'creator',
 'changed',exists(select 1 from public.saved_report_tests rt join public.marks_tests t on t.id=rt.test_id where rt.report_id=r.id and t.revision<>rt.revision)) order by r.version desc)
 from public.saved_reports r where r.group_id=p_group_id and (r.is_final or app_private.is_admin())),'[]'::jsonb);
end; $$;

create or replace function public.app_get_report(p_report_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.saved_reports%rowtype;
begin
 if not app_private.is_active_member() then raise exception 'An active account is required.'; end if;
 select * into r from public.saved_reports where id=p_report_id;
 if not found or (not r.is_final and not app_private.is_admin()) then raise exception 'Report not found or access denied.'; end if;
 return r.snapshot||jsonb_build_object('source_changed',exists(select 1 from public.saved_report_tests rt join public.marks_tests t on t.id=rt.test_id where rt.report_id=r.id and t.revision<>rt.revision));
end; $$;

revoke all on function app_private.apply_online_row(uuid,jsonb,boolean,bigint,text) from public,anon,authenticated;
revoke all on function public.app_stage_online_import(uuid,text,text,jsonb,uuid),public.app_resolve_online_row(uuid,text,jsonb,boolean,bigint,text,uuid),public.app_get_online_imports(uuid),
 public.app_generate_report(uuid,uuid[],text,text,boolean,integer,uuid),public.app_list_reports(uuid),public.app_get_report(uuid) from public,anon,authenticated;
grant execute on function public.app_stage_online_import(uuid,text,text,jsonb,uuid),public.app_resolve_online_row(uuid,text,jsonb,boolean,bigint,text,uuid),public.app_get_online_imports(uuid),
 public.app_generate_report(uuid,uuid[],text,text,boolean,integer,uuid),public.app_list_reports(uuid),public.app_get_report(uuid) to authenticated;
-- Existing functions are updated below to integrate pending imports with completion.

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
    if exists(select 1 from public.online_import_rows where test_id=p_test_id and status='Pending') then raise exception 'Resolve or dismiss all pending online import rows before completing this test.'; end if;
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
  return result||jsonb_build_object('pending_online',(select count(*) from public.online_import_rows where test_id=p_test_id and status='Pending'),'has_import_history',exists(select 1 from public.online_import_batches where test_id=p_test_id),'has_report_history',exists(select 1 from public.saved_report_tests where test_id=p_test_id));
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
  if exists(select 1 from public.online_import_batches where test_id=t.id) or exists(select 1 from public.saved_report_tests where test_id=t.id) then raise exception 'This test has online import or report history. Cancel it instead.'; end if;
  delete from public.test_participants where test_id=t.id;
  delete from public.test_mark_history where test_id=t.id and action='Created test';
  delete from public.marks_tests where id=t.id;
  result := jsonb_build_object('removed',true);
  -- Receipt also retains the administrator and removal target for audit/retry.
  insert into public.marks_write_requests values(p_request_id,auth.uid(),payload,result,now());
  return result;
end; $$;


notify pgrst, 'reload schema';
commit;
