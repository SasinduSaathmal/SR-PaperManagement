-- Run after 002_shared_students.sql. Retains all existing records.
begin;
alter table public.students add column if not exists version bigint not null default 1;
alter table public.enrolments add column if not exists version bigint not null default 1;
create table if not exists public.student_change_history (
  id uuid primary key default gen_random_uuid(),
  enrolment_id uuid not null references public.enrolments(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action text not null,
  before_values jsonb not null,
  after_values jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.student_change_history enable row level security;
revoke all on public.student_change_history from public, anon, authenticated;
grant select on public.student_change_history to authenticated;
drop policy if exists student_change_history_admin_read on public.student_change_history;
create policy student_change_history_admin_read on public.student_change_history
  for select to authenticated using ((select app_private.is_admin()));

create or replace function public.app_update_student(
  p_enrolment_id uuid, p_name text, p_school text, p_stream text,
  p_expected_enrolment_version bigint, p_expected_student_version bigint
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  enrolment public.enrolments%rowtype;
  person public.students%rowtype;
  group_row public.exam_groups%rowtype;
  new_name text := regexp_replace(btrim(p_name), '\s+', ' ', 'g');
  new_school text := regexp_replace(btrim(p_school), '\s+', ' ', 'g');
  selected_school_id uuid;
  old_school text;
  saved_school text;
  before_data jsonb;
  after_data jsonb;
begin
  if not app_private.is_admin() then raise exception 'Only active admins can edit students.'; end if;
  select * into enrolment from public.enrolments where id = p_enrolment_id;
  if not found then raise exception 'Student enrolment not found.'; end if;
  select * into group_row from public.exam_groups where id = enrolment.group_id for update;
  if group_row.is_archived then raise exception 'Archived groups are read-only. Restore the group before editing.'; end if;
  select * into person from public.students where id = enrolment.student_id for update;
  select * into enrolment from public.enrolments where id = p_enrolment_id for update;
  if p_expected_enrolment_version is distinct from enrolment.version
     or p_expected_student_version is distinct from person.version then
    raise exception 'This student was changed by another admin. Cancel, Refresh, and open Edit again.';
  end if;
  if new_name is null or char_length(new_name) not between 1 and 200 then raise exception 'Enter a student name (up to 200 characters).'; end if;
  if new_school is null or char_length(new_school) not between 1 and 200 then raise exception 'Enter a school name (up to 200 characters).'; end if;
  if p_stream is null or p_stream not in ('Maths', 'Bio') then raise exception 'Choose Maths or Bio.'; end if;
  -- A permanent name is shared by every linked enrolment. Do not alter names
  -- behind a read-only archive; other fields belong to this enrolment only.
  if new_name <> person.name and exists (
    select 1 from public.enrolments e join public.exam_groups g on g.id = e.group_id
    where e.student_id = person.id and g.is_archived
  ) then raise exception 'This name is also used in an archived group. Restore that group before changing the name.'; end if;
  select name into old_school from public.schools where id = enrolment.school_id;
  insert into public.schools as s(name) values (new_school)
    on conflict ((lower(name))) do update set name = s.name
    returning id, name into selected_school_id, saved_school;
  before_data := jsonb_build_object('name', person.name, 'school', old_school, 'stream', enrolment.stream);
  after_data := jsonb_build_object('name', new_name, 'school', saved_school, 'stream', p_stream);
  if before_data = after_data then
    return jsonb_build_object('id', enrolment.id, 'student_code', enrolment.student_code);
  end if;
  if person.name <> new_name then
    update public.students set name = new_name, version = version + 1 where id = person.id;
  end if;
  update public.enrolments set school_id = selected_school_id, stream = p_stream, version = version + 1
    where id = enrolment.id;
  insert into public.student_change_history(enrolment_id, actor_id, action, before_values, after_values)
    values (enrolment.id, auth.uid(), 'Edited details', before_data, after_data);
  return jsonb_build_object('id', enrolment.id, 'student_code', enrolment.student_code);
end;
$$;

create or replace function public.app_set_enrolment_active(
  p_enrolment_id uuid, p_is_active boolean, p_expected_version bigint
)
returns void language plpgsql security definer set search_path = ''
as $$
declare enrolment public.enrolments%rowtype; archived boolean;
begin
  if not app_private.is_admin() then raise exception 'Only active admins can deactivate or reactivate students.'; end if;
  if p_is_active is null then raise exception 'Choose active or inactive.'; end if;
  select * into enrolment from public.enrolments where id = p_enrolment_id;
  if not found then raise exception 'Student enrolment not found.'; end if;
  select is_archived into archived from public.exam_groups where id = enrolment.group_id for update;
  if archived then raise exception 'Archived groups are read-only. Restore the group before changing student status.'; end if;
  select * into enrolment from public.enrolments where id = p_enrolment_id for update;
  if p_expected_version is distinct from enrolment.version then
    raise exception 'This student was changed by another admin. Refresh before changing their status.';
  end if;
  if enrolment.is_active = p_is_active then return; end if;
  update public.enrolments set is_active = p_is_active, version = version + 1 where id = enrolment.id;
  insert into public.student_change_history(enrolment_id, actor_id, action, before_values, after_values)
    values (enrolment.id, auth.uid(), case when p_is_active then 'Reactivated' else 'Deactivated' end,
      jsonb_build_object('is_active', enrolment.is_active), jsonb_build_object('is_active', p_is_active));
end;
$$;
revoke all on function public.app_update_student(uuid, text, text, text, bigint, bigint) from public, anon, authenticated;
revoke all on function public.app_set_enrolment_active(uuid, boolean, bigint) from public, anon, authenticated;
grant execute on function public.app_update_student(uuid, text, text, text, bigint, bigint) to authenticated;
grant execute on function public.app_set_enrolment_active(uuid, boolean, bigint) to authenticated;
notify pgrst, 'reload schema';
commit;
select 'Student editing and status controls are ready.' as result;
