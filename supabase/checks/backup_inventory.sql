-- Run as postgres with psql -X -q -t -A -f ... > inventory.json.
-- One read-only snapshot; contains only counts and content digests, not student details.
-- Includes removed rows, history, retry receipts, report snapshots and Auth identities.
-- Compare before/after backup while all writes and logins are paused, and on the
-- restored destination BEFORE signing in there. Same PostgreSQL major version.
begin transaction isolation level repeatable read read only;
set local timezone='UTC';
with tables(name,summary) as (values
  ('public.profiles', (select jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(row_hash,'' order by row_hash),''))) from (select md5(to_jsonb(t)::text) row_hash from public.profiles t) hashed)),
  ('public.exam_groups', (select jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(row_hash,'' order by row_hash),''))) from (select md5(to_jsonb(t)::text) row_hash from public.exam_groups t) hashed)),
  ('public.schools', (select jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(row_hash,'' order by row_hash),''))) from (select md5(to_jsonb(t)::text) row_hash from public.schools t) hashed)),
  ('public.school_name_aliases', (select jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(row_hash,'' order by row_hash),''))) from (select md5(to_jsonb(t)::text) row_hash from public.school_name_aliases t) hashed)),
  ('public.students', (select jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(row_hash,'' order by row_hash),''))) from (select md5(to_jsonb(t)::text) row_hash from public.students t) hashed)),
  ('public.enrolments', (select jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(row_hash,'' order by row_hash),''))) from (select md5(to_jsonb(t)::text) row_hash from public.enrolments t) hashed)),
  ('public.student_change_history', (select jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(row_hash,'' order by row_hash),''))) from (select md5(to_jsonb(t)::text) row_hash from public.student_change_history t) hashed)),
  ('public.marks_tests', (select jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(row_hash,'' order by row_hash),''))) from (select md5(to_jsonb(t)::text) row_hash from public.marks_tests t) hashed)),
  ('public.test_participants', (select jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(row_hash,'' order by row_hash),''))) from (select md5(to_jsonb(t)::text) row_hash from public.test_participants t) hashed)),
  ('public.test_scores', (select jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(row_hash,'' order by row_hash),''))) from (select md5(to_jsonb(t)::text) row_hash from public.test_scores t) hashed)),
  ('public.test_mark_history', (select jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(row_hash,'' order by row_hash),''))) from (select md5(to_jsonb(t)::text) row_hash from public.test_mark_history t) hashed)),
  ('public.marks_write_requests', (select jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(row_hash,'' order by row_hash),''))) from (select md5(to_jsonb(t)::text) row_hash from public.marks_write_requests t) hashed)),
  ('public.online_import_batches', (select jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(row_hash,'' order by row_hash),''))) from (select md5(to_jsonb(t)::text) row_hash from public.online_import_batches t) hashed)),
  ('public.online_import_rows', (select jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(row_hash,'' order by row_hash),''))) from (select md5(to_jsonb(t)::text) row_hash from public.online_import_rows t) hashed)),
  ('public.saved_reports', (select jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(row_hash,'' order by row_hash),''))) from (select md5(to_jsonb(t)::text) row_hash from public.saved_reports t) hashed)),
  ('public.saved_report_tests', (select jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(row_hash,'' order by row_hash),''))) from (select md5(to_jsonb(t)::text) row_hash from public.saved_report_tests t) hashed)),
  ('public.online_file_import_receipts', (select jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(row_hash,'' order by row_hash),''))) from (select md5(to_jsonb(t)::text) row_hash from public.online_file_import_receipts t) hashed)),
  ('public.trial_cleanup_runs', (select jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(row_hash,'' order by row_hash),''))) from (select md5(to_jsonb(t)::text) row_hash from public.trial_cleanup_runs t) hashed)),
  ('public.cleared_student_requests', (select jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(row_hash,'' order by row_hash),''))) from (select md5(to_jsonb(t)::text) row_hash from public.cleared_student_requests t) hashed)),
  ('public.student_id_aliases', (select jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(row_hash,'' order by row_hash),''))) from (select md5(to_jsonb(t)::text) row_hash from public.student_id_aliases t) hashed)),
  ('public.account_change_history', (select jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(row_hash,'' order by row_hash),''))) from (select md5(to_jsonb(t)::text) row_hash from public.account_change_history t) hashed)),
  ('public.account_invitations', (select jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(row_hash,'' order by row_hash),''))) from (select md5(to_jsonb(t)::text) row_hash from public.account_invitations t) hashed)),
  ('auth.users', (select jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(row_hash,'' order by row_hash),''))) from (select md5(to_jsonb(t)::text) row_hash from auth.users t) hashed)),
  ('auth.identities', (select jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(row_hash,'' order by row_hash),''))) from (select md5(to_jsonb(t)::text) row_hash from auth.identities t) hashed))
), schema_parts(kind,description) as (
  select 'column',table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'')
  from information_schema.columns where table_schema='public'
  union all
  select 'constraint',c.relname||':'||pg_get_constraintdef(k.oid)
  from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
  union all
  select 'rls',c.relname||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
  union all
  select 'policy',tablename||':'||policyname||':'||permissive||':'||roles::text||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,'')
  from pg_policies where schemaname='public'
  union all
  select 'function',pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where (n.nspname='public' and p.proname like 'app\_%' escape '\') or n.nspname='app_private'
  union all
  select 'trigger',pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where not t.tgisinternal and (n.nspname='public' or (n.nspname='auth' and t.tgname='physics_create_marker_profile'))
  union all
  select 'grant',name||':'||role_name||':'||permission||':'||has_table_privilege(role_name,name,permission)::text
  from tables cross join (values ('anon'),('authenticated'),('service_role')) r(role_name)
  cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) p(permission)
  where name like 'public.%'
  union all
  select 'function grant',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||r.role_name||':'||has_function_privilege(r.role_name,p.oid,'EXECUTE')::text
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  cross join (values ('anon'),('authenticated'),('service_role')) r(role_name)
  where (n.nspname='public' and p.proname like 'app\_%' escape '\') or n.nspname='app_private'
)
select jsonb_pretty(jsonb_build_object(
  'format',1,
  'tables',(select jsonb_object_agg(name,summary order by name) from tables),
  'application_schema_digest',(select md5(string_agg(kind||':'||description,E'\n' order by kind,description)) from schema_parts)
)) as inventory;
commit;
