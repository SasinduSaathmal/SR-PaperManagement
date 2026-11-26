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
// Keep only changes that could not be written, scoped to the signed-in account.
// Remember the prior stored revision so recovery cannot overwrite another tab.
const pendingStorageChanges = new Map();
const lastReadableDrafts = new Map();
export const draftStorageWarning = "Some draft changes are held only in this tab. Keep it open until the marks sync.";

function readDraftStorage(accountId, storage) {
  let raw;
  try {
    raw = (storage ?? globalThis.localStorage).getItem(sharedDraftKey(accountId));
  } catch {
    return { drafts: lastReadableDrafts.get(accountId) ?? {}, unavailable: true };
  }
  try {
    const drafts = JSON.parse(raw || "{}");
    if (!drafts || typeof drafts !== "object" || Array.isArray(drafts) ||
      Object.values(drafts).some(d => !d || typeof d.testId !== "string" || typeof d.enrolmentId !== "string" ||
        typeof d.text !== "string" || typeof d.requestId !== "string" || !Number.isSafeInteger(d.version) || d.version < 0))
      throw new Error("Invalid draft record");
    lastReadableDrafts.set(accountId, drafts);
    return { drafts };
  } catch {
    return { drafts: {}, error: "Saved shared-test drafts could not be read. Repair browser data before entering more scores." };
  }
}

function visibleDrafts(stored, changes) {
  const drafts = { ...stored };
  for (const [id, change] of changes) {
    if (change.draft) drafts[id] = change.draft;
    else if (drafts[id]?.requestId === change.baseId) delete drafts[id];
  }
  return drafts;
}

export function loadSharedDrafts(accountId, storage) {
  const stored = readDraftStorage(accountId, storage);
  const changes = pendingStorageChanges.get(accountId) ?? new Map();
  const drafts = visibleDrafts(stored.drafts, changes);
  return {
    drafts,
    error: stored.error || "",
    memoryOnly: [...changes.values()].some(change => change.draft),
    warning: stored.unavailable || changes.size ? draftStorageWarning : "",
  };
}

export function updateSharedDraft(accountId, id, draft, expectedId, storage) {
  const stored = readDraftStorage(accountId, storage);
  if (stored.error) throw new Error(stored.error);

  const changes = pendingStorageChanges.get(accountId) ?? new Map();
  const existing = changes.get(id);
  const storedId = stored.drafts[id]?.requestId;
  const visible = visibleDrafts(stored.drafts, changes);
  // Discarding a memory-only version must leave another tab's newer draft intact.
  const discardingFallback = !draft && existing?.draft?.requestId === expectedId && !!existing?.draft;
  if ((visible[id]?.requestId !== expectedId && (visible[id] || draft)) ||
    (draft && !stored.unavailable && existing && storedId && storedId !== existing.baseId)) {
    throw new Error("A draft for this score changed in another tab. Review the latest saved score before editing here.");
  }
  if (discardingFallback && storedId !== existing.baseId && !stored.unavailable) changes.delete(id);
  else changes.set(id, { draft, baseId: existing ? existing.baseId : storedId });

  if (!stored.unavailable) {
    const merged = { ...stored.drafts };
    const writable = [];
    for (const [key, change] of changes) {
      const currentId = merged[key]?.requestId;
      if (currentId && currentId !== change.baseId) continue;
      if (change.draft) merged[key] = change.draft;
      else delete merged[key];
      writable.push(key);
    }
    try {
      (storage ?? globalThis.localStorage).setItem(sharedDraftKey(accountId), JSON.stringify(merged));
      for (const key of writable) changes.delete(key);
      stored.drafts = merged;
      lastReadableDrafts.set(accountId, merged);
    } catch { /* The pending changes remain in memory until saved or discarded. */ }
  }
  if (changes.size) pendingStorageChanges.set(accountId, changes);
  else pendingStorageChanges.delete(accountId);
  return { drafts: visibleDrafts(stored.drafts, changes), warning: changes.size || stored.unavailable ? draftStorageWarning : "" };
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
