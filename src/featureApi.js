import { supabase } from "./lib/supabaseClient.js";

export async function featureRequest(name, args) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45000);
  try {
    const { data, error } = await supabase.rpc(name, args).abortSignal(controller.signal);
    if (error) throw Error(["PGRST202", "42P01"].includes(error.code)
      ? name === "app_import_online_file" ? "Date recovery setup is missing. Run 008_online_date_recovery.sql in Supabase first." : "Online import and report setup is missing. Run 006_online_import_reports.sql in Supabase first." : error.message);
    return data;
  } catch(e) {
    throw Error(controller.signal.aborted ? "The request timed out. Retry the same action safely, then Refresh to check the saved result." : e.message);
  } finally { clearTimeout(timer); }
}
