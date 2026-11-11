-- RESTORE-ONLY: apply to the NEW, isolated destination after schema/data restore.
-- Supabase's schema dump can omit custom triggers on managed Auth tables.
-- The hardened function comes from the restored app_private schema (migration 011).
-- Do not rerun migration 001: it would replace that hardened function.
-- A single DO statement is atomic on its own and also composes safely with
-- psql --single-transaction. Do not add BEGIN/COMMIT around this file.
do $$ begin
  if to_regprocedure('app_private.create_marker_profile()') is null then
    raise exception 'Restore the application schema before restoring its Auth trigger.';
  end if;
  execute 'drop trigger if exists physics_create_marker_profile on auth.users';
  execute 'create trigger physics_create_marker_profile after insert on auth.users for each row execute function app_private.create_marker_profile()';
end $$;
