-- Run after 006_online_import_reports.sql. Keeps marks and saved reports unchanged.
begin;

create or replace function public.app_save_test_score(
 p_test_id uuid,p_enrolment_id uuid,p_text text,p_expected_version bigint,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.marks_tests%rowtype; e public.enrolments%rowtype; old public.test_scores%rowtype;
 value integer; ver bigint; result jsonb; payload jsonb; owner_id uuid; own_batch boolean; converting_zero_fill boolean;
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
  converting_zero_fill := coalesce(old.test_id is not null and not old.is_deleted and old.source='Zero fill',false);
  if old.test_id is not null and not old.is_deleted then
    owner_id:=case when converting_zero_fill then auth.uid() else old.marker_id end;
    if (converting_zero_fill or owner_id is distinct from auth.uid()) and not app_private.is_admin() then
      raise exception 'This score belongs to another marker or an admin zero-fill. Ask an admin to review it.';
    end if;
  else owner_id:=auth.uid(); end if;
  own_batch:=owner_id is not distinct from auth.uid();
  if own_batch and not exists(select 1 from public.test_participants where test_id=p_test_id and marker_id=auth.uid()) and not (converting_zero_fill and app_private.is_admin()) then
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
      source=case when public.test_scores.is_deleted or public.test_scores.source='Zero fill' then 'Paper' else public.test_scores.source end,
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


-- An admin may attest that a selected marker had no papers. Never bypass a
-- batch that has saved/deleted entries, an earlier paper revision, or drafts
-- known to the caller. Markers can still submit their own empty batches.
create or replace function public.app_confirm_empty_marker_batch(
 p_test_id uuid,p_marker_id uuid,p_expected_batch_revision bigint,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.marks_tests%rowtype; p public.test_participants%rowtype; result jsonb; payload jsonb; marker_name text;
begin
 if not app_private.is_admin() then raise exception 'Only active admins can confirm an empty marker batch.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 payload:=jsonb_build_array('confirm empty batch',p_test_id,p_marker_id,p_expected_batch_revision);
 result:=app_private.marks_receipt(p_request_id,payload); if result is not null then return result; end if;
 t:=app_private.lock_marks_test(p_test_id);
 if t.status<>'Open' then raise exception 'Only an open test can have its batches confirmed.'; end if;
 select * into p from public.test_participants where test_id=p_test_id and marker_id=p_marker_id for update;
 if not found then raise exception 'This marker is not a participant in the test.'; end if;
 if p_expected_batch_revision is distinct from p.batch_revision then raise exception 'This marker batch changed. Refresh before confirming.'; end if;
 if p.batch_revision<>0 or exists(select 1 from public.test_scores where test_id=p_test_id and marker_id=p_marker_id) then
   raise exception 'This marker has recorded work. They must review and submit their own batch.';
 end if;
 if p.submitted_revision is distinct from p.batch_revision then
   update public.test_participants set submitted_revision=batch_revision,submitted_at=now() where test_id=p_test_id and marker_id=p_marker_id;
   select display_name into marker_name from public.profiles where id=p_marker_id;
   insert into public.test_mark_history(test_id,actor_id,action) values(p_test_id,auth.uid(),'Confirmed no papers for '||marker_name||' ('||p_marker_id||')');
   update public.marks_tests set revision=revision+1 where id=p_test_id;
 end if;
 result:=jsonb_build_object('submitted',true,'empty',true);
 insert into public.marks_write_requests values(p_request_id,auth.uid(),payload,result,now()); return result;
end; $$;
revoke all on function public.app_confirm_empty_marker_batch(uuid,uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.app_confirm_empty_marker_batch(uuid,uuid,bigint,uuid) to authenticated;
revoke all on function app_private.apply_online_row(uuid,jsonb,boolean,bigint,text) from public,anon,authenticated;

-- Repair the earlier attribution bug without changing numeric marks or
-- submission revisions. Group -> test -> score is the normal write lock order.
-- Saved report snapshots are immutable and deliberately not rewritten.
do $$
declare gid uuid; tid uuid; row_data public.test_scores%rowtype; online_edit boolean; repaired boolean;
begin
 for gid in select distinct group_id from public.test_scores where source='Zero fill' and cents>0 order by group_id loop
   perform 1 from public.exam_groups where id=gid for update;
   for tid in select distinct test_id from public.test_scores where group_id=gid and source='Zero fill' and cents>0 order by test_id loop
     perform 1 from public.marks_tests where id=tid for update;
     repaired:=false;
     for row_data in select * from public.test_scores where test_id=tid and source='Zero fill' and cents>0 and not is_deleted for update loop
       select coalesce((select action='Imported online score' from public.test_mark_history
         where test_id=tid and enrolment_id=row_data.enrolment_id and actor_id=row_data.updated_by and created_at=row_data.updated_at and action in ('Saved score','Imported online score')
         order by created_at desc,id desc limit 1),false) into online_edit;
       update public.test_scores set source=case when online_edit then 'Online' else 'Paper' end,
         marker_id=case when online_edit then null else row_data.updated_by end,version=version+1
         where test_id=tid and enrolment_id=row_data.enrolment_id;
       insert into public.test_mark_history(test_id,enrolment_id,actor_id,action,before_cents,after_cents)
         values(tid,row_data.enrolment_id,row_data.updated_by,'Repaired zero-fill attribution to original editor (migration)',row_data.cents,row_data.cents);
       repaired:=true;
     end loop;
     if repaired then update public.marks_tests set revision=revision+1 where id=tid; end if;
   end loop;
 end loop;
end; $$;
notify pgrst, 'reload schema';
commit;
