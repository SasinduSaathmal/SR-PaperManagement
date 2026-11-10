async function readPages(makeQuery, signal) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await makeQuery().range(offset, offset + 499).abortSignal(signal);
    if (error) throw marksError(error);
    rows.push(...(data || []));
    if (!data || data.length < 500) return rows;
  }
}

export function marksError(failure) {
  if (["42P01", "PGRST202", "PGRST205"].includes(failure?.code))
    return new Error("Shared test setup is missing. Run 004_shared_test_marks.sql in Supabase, then Refresh.");
  return new Error(failure?.message || "The database request failed. Your draft has been kept.");
}

export async function marksRequest(client, name, args, signal) {
  const { data, error } = await client.rpc(name, args).abortSignal(signal);
  if (error) throw marksError(error);
  return data;
}

export async function loadMarksIndex(client, signal) {
  const results = await Promise.allSettled([
    readPages(() => client.from("exam_groups").select("id,exam_year,is_archived").order("exam_year"), signal),
    readPages(() => client.from("marks_tests").select("id,group_id,phase,paper,test_date,max_cents,status,revision").order("test_date", { ascending: false }).order("id"), signal),
    readPages(() => client.from("profiles").select("id,display_name,role,is_active").order("id"), signal),
  ]);
  // Do not show a partial index as a successfully empty test list.
  for (const result of results) if (result.status === "rejected") throw marksError(result.reason);
  return { groups: results[0].value, tests: results[1].value, profiles: results[2].value };
}

export const sharedDraftKey = (accountId) => `physics-shared-marks:v1:account:${accountId}`;
export function loadSharedDrafts(accountId, storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(sharedDraftKey(accountId)) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      Object.values(parsed).some(d => !d || typeof d.testId !== "string" || typeof d.enrolmentId !== "string" ||
        typeof d.text !== "string" || typeof d.requestId !== "string" || !Number.isSafeInteger(d.version) || d.version < 0))
      throw new Error("Invalid draft record");
    return { drafts: parsed, error: "" };
  } catch {
    return { drafts: {}, error: "Saved shared-test drafts could not be read. Download or repair browser data before entering more scores." };
  }
}
export function persistSharedDrafts(accountId, drafts, storage = globalThis.localStorage) {
  storage.setItem(sharedDraftKey(accountId), JSON.stringify(drafts));
}
export const participantStatus = (p) => !p ? "Not participating"
  : p.submitted_revision == null ? "In progress"
  : p.submitted_revision === p.batch_revision ? "Submitted" : "Needs resubmission";
export function completionOf(snapshot) {
  const recorded = new Set(snapshot.scores.filter(s => !s.is_deleted).map(s => s.enrolment_id));
  return {
    missing: snapshot.students.filter(s => s.is_active && !recorded.has(s.id)),
    unsubmitted: snapshot.participants.filter(p => participantStatus(p) !== "Submitted"),
  };
}
