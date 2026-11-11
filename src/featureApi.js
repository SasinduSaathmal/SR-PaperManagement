import { supabase } from "./lib/supabaseClient.js";

export async function featureRequest(name, args) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45000);
  try {
    const { data, error } = await supabase.rpc(name, args).abortSignal(controller.signal);
    if (error && ["PGRST202","42P01"].includes(error.code) && ["app_list_accounts","app_list_account_invitations","app_update_account","app_search_student_identities","app_replace_temporary_id","app_link_returning_student","app_manage_test_participant"].includes(name)) throw Error("Administration setup is missing. Apply 010_student_identity.sql, 011_account_administration.sql and 012_test_participants.sql in Supabase first.");
    if (error) throw Error(["PGRST202", "42P01"].includes(error.code)
      ? name === "app_preview_trial_cleanup" || name === "app_clear_trial_data" ? "Trial cleanup setup is missing. Run 009_trial_data_cleanup.sql in Supabase first." : name === "app_import_online_file" ? "Date recovery setup is missing. Run 008_online_date_recovery.sql in Supabase first." : "Online import and report setup is missing. Run 006_online_import_reports.sql in Supabase first." : error.message);
    return data;
  } catch(e) {
    throw Error(controller.signal.aborted ? "The request timed out. Retry the same action safely, then Refresh to check the saved result." : e.message);
  } finally { clearTimeout(timer); }
}
