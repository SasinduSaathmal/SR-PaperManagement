-- Run after 011. Adds participant changes without deleting scores or reports.
begin;
alter table public.test_scores add column if not exists original_marker_id uuid references public.profiles(id);
update public.test_scores set original_marker_id=marker_id where source='Paper' and original_marker_id is null;
alter table public.test_mark_history add column if not exists participant_details jsonb;
create or replace function app_private.preserve_original_marker()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' then new.original_marker_id:=coalesce(old.original_marker_id,case when old.source='Paper' then old.marker_id end,new.original_marker_id);end if;
 if new.source='Paper' then new.original_marker_id:=coalesce(new.original_marker_id,new.marker_id);end if;
 return new;
end; $$;
drop trigger if exists preserve_original_marker on public.test_scores;
create trigger preserve_original_marker before insert or update on public.test_scores for each row execute function app_private.preserve_original_marker();

create or replace function public.app_manage_test_participant(p_test_id uuid,p_action text,p_marker_id uuid,p_transfer_to uuid,p_expected_revision bigint,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.marks_tests%rowtype;p public.test_participants%rowtype;u public.profiles%rowtype;recipient public.profiles%rowtype;
 score public.test_scores%rowtype;payload jsonb;result jsonb;transferred integer:=0;
begin
 if not app_private.is_admin() then raise exception 'Only active admins can manage test participants.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 payload:=jsonb_build_array('manage participant',p_test_id,p_action,p_marker_id,p_transfer_to,p_expected_revision);
 result:=app_private.marks_receipt(p_request_id,payload);if result is not null then return result;end if;
 t:=app_private.lock_marks_test(p_test_id);
 if t.status<>'Open' then raise exception 'Reopen this test before changing participants.';end if;
 if t.revision is distinct from p_expected_revision then raise exception 'Test changed. Refresh and review participants again.';end if;
 perform 1 from public.profiles where id in(p_marker_id,p_transfer_to) order by id for update;
 select * into u from public.profiles where id=p_marker_id for update;
 if not found then raise exception 'Account not found.';end if;
 select * into p from public.test_participants where test_id=t.id and marker_id=u.id for update;
 if p_action='add' then
  if p.marker_id is not null then raise exception 'This marker is already participating.';end if;
  if not u.is_active then raise exception 'Reactivate the account before adding it to a test.';end if;
  insert into public.test_participants(test_id,marker_id) values(t.id,u.id);
  insert into public.test_mark_history(test_id,actor_id,action,participant_details) values(t.id,auth.uid(),'Added participant: '||u.display_name,jsonb_build_object('marker_id',u.id));
 elsif p_action='remove' then
  if p.marker_id is null then raise exception 'This marker is not participating.';end if;
  if (select count(*) from public.test_participants where test_id=t.id)<=1 then raise exception 'Add another participant before removing the last marker.';end if;
  if exists(select 1 from public.test_scores where test_id=t.id and marker_id=u.id and source='Paper') then
   select * into recipient from public.profiles where id=p_transfer_to and is_active for update;
   if not found or recipient.id=u.id or not exists(select 1 from public.test_participants where test_id=t.id and marker_id=recipient.id) then raise exception 'Reassign this batch to another active participant before removing its marker.';end if;
   for score in select * from public.test_scores where test_id=t.id and marker_id=u.id and source='Paper' order by enrolment_id for update loop
    update public.test_scores set marker_id=recipient.id,version=version+1,updated_by=auth.uid(),updated_at=now() where test_id=t.id and enrolment_id=score.enrolment_id;
    insert into public.test_mark_history(test_id,enrolment_id,actor_id,action,before_cents,after_cents,participant_details)
    values(t.id,score.enrolment_id,auth.uid(),'Reassigned batch: '||u.display_name||' to '||recipient.display_name,score.cents,score.cents,jsonb_build_object('from',u.id,'to',recipient.id,'original_marker_id',coalesce(score.original_marker_id,u.id)));
    transferred:=transferred+1;
   end loop;
   update public.test_participants set batch_revision=batch_revision+1 where test_id=t.id and marker_id=recipient.id;
  end if;
  insert into public.test_mark_history(test_id,actor_id,action,participant_details)
   values(t.id,auth.uid(),'Removed participant: '||u.display_name,jsonb_build_object('removed_submission',to_jsonb(p),'transferred_rows',transferred,'recipient',recipient.id));
  delete from public.test_participants where test_id=t.id and marker_id=u.id;
 else raise exception 'Choose add or remove participant.';end if;
 update public.marks_tests set revision=revision+1 where id=t.id;
 result:=jsonb_build_object('transferred',transferred);insert into public.marks_write_requests values(p_request_id,auth.uid(),payload,result,now());return result;
end; $$;
revoke all on function app_private.preserve_original_marker() from public,anon,authenticated;
revoke all on function public.app_manage_test_participant(uuid,text,uuid,uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.app_manage_test_participant(uuid,text,uuid,uuid,bigint,uuid) to authenticated;

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
    'students',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',s.name,'student_code',e.student_code,'stream',e.stream,'is_active',e.is_active,'school',sc.name,'linked_ids',(select jsonb_agg(c.student_code order by c.student_code) from (select e2.student_code from public.enrolments e2 where e2.student_id=e.student_id union select a.student_code from public.student_id_aliases a join public.enrolments e2 on e2.id=a.enrolment_id where e2.student_id=e.student_id) c)) order by s.name,e.id)
      from public.enrolments e join public.students s on s.id=e.student_id join public.schools sc on sc.id=e.school_id
      where e.group_id=t.group_id and (e.is_active or exists(select 1 from public.test_scores x where x.test_id=p_test_id and x.enrolment_id=e.id and not x.is_deleted))),'[]'::jsonb),
    'scores',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('marker_name',u.display_name,'original_marker_name',original.display_name) order by s.enrolment_id)
      from public.test_scores s left join public.profiles u on u.id=s.marker_id left join public.profiles original on original.id=s.original_marker_id where s.test_id=p_test_id),'[]'::jsonb),
    'history',case when app_private.is_admin() then coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id) from (
      select h.*,u.display_name as actor_name from public.test_mark_history h join public.profiles u on u.id=h.actor_id
      where h.test_id=p_test_id order by h.created_at desc,h.id limit 100) h),'[]'::jsonb) else '[]'::jsonb end);
  return result||jsonb_build_object('pending_online',(select count(*) from public.online_import_rows where test_id=p_test_id and status='Pending'),'has_import_history',exists(select 1 from public.online_import_batches where test_id=p_test_id),'has_report_history',exists(select 1 from public.saved_report_tests where test_id=p_test_id));
end; $$;


notify pgrst,'reload schema';
commit;
