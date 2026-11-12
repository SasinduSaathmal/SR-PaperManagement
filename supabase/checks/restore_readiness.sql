-- Run as postgres in SQL Editor, before backup and after a restore.
-- Read-only assertions: installs nothing and changes no application data.
begin transaction read only;
do $$
declare name text; item record; relation regclass;
begin
  foreach name in array array[
    'profiles','exam_groups','schools','students','enrolments','student_change_history',
    'marks_tests','test_participants','test_scores','test_mark_history','marks_write_requests',
    'online_import_batches','online_import_rows','saved_reports','saved_report_tests',
    'online_file_import_receipts','trial_cleanup_runs','cleared_student_requests',
    'student_id_aliases','account_change_history','account_invitations'
  ] || case when to_regclass('public.school_name_aliases') is not null then array['school_name_aliases'] else array[]::text[] end loop
    relation := to_regclass('public.' || name);
    if relation is null then raise exception 'Missing application table: %', name; end if;
    if not (select relrowsecurity from pg_class where oid=relation) then
      raise exception 'Row security is disabled: %', name;
    end if;
    if has_table_privilege('anon',relation,'SELECT') then
      raise exception 'Anonymous table access: %', name;
    end if;
    if has_table_privilege('anon',relation,'INSERT,UPDATE,DELETE,TRUNCATE')
       or has_table_privilege('authenticated',relation,'INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception 'Browser has direct write access: %', name;
    end if;
  end loop;
  foreach name in array array[
    'public.app_get_test_workspace(uuid)',
    'public.app_export_marker_students(uuid,uuid)',
    'public.app_get_report(uuid)',
    'public.app_manage_test_participant(uuid,text,uuid,uuid,bigint,uuid)',
    'public.app_import_online_file(uuid,text,text,jsonb,uuid)',
    'public.app_preview_trial_cleanup(uuid,boolean)'
  ] loop
    if to_regprocedure(name) is null then raise exception 'Missing application RPC: %',name; end if;
  end loop;
  -- Older pre-013 archives remain valid; new installs must include these RPCs.
  if to_regclass('public.school_name_aliases') is not null then
    foreach name in array array[
      'public.app_change_student_id(uuid,text,bigint,text,boolean,uuid)',
      'public.app_school_options()',
      'public.app_preview_school_merge(uuid[],uuid,text)',
      'public.app_merge_schools(uuid[],uuid,text,text,text,text,uuid)',
      'public.app_preview_student_removal(uuid,boolean)',
      'public.app_remove_student(uuid,boolean,text,text,text,uuid)'
    ] loop
      if to_regprocedure(name) is null then raise exception 'Missing application RPC: %',name;end if;
    end loop;
  end if;
  if exists(select 1 from public.profiles p left join auth.users u on u.id=p.id where u.id is null) then
    raise exception 'A profile is missing its Auth user';
  end if;
  if not exists(select 1 from public.profiles where role='admin' and is_active) then
    raise exception 'No active administrator';
  end if;
  for item in select c.oid::regclass as relation, c.relname from pg_class c
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
  loop
    if exists(select 1 from pg_constraint where conrelid=item.relation and not convalidated) then
      raise exception 'Unvalidated constraint: %', item.relname;
    end if;
  end loop;
  for item in select * from (values
    ('auth.users','physics_create_marker_profile','app_private.create_marker_profile()'),
    ('public.test_scores','preserve_original_marker','app_private.preserve_original_marker()'),
    ('public.enrolments','reject_cleared_student_request','app_private.reject_cleared_student_request()')
  ) required(relation,trigger_name,function_name) loop
    if not exists(select 1 from pg_trigger where tgrelid=to_regclass(item.relation)
      and tgname=item.trigger_name and tgfoid=to_regprocedure(item.function_name)
      and tgenabled='O' and not tgisinternal) then
      raise exception 'Missing or disabled trigger: %.%',item.relation,item.trigger_name;
    end if;
  end loop;
  for item in select p.oid,p.proname,p.prosecdef,p.proconfig from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'app\_%' escape '\'
  loop
    if has_function_privilege('anon',item.oid,'EXECUTE') or not item.prosecdef
       or not coalesce(item.proconfig @> array['search_path=""'],false) then
      raise exception 'Unsafe RPC permissions or search path: %',item.proname;
    end if;
  end loop;
  foreach name in array array[
    'public.app_begin_account_invite(uuid,text,text,uuid)',
    'public.app_finish_account_invite(uuid,boolean)'
  ] loop
    if to_regprocedure(name) is null then raise exception 'Missing invitation RPC: %',name; end if;
    if has_function_privilege('authenticated',name,'EXECUTE')
       or not has_function_privilege('service_role',name,'EXECUTE') then
      raise exception 'Invitation RPC must be server-only: %',name;
    end if;
  end loop;
  if not has_table_privilege('service_role','public.profiles','SELECT') then
    raise exception 'Invitation server cannot read profiles';
  end if;
end $$;
select 'PASS: application tables, account links, RLS, RPC permissions and required triggers' as result;
commit;
