-- Run after 001_account_profiles.sql. No email or secret keys are needed.
-- Adds shared records. Does not copy or modify browser practice data.
begin;

create table if not exists public.exam_groups (
  id uuid primary key default gen_random_uuid(),
  exam_year integer not null unique check (exam_year between 1900 and 9999),
  is_archived boolean not null default false,
  next_temp_number bigint not null default 0 check (next_temp_number >= 0),
  created_at timestamptz not null default now()
);
create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200 and btrim(name) <> ''),
  created_at timestamptz not null default now()
);
create unique index if not exists schools_name_unique on public.schools (lower(name));
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200 and btrim(name) <> ''),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create table if not exists public.enrolments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete restrict,
  group_id uuid not null references public.exam_groups(id) on delete restrict,
  school_id uuid not null references public.schools(id) on delete restrict,
  stream text not null check (stream in ('Maths', 'Bio')),
  student_code text not null,
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict,
  request_id uuid not null unique,
  created_at timestamptz not null default now(),
  unique (group_id, student_code),
  unique (group_id, student_id)
);
create index if not exists enrolments_student_index on public.enrolments(student_id);
create index if not exists enrolments_school_index on public.enrolments(school_id);

-- Read access includes archived groups. Writes use checked functions below.
alter table public.exam_groups enable row level security;
alter table public.schools enable row level security;
alter table public.students enable row level security;
alter table public.enrolments enable row level security;
revoke all on public.exam_groups, public.schools, public.students, public.enrolments
  from public, anon, authenticated;
grant select on public.exam_groups, public.schools, public.students, public.enrolments to authenticated;

drop policy if exists exam_groups_read on public.exam_groups;
create policy exam_groups_read on public.exam_groups for select to authenticated
  using ((select app_private.is_active_member()));
drop policy if exists schools_read on public.schools;
create policy schools_read on public.schools for select to authenticated
  using ((select app_private.is_active_member()));
drop policy if exists students_read on public.students;
create policy students_read on public.students for select to authenticated
  using ((select app_private.is_active_member()));
drop policy if exists enrolments_read on public.enrolments;
create policy enrolments_read on public.enrolments for select to authenticated
  using ((select app_private.is_active_member()));

create or replace function public.app_create_exam_group(p_exam_year integer)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare result_id uuid;
begin
  if not app_private.is_admin() then raise exception 'Only active admins can create exam groups.'; end if;
  if p_exam_year is null or p_exam_year not between 1900 and 9999 then
    raise exception 'Enter a four-digit exam year.';
  end if;
  insert into public.exam_groups(exam_year) values (p_exam_year) returning id into result_id;
  return result_id;
exception when unique_violation then
  raise exception 'This exam-year group already exists.';
end;
$$;

create or replace function public.app_set_group_archived(p_group_id uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not app_private.is_admin() then raise exception 'Only active admins can archive or restore groups.'; end if;
  if p_archived is null then raise exception 'Choose archive or restore.'; end if;
  -- Updates lock the same group row as student creation, preventing archive races.
  update public.exam_groups set is_archived = p_archived where id = p_group_id;
  if not found then raise exception 'Exam group not found.'; end if;
end;
$$;

create or replace function public.app_add_student(
  p_group_id uuid, p_name text, p_school text, p_stream text,
  p_official_id text, p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  exam_group public.exam_groups%rowtype;
  existing public.enrolments%rowtype;
  new_enrolment public.enrolments%rowtype;
  student_name text := regexp_replace(btrim(p_name), '\s+', ' ', 'g');
  school_name text := regexp_replace(btrim(p_school), '\s+', ' ', 'g');
  raw_code text := upper(btrim(coalesce(p_official_id, '')));
  code_parts text[];
  number_part text;
  new_code text;
  new_student_id uuid;
  selected_school_id uuid;
begin
  if not app_private.is_active_member() then raise exception 'An active account is required.'; end if;
  if p_request_id is null then raise exception 'A save request ID is required.'; end if;
  select * into exam_group from public.exam_groups where id = p_group_id for update;
  if not found then raise exception 'Exam group not found.'; end if;
  if exam_group.is_archived then raise exception 'Archived groups are read-only. Ask an admin to restore the group first.'; end if;

  -- Retrying the same save after a lost response must not create another student.
  select * into existing from public.enrolments where request_id = p_request_id;
  if found then
    if existing.created_by <> auth.uid() or existing.group_id <> p_group_id then
      raise exception 'This save request belongs to a different account or group.';
    end if;
    return jsonb_build_object('id', existing.id, 'student_code', existing.student_code);
  end if;

  if student_name is null or char_length(student_name) not between 1 and 200 then
    raise exception 'Enter a student name (up to 200 characters).';
  end if;
  if school_name is null or char_length(school_name) not between 1 and 200 then
    raise exception 'Enter a school name (up to 200 characters).';
  end if;
  if p_stream is null or p_stream not in ('Maths', 'Bio') then raise exception 'Choose Maths or Bio.'; end if;

  if raw_code = '' then
    update public.exam_groups set next_temp_number = next_temp_number + 1
      where id = p_group_id returning next_temp_number::text into number_part;
    new_code := 'TEMP/SC/' || exam_group.exam_year || '/' || lpad(number_part, greatest(6, char_length(number_part)), '0');
  else
    if char_length(raw_code) > 100 then raise exception 'The student ID is too long.'; end if;
    if raw_code ~ '^[0-9]+$' then
      number_part := raw_code;
    else
      code_parts := regexp_match(raw_code, '^SC/([0-9]{4})/([0-9]+)$');
      if code_parts is null then raise exception 'Use an official number or SC/year/number. Leave unknown IDs blank.'; end if;
      if code_parts[1]::integer <> exam_group.exam_year then raise exception 'The student ID year must match the selected group.'; end if;
      number_part := code_parts[2];
    end if;
    number_part := coalesce(nullif(ltrim(number_part, '0'), ''), '0');
    new_code := 'SC/' || exam_group.exam_year || '/' || number_part;
  end if;

  if exists (select 1 from public.enrolments where group_id = p_group_id and student_code = new_code) then
    raise exception 'This student ID already exists in this exam group. Search for the existing student.';
  end if;

  -- Reuse schools case-insensitively; a new school needs no admin approval.
  insert into public.schools as s(name) values (school_name)
    on conflict ((lower(name))) do update set name = s.name
    returning id into selected_school_id;
  insert into public.students(name, created_by) values (student_name, auth.uid()) returning id into new_student_id;
  insert into public.enrolments(student_id, group_id, school_id, stream, student_code, created_by, request_id)
    values (new_student_id, p_group_id, selected_school_id, p_stream, new_code, auth.uid(), p_request_id)
    returning * into new_enrolment;
  return jsonb_build_object('id', new_enrolment.id, 'student_code', new_enrolment.student_code);
end;
$$;

revoke all on function public.app_create_exam_group(integer) from public, anon, authenticated;
revoke all on function public.app_set_group_archived(uuid, boolean) from public, anon, authenticated;
revoke all on function public.app_add_student(uuid, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.app_create_exam_group(integer) to authenticated;
grant execute on function public.app_set_group_archived(uuid, boolean) to authenticated;
grant execute on function public.app_add_student(uuid, text, text, text, text, uuid) to authenticated;

insert into public.exam_groups(exam_year) values (2027), (2028)
  on conflict (exam_year) do nothing;
notify pgrst, 'reload schema';
commit;
select exam_year, is_archived from public.exam_groups order by exam_year;
