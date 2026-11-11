import React, { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./lib/supabaseClient.js";
import BrandMark from "./BrandMark.jsx";
import SharedStudents from "./SharedStudents.jsx";
import OnlineMarksImport from "./OnlineMarksImport.jsx";
import SharedReports from "./SharedReports.jsx";
import { searchMarksStudents } from "./studentsApi.js";
import AccountAdministration from "./AccountAdministration.jsx";
import ParticipantManagement from "./ParticipantManagement.jsx";
import TrialDataCleanup from "./TrialDataCleanup.jsx";
import { featureRequest } from "./featureApi.js";
import { downloadMarker } from "./workbooks.js";
import { parseMark, formatMark } from "./domain.js";
import { loadMarksIndex, marksRequest, loadSharedDrafts, persistSharedDrafts, participantStatus, completionOf } from "./sharedMarksApi.js";

const uuid = () => crypto.randomUUID();
const draftId = (testId, enrolmentId) => `${testId}:${enrolmentId}`;
async function request(name, args) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
  try { return await marksRequest(supabase, name, args, controller.signal); }
  catch (error) { throw new Error(controller.signal.aborted
    ? "The request timed out. It may have reached the server. Refresh to check; retrying the same saved draft is safe." : error.message); }
  finally { clearTimeout(timer); }
}

export default function SharedMarks({ profile }) {
  const [index, setIndex] = useState({ groups: [], tests: [], profiles: [] });
  const [groupId, setGroupId] = useState(""), [testId, setTestId] = useState("");
  const [page, setPage] = useState("marks"), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false), [refreshToken, setRefreshToken] = useState(0);
  const [initialDrafts] = useState(() => loadSharedDrafts(profile.id));
  const [drafts, setDrafts] = useState(initialDrafts.drafts), draftsRef = useRef(drafts);
  const [draftError, setDraftError] = useState(initialDrafts.error);
  const admin = profile.role === "admin";
  const refreshIndex = useCallback(() => setRefreshToken(n => n + 1), []);
  useEffect(() => {
    let cancelled = false; const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    loadMarksIndex(supabase, controller.signal).then(next => {
      if (cancelled) return;
      setIndex(next); setError("");
      setGroupId(previous => next.groups.some(g => g.id === previous) ? previous : (next.groups.find(g => !g.is_archived) || next.groups[0])?.id || "");
    }).catch(e => { if (!cancelled) setError(controller.signal.aborted ? "Loading tests timed out. Check your connection and Refresh." : e.message); })
      .finally(() => { clearTimeout(timer); if (!cancelled) setLoading(false); });
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [refreshToken]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") refreshIndex(); };
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); };
  }, [refreshIndex]);
  const group = index.groups.find(g => g.id === groupId);
  const tests = index.tests.filter(t => t.group_id === groupId);
  useEffect(() => {
    if (!tests.some(t => t.id === testId)) setTestId(tests[0]?.id || "");
  }, [groupId, index.tests]);
  // Preserve unrelated drafts created in another tab; refuse to replace that
  // tab's newer draft of the same score before it reaches the server.
  function changeDraft(id, next, expectedId) {
    if (initialDrafts.error) throw new Error(initialDrafts.error);
    const stored = loadSharedDrafts(profile.id);
    if (stored.error) throw new Error(stored.error);
    if (stored.drafts[id] && stored.drafts[id].requestId !== expectedId)
      throw new Error("A draft for this score changed in another tab. Reload and review it before editing here.");
    const merged = { ...stored.drafts };
    if (next) merged[id] = next; else delete merged[id];
    try { persistSharedDrafts(profile.id, merged); setDraftError(""); }
    catch { setDraftError("Browser saving is unavailable. Keep this page open until your scores are saved to the server."); }
    draftsRef.current = merged; setDrafts(merged);
  }
  const pending = Object.keys(drafts).length;
  useEffect(() => {
    if (!pending) return;
    const warn = e => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);
  const navigation = [{ id: "home", label: "Overview" }, { id: "marks", label: "Test workspace" }, { id: "students", label: "Students" }, { id: "rankings", label: "Rankings & reports" }, ...(admin ? [{ id: "accounts", label: "Accounts" }] : [])];
  return <div className="app-shell shared-marks-shell">
    <aside className="sidebar"><a className="brand" href="#" onClick={e => { e.preventDefault(); setPage("home"); }}><BrandMark/><span><strong>Physics</strong><small>Samitha Rathnayake</small></span></a>
      <div className="workspace-label">MARKS MANAGEMENT</div><nav aria-label="Main navigation">{navigation.map(n => <button key={n.id} className={`nav-item ${page === n.id ? "active" : ""}`} onClick={() => { setPage(n.id); if (n.id === "students") refreshIndex(); }}>{n.label}</button>)}</nav>
      <div className="sidebar-bottom"><div className="lesson-card"><strong>Shared marking desk</strong><p>Scores and submissions are saved to the same database for every account.</p></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><BrandMark className="topbar-brand-mark"/><span className="breadcrumb">Workspace / {navigation.find(n => n.id === page)?.label}</span><div className="topbar-actions"><span className="badge">Shared database</span><span className="account-label">{profile.display_name} · {admin ? "Admin & marker" : "Marker"}</span></div></header>
      <main><div className="page-heading"><div><div className="eyebrow">{group?.exam_year || "SHARED"} EXAM GROUP</div><h1>{navigation.find(n => n.id === page)?.label}</h1><p>Student records, test marks and marker submissions shared across accounts.</p></div>
        {page !== "students" && page !== "accounts" && <label className="group-picker"><span>Exam-year group</span><select aria-label="Exam-year group" value={groupId} disabled={loading || showCreate} onChange={e => setGroupId(e.target.value)}>
          {!index.groups.length && <option value="">No groups available</option>}{index.groups.map(g => <option key={g.id} value={g.id}>{g.exam_year} students{g.is_archived ? " · Archived" : ""}</option>)}</select></label>}</div>
        {draftError && <p className="alert" role="alert">{draftError}</p>}
        {error && <p className="alert" role="alert">{error}</p>}
        {page === "accounts" ? <AccountAdministration profile={profile} onChanged={refreshIndex}/> : page === "students" ? <SharedStudents profile={profile}/> : page === "rankings" ? (group ? <SharedReports key={group.id} group={group} tests={tests} profile={profile} pendingDrafts={pending}/> : <p>Choose an exam group.</p>) : <>
          <div className="shared-marks-toolbar"><button className="secondary-button" onClick={refreshIndex}>Refresh tests</button>{admin && <button className="primary-button" disabled={!group || group.is_archived || !!error} onClick={() => setShowCreate(true)}>Create test</button>}<span className="muted">{pending ? `${pending} local draft(s) waiting to sync` : "No pending local drafts"}</span></div>
          {group?.is_archived && <p className="readonly-note">Archived group: tests and scores are read-only.</p>}
          {showCreate && group && <CreateTest group={group} profiles={index.profiles} profile={profile} onClose={() => setShowCreate(false)} onCreated={id => { setShowCreate(false); setTestId(id); refreshIndex(); setPage("marks"); }}/>}
          {loading ? <p className="shared-empty">Loading shared tests…</p> : !tests.length ? <section className="panel shared-empty"><h2>No shared tests in this group yet</h2><p>{admin ? "Create a test and select its participating markers to start." : "An admin must create a test and select its markers."}</p><p>Earlier practice tests stay in this browser and are not imported into real records.</p></section> : <>
            {page === "home" && <div className="test-grid">{tests.map(t => <button className="test-card panel" key={t.id} onClick={() => { setTestId(t.id); setPage("marks"); }}><div className="test-card-top"><span className="badge">{t.status}</span></div><p>{t.phase}</p><h2>Paper {t.paper}</h2><span>{formatMark(t.max_cents)} maximum marks · {t.test_date}</span><div className="test-card-foot">Open workspace →</div></button>)}</div>}
            <div hidden={page === "home"}><label className="shared-test-select">Selected test<select aria-label="Selected test" value={testId} onChange={e => setTestId(e.target.value)}>{tests.map(t => <option key={t.id} value={t.id}>{t.phase} · Paper {t.paper} · {t.status}</option>)}</select></label></div>
            {testId && <div hidden={page === "home"}><TestWorkspace key={testId} testId={testId} profile={profile} profiles={index.profiles} view={page} drafts={drafts} draftsRef={draftsRef} changeDraft={changeDraft} blocked={!!initialDrafts.error} onChanged={refreshIndex} onRemoved={() => { setTestId(""); refreshIndex(); }}/></div>}
          </>}
        </>}
        {page === "home" && admin && group && <TrialDataCleanup key={group.id} group={group} profileId={profile.id} tests={tests} onCleared={() => { setTestId(""); setShowCreate(false); refreshIndex(); }}/>}
        <footer className="page-footer"><span>Physics - Samitha Rathnayake</span><span>Only server-saved marks enter rankings.</span></footer>
      </main></div>
    <nav className="mobile-nav" aria-label="Mobile navigation">{navigation.map(n => <button key={n.id} className={page === n.id ? "active" : ""} onClick={() => setPage(n.id)}><span>{n.id === "marks" ? "Enter marks" : n.label}</span></button>)}</nav>
  </div>;
}

function CreateTest({ group, profiles, profile, onClose, onCreated }) {
  const [values, setValues] = useState({ phase: "Phase 1", paper: "1", date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), max: "150", markers: [profile.id] });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const requestId = useRef(uuid());
  const set = (key, value) => { requestId.current = uuid(); setValues(p => ({ ...p, [key]: value })); };
  async function create(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await request("app_create_marks_test", { p_group_id: group.id, p_phase: values.phase.trim(), p_paper: Number(values.paper), p_date: values.date, p_max_text: values.max.trim(), p_markers: values.markers, p_request_id: requestId.current });
      onCreated(result.id);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <form className="panel shared-student-form" onSubmit={create}><h2>Create test · {group.exam_year}</h2><div className="shared-fields">
    <label>Phase<input required maxLength={100} value={values.phase} disabled={busy} onChange={e => set("phase", e.target.value)}/></label>
    <label>Paper number<input required type="number" min="1" max="999" step="1" value={values.paper} disabled={busy} onChange={e => set("paper", e.target.value)}/></label>
    <label>Test date<input required type="date" value={values.date} disabled={busy} onChange={e => set("date", e.target.value)}/></label>
    <label>Maximum marks<input required inputMode="decimal" value={values.max} disabled={busy} onChange={e => set("max", e.target.value)}/></label>
  </div><fieldset className="marker-choices" disabled={busy}><legend>Participating markers</legend>{profiles.filter(p => p.is_active).map(p => <label key={p.id}><input type="checkbox" checked={values.markers.includes(p.id)} onChange={e => set("markers", e.target.checked ? [...values.markers, p.id] : values.markers.filter(id => id !== p.id))}/>{p.display_name}{p.role === "admin" ? " · Admin" : ""}</label>)}</fieldset>
    <p className="field-help">Selected participants enter paper scores. Admins can manage participants and reassign batches in the test workspace.</p>
    {error && <p className="field-error" role="alert">{error}</p>}<div className="shared-form-actions"><button className="primary-button" disabled={busy || !values.markers.length}>{busy ? "Creating…" : "Save test"}</button><button type="button" className="text-button" disabled={busy} onClick={onClose}>Cancel</button></div>
  </form>;
}

function TestWorkspace({ testId, profile, profiles, view, drafts, draftsRef, changeDraft, blocked, onChanged, onRemoved }) {
  const [snapshot, setSnapshot] = useState(null), snapshotRef = useRef(null);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [mode, setMode] = useState("form");
  const [query, setQuery] = useState(""), [selectedId, setSelectedId] = useState(""), [scope, setScope] = useState("all");
  const [exporting, setExporting] = useState(false);
  const removeRequest = useRef(null);
  const emptyRequests = useRef({});
  const [draftErrors, setDraftErrors] = useState({});
  const attempts = useRef({}), savingPromise = useRef(null), mounted = useRef(true), readSequence = useRef(0);
  const admin = profile.role === "admin";
  const refresh = useCallback(async () => {
    const seq = ++readSequence.current, controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const next = await marksRequest(supabase, "app_get_test_workspace", { p_test_id: testId }, controller.signal);
      if (mounted.current && seq === readSequence.current) { snapshotRef.current = next; setSnapshot(next); setError(""); }
      return next;
    } catch (e) { if (mounted.current && seq === readSequence.current) setError(e.message); return null; }
    finally { clearTimeout(timer); }
  }, [testId]);
  useEffect(() => {
    mounted.current = true; refresh();
    const again = () => { if (document.visibilityState === "visible") refresh(); };
    const timer = setInterval(again, 15000);
    window.addEventListener("focus", again); window.addEventListener("online", again);
    return () => { mounted.current = false; ++readSequence.current; clearInterval(timer); window.removeEventListener("focus", again); window.removeEventListener("online", again); };
  }, [refresh]);
  const currentDrafts = Object.entries(drafts).filter(([, d]) => d.testId === testId);
  async function flush(force = false) {
    if (savingPromise.current) { await savingPromise.current; return; }
    if (blocked) return;
    const job = (async () => {
      setSaving(true);
      try {
        const todo = Object.entries(draftsRef.current).filter(([, d]) => d.testId === testId);
        for (const [id, draft] of todo) {
          const current = snapshotRef.current;
          if (!current || current.test.status !== "Open" || current.group.is_archived) break;
          if (parseMark(draft.text, current.test.max_cents / 100).error) continue;
          if (!force && attempts.current[id] === draft.requestId) continue;
          attempts.current[id] = draft.requestId;
          try {
            const result = await request("app_save_test_score", { p_test_id: testId, p_enrolment_id: draft.enrolmentId, p_text: draft.text.trim(), p_expected_version: draft.version, p_request_id: draft.requestId });
            const latest = draftsRef.current[id];
            if (latest?.requestId === draft.requestId) changeDraft(id, null, latest.requestId);
            else if (latest) changeDraft(id, { ...latest, version: result.version }, latest.requestId);
            if (mounted.current) setDraftErrors(p => { const next = { ...p }; delete next[id]; return next; });
          } catch (e) { if (mounted.current) setDraftErrors(p => ({ ...p, [id]: e.message })); }
        }
        if (mounted.current) { await refresh(); onChanged(); }
      } finally { if (mounted.current) setSaving(false); }
    })();
    savingPromise.current = job;
    try { await job; } finally { savingPromise.current = null; }
  }
  useEffect(() => {
    if (saving || !snapshot || snapshot.test.status !== "Open" || snapshot.group.is_archived ||
      !currentDrafts.some(([id, d]) => attempts.current[id] !== d.requestId &&
        !parseMark(d.text, snapshot.test.max_cents / 100).error)) return;
    const timer = setTimeout(() => flush(), 650); return () => clearTimeout(timer);
  }, [drafts, saving, !!snapshot]);

  if (!snapshot) return <section className="panel shared-empty">{error ? <><p role="alert">{error}</p><button className="secondary-button" onClick={refresh}>Retry loading test</button></> : "Loading test workspace…"}</section>;
  const { test, group, participants, students } = snapshot;
  const allScores = snapshot.scores.filter(s => !s.is_deleted), scoresById = new Map(snapshot.scores.map(s => [s.enrolment_id, s]));
  const mine = participants.find(p => p.marker_id === profile.id), status = participantStatus(mine);
  const open = test.status === "Open" && !group.is_archived;
  const completion = completionOf(snapshot);
  const selected = students.find(s => s.id === selectedId);
  const matches = searchMarksStudents(students,query,group.exam_year);
  const displayed = allScores.filter(s => scope === "all" || s.marker_id === profile.id).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  function edit(student, text) {
    const id = draftId(testId, student.id), previous = draftsRef.current[id];
    try {
      changeDraft(id, { testId, enrolmentId: student.id, name: student.name, text, version: previous?.version ?? scoresById.get(student.id)?.version ?? 0, requestId: uuid() }, previous?.requestId);
      setDraftErrors(p => { const n = { ...p }; delete n[id]; return n; }); setNotice("");
    } catch (e) { setError(e.message); }
  }
  async function action(name, args, message) {
    setBusy(true); setError(""); setNotice("");
    try { const result = await request(name, { ...args, p_request_id: uuid() }); setNotice(typeof message === "function" ? message(result) : message); await refresh(); onChanged(); }
    catch (e) { setError(e.message); await refresh(); setError(e.message); }
    finally { setBusy(false); }
  }
  async function submit() {
    setBusy(true); setError("");
    try {
      await flush(true);
      if (Object.values(draftsRef.current).some(d => d.testId === testId)) throw new Error("Save or discard your pending drafts before submitting this test.");
      const latest = await refresh(); if (!latest) throw new Error("Could not check your latest batch. Refresh and retry.");
      const participant = latest.participants.find(p => p.marker_id === profile.id);
      if (!participant) throw new Error("You are not a participating marker.");
      await request("app_submit_test_batch", { p_test_id: testId, p_expected_batch_revision: participant.batch_revision, p_request_id: uuid() });
      setNotice("Your latest batch is submitted. Editing your own marks will require resubmission."); await refresh(); onChanged();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function confirmEmptyBatch(participant) {
    const local = loadSharedDrafts(participant.marker_id);
    if (local.error || Object.values(local.drafts).some(d => d.testId === testId)) {
      setError("This device has pending or unreadable drafts for that marker. Save or discard them before confirming an empty batch."); return;
    }
    if (!window.confirm(`Confirm that ${participant.name} has no papers for this test? Check with them that they have no unsynced drafts on another device. No scores or ownership will change.`)) return;
    setBusy(true); setError("");
    const key = `${participant.marker_id}:${participant.batch_revision}`;
    emptyRequests.current[key] ||= uuid();
    try {
      await featureRequest("app_confirm_empty_marker_batch", { p_test_id:testId, p_marker_id:participant.marker_id, p_expected_batch_revision:participant.batch_revision, p_request_id:emptyRequests.current[key] });
      setNotice(`${participant.name}'s empty batch is confirmed. No scores were changed.`); await refresh(); onChanged();
    } catch(e) { setError(e.message.includes("006_online_import_reports") ? "Run 007_zero_fill_empty_batches.sql in Supabase to enable empty-batch confirmation." : e.message); }
    finally { setBusy(false); }
  }
  function complete(which) {
    if (currentDrafts.length) { setError("Save or discard your drafts for this test first."); return; }
    const message = which === "zero" ? `Add zeroes for ${completion.missing.length} active student(s) without a score? Existing scores and submitted batches will be preserved.`
      : which === "close" ? "Close this test? All scores will become read-only." : which === "cancel" ? "Cancel this test? Entries will be preserved and the test excluded from rankings." : "Reopen this test? Marker entry will become available again.";
    if (!window.confirm(message)) return;
    action("app_complete_marks_test", { p_test_id: testId, p_action: which, p_expected_revision: test.revision, p_missing_ids: completion.missing.map(s => s.id) }, result => which === "zero" ? `Added zeroes for ${result.added} student(s).` : `Test status: ${result.status}.`);
  }
  async function removeTest() {
    setBusy(true); setError("");
    try {
      const stored = loadSharedDrafts(profile.id);
      if (stored.error || Object.values(stored.drafts).some(d => d.testId === testId) || currentDrafts.length)
        throw Error("Save or discard local drafts for this test before removing it.");
      if (!window.confirm("Permanently remove this empty test? Ask other markers to discard any unsynced drafts first. Tests with recorded work must be cancelled instead.")) return;
      if (removeRequest.current?.revision !== test.revision) removeRequest.current = { revision: test.revision, id: uuid() };
      await request("app_remove_empty_test", { p_test_id: testId, p_expected_revision: test.revision, p_request_id: removeRequest.current.id });
      onRemoved();
    } catch(e) { setError(e.message.includes("004_shared_test_marks") ? "Run 005_import_remove_export.sql in Supabase to enable test removal." : e.message); }
    finally { setBusy(false); }
  }
  async function exportMarker(markerId) {
    setExporting(true); setError("");
    try {
      const data = await request("app_export_marker_students", { p_test_id: testId, p_marker_id: markerId });
      await downloadMarker(data);
    } catch(e) { setError(e.message.includes("004_shared_test_marks") ? "Run 005_import_remove_export.sql in Supabase to enable Excel downloads." : e.message); }
    finally { setExporting(false); }
  }
  function input(student) {
    const id = draftId(testId, student.id), draft = drafts[id], old = scoresById.get(student.id), score = old && !old.is_deleted ? old : null;
    const editable = open && student.is_active && !busy && !blocked && (score ? (score.marker_id === profile.id ? !!mine : admin) : !!mine);
    const help = draft ? parseMark(draft.text, test.max_cents / 100).error || draftErrors[id] || (saving ? "Saving…" : "Waiting to save") : score ? "Saved to server" : "No score recorded";
    return <div className="cell-score"><input aria-label={`Score for ${student.name}`} inputMode="decimal" autoComplete="off" value={draft?.text ?? (score ? formatMark(score.cents) : "")} disabled={!editable}
      aria-invalid={!!draft && !!(parseMark(draft.text, test.max_cents / 100).error || draftErrors[id])} onChange={e => edit(student, e.target.value)} placeholder="—"/><small className={draftErrors[id] ? "field-error" : "field-help"}>{help}</small></div>;
  }
  return <>
    <section className="test-strip"><div><strong>{test.phase} · Paper {test.paper}</strong><small>{test.test_date} · {formatMark(test.max_cents)} maximum marks</small></div><span className="badge">{test.status}</span><button className="secondary-button" disabled={saving || busy} onClick={refresh}>Refresh scores</button><span className="muted">Refreshes every 15 seconds</span></section>
    {error && <p className="alert" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    {(!open || !mine) && <p className="readonly-note">{!open ? "This test or exam group is read-only. Pending drafts are retained for recovery." : "You can view this test. Only selected participants enter new paper marks; admins can correct existing scores."}</p>}
    {test.status === "Closed" && <section className="panel marker-downloads"><h3>Download submitted student data</h3>
      <p>Final saved paper entries for each marker, including zero marks and admin corrections. Automatically filled absent-student zeroes are excluded.</p>
      <div className="completion-actions">{participants.filter(p => admin || p.marker_id === profile.id).map(p => <button key={p.marker_id} className="secondary-button" disabled={exporting || busy || participantStatus(p) !== "Submitted"} onClick={() => exportMarker(p.marker_id)}>{exporting ? "Preparing…" : `Download ${p.name} .xlsx`}</button>)}</div>
      <p className="field-help">Filename: Phase &lt;phase number&gt; Paper &lt;paper number&gt; &lt;marker’s name&gt;.xlsx</p>
    </section>}
    {admin && <OnlineMarksImport snapshot={snapshot} onChanged={async () => { await refresh(); onChanged(); }}/> }
    <>
      <div className="stats-grid"><SharedStat label="Your entries" value={allScores.filter(s => s.marker_id === profile.id).length}/><SharedStat label="All entries" value={allScores.length}/><SharedStat label="Your batch" value={status}/><SharedStat label="Your sync status" value={saving ? "Saving…" : currentDrafts.length ? "Not synced" : "Up to date"}/></div>
      <div className="section-head entry-heading"><h2>Enter marks</h2><div className="segmented"><button className={mode === "form" ? "selected" : ""} onClick={() => setMode("form")}>Individual</button><button className={mode === "table" ? "selected" : ""} onClick={() => setMode("table")}>Table</button></div></div>
      {mode === "form" ? <section className="panel shared-entry-panel"><label>Find a student<input className="shared-search-input" aria-label="Find a student" placeholder="Name, school or student ID" value={query} onChange={e => { setQuery(e.target.value); setSelectedId(""); }}/></label>
        {selected ? <div className="shared-selected"><h3>{selected.name}</h3><p>{selected.student_code} · {selected.school} · {selected.stream}{selected.is_active ? "" : " · Inactive"}</p><label>Final score / {formatMark(test.max_cents)}{input(selected)}</label><button className="text-button" onClick={() => { setSelectedId(""); setQuery(""); }}>Next student</button></div>
          : <div className="search-results">{matches.slice(0, query ? 12 : 4).map(s => <button className="student-result" key={s.id} onClick={() => setSelectedId(s.id)}><span className="student-result-text"><strong>{s.name}</strong><small>{s.student_code} · {s.school}</small></span><span className="badge">{s.stream}</span></button>)}{!matches.length && <p className="shared-empty">No matching students. Add a student from the Students screen, then Refresh scores.</p>}</div>}
      </section> : <section className="panel"><div className="table-scroll"><table><thead><tr><th>Student</th><th>ID / Stream</th><th>Score / {formatMark(test.max_cents)}</th><th>Entered by</th></tr></thead><tbody>{students.map(s => { const old = scoresById.get(s.id); return <tr key={s.id}><td><strong>{s.name}</strong><small>{s.school}{s.is_active ? "" : " · Inactive"}</small></td><td>{s.student_code}<small>{s.stream}</small></td><td>{input(s)}</td><td>{old && !old.is_deleted ? old.marker_name || (old.source === "Online" ? "Online import" : "Admin zero fill") : "—"}</td></tr>; })}</tbody></table></div></section>}
      <div className="shared-submit-bar"><span>{status} · {currentDrafts.length ? `${currentDrafts.length} draft(s) waiting to sync` : mine && !allScores.some(s => s.marker_id === profile.id) ? "No papers entered by you. You can submit an empty batch." : "Your scores are saved to the server."}</span><button className="primary-button" disabled={!open || !mine || busy || blocked} onClick={submit}>{busy ? "Please wait…" : mine && !allScores.some(s => s.marker_id === profile.id) && !currentDrafts.length ? "Submit empty batch (no papers)" : "Finish & Submit"}</button></div>
      {!!currentDrafts.length && <section className="draft-review"><h3>Drafts waiting to sync</h3>{currentDrafts.map(([id,d]) => <div key={id}><span>{d.name || d.enrolmentId}: {parseMark(d.text, test.max_cents / 100).error || draftErrors[id] || "Waiting to save"}</span><button className="text-button" disabled={saving || busy || !open} onClick={() => flush(true)}>Retry save</button>
        <button className="text-button" disabled={saving || busy} onClick={() => { if (!window.confirm("Discard this unsynced draft? The server-saved score will stay unchanged.")) return; try { changeDraft(id, null, d.requestId); } catch(e) { setError(e.message); } }}>Discard draft</button></div>)}<p>For a stale-score conflict, copy your intended mark, Refresh scores, discard the old draft and re-enter after reviewing the saved value. Retrying alone never overwrites a newer score.</p></section>}
      <section className="panel recent-panel"><div className="panel-title-row"><h3>Entries at a glance</h3><div className="segmented small"><button className={scope === "mine" ? "selected" : ""} onClick={() => setScope("mine")}>My entries</button><button className={scope === "all" ? "selected" : ""} onClick={() => setScope("all")}>All markers</button></div></div>
        <div className="table-scroll"><table><thead><tr><th>Student</th><th>Score</th><th>Marker</th><th>Source</th><th>Action</th></tr></thead><tbody>{displayed.map(s => <tr key={s.enrolment_id}><td>{students.find(e => e.id === s.enrolment_id)?.name || s.enrolment_id}</td><td>{formatMark(s.cents)}</td><td>{s.marker_name || (s.source === "Online" ? "Online import" : "Admin zero fill")}{s.original_marker_id && s.original_marker_id!==s.marker_id && <small>Originally marked by {s.original_marker_name || s.original_marker_id}</small>}</td><td>{s.source}</td><td><button className="text-button" onClick={() => { setSelectedId(s.enrolment_id); setMode("form"); }}>View / Edit</button>{open && (admin || s.marker_id === profile.id) && <button className="text-button" disabled={saving || busy || currentDrafts.length > 0} onClick={() => { if (window.confirm("Remove this test entry? Student details and score history will be retained.")) action("app_remove_test_score", { p_test_id: testId, p_enrolment_id: s.enrolment_id, p_expected_version: s.version }, "Score removed. Student and history preserved."); }}>Remove entry</button>}</td></tr>)}</tbody></table>{!displayed.length && <p className="shared-empty">No saved scores in this view.</p>}</div>
      </section>
      {admin && <ParticipantManagement snapshot={snapshot} profiles={profiles} blocked={blocked || saving || busy || currentDrafts.length>0} onSaved={async()=>{await refresh();onChanged();}}/>}
      {snapshot.pending_online > 0 && <p className="alert" role="status">{snapshot.pending_online} online import row(s) require admin review before this test can be completed.</p>}
      <section className="panel completion-panel"><h3>{admin ? "Complete this test" : "Marker submissions"}</h3><p>{completion.missing.length} active student(s) without a score. {participants.length - completion.unsubmitted.length} of {participants.length} marker batches submitted.</p>
        <ul className="shared-batch-list">{participants.map(p => {
          const count = allScores.filter(s => s.marker_id === p.marker_id).length;
          const canConfirm = p.batch_revision === 0 && !snapshot.scores.some(s => s.marker_id === p.marker_id);
          return <li key={p.marker_id}><span>{p.name}{p.is_active ? "" : " · Disabled account"}<small>{count} paper entries</small></span><strong>{participantStatus(p)}</strong>
            {admin && canConfirm && participantStatus(p) !== "Submitted" && <button className="secondary-button" disabled={!open || busy || saving || blocked} onClick={() => confirmEmptyBatch(p)}>Confirm no papers</button>}</li>;
        })}</ul>
        <p>A selected marker with no papers can submit an empty batch. Admins can confirm no papers only when that marker has no recorded work; other markers' entries stay unchanged.</p>
        {admin && <>{!!completion.missing.length && <details className="completion-review"><summary>Review students with no score ({completion.missing.length})</summary><ul>{completion.missing.map(s => <li key={s.id}>{s.name}<span>{s.student_code} · {s.stream}</span></li>)}</ul></details>}
          <div className="completion-actions"><button className="secondary-button" disabled={!open || busy || saving || currentDrafts.length > 0 || !completion.missing.length || completion.unsubmitted.length > 0 || snapshot.pending_online > 0} onClick={() => complete("zero")}>Add zeroes to remaining students ({completion.missing.length})</button>
            <button className="primary-button" disabled={!open || busy || saving || currentDrafts.length > 0 || completion.missing.length > 0 || completion.unsubmitted.length > 0 || snapshot.pending_online > 0} onClick={() => complete("close")}>Close test</button>
            {test.status !== "Open" && <button className="secondary-button" disabled={group.is_archived || busy || saving || exporting} onClick={() => complete("reopen")}>Reopen test</button>}
            {test.status !== "Cancelled" && <button className="text-button" disabled={group.is_archived || busy || saving || exporting} onClick={() => complete("cancel")}>Cancel test</button>}
            <button className="text-button" disabled={group.is_archived || busy || saving || exporting || blocked || currentDrafts.length > 0 || snapshot.has_import_history || snapshot.has_report_history || snapshot.scores.length > 0 || snapshot.history.some(h => h.action !== "Created test") || participants.some(p => p.batch_revision > 0 || p.submitted_revision != null)} onClick={removeTest}>Remove empty test</button>
          </div><p>Every marker submits their latest batch first. Then add zeroes for the remaining students and close the test. The server rechecks the test revision and exact student list.</p></>}
      </section>
      {admin && <details className="panel shared-history"><summary>Recent test history (latest 100 events)</summary><div className="table-scroll"><table><thead><tr><th>Time</th><th>Actor</th><th>Student</th><th>Action</th><th>Before → After</th></tr></thead><tbody>{snapshot.history.map(h => <tr key={h.id}><td>{new Date(h.created_at).toLocaleString("en-GB", { timeZone: "Asia/Colombo" })}</td><td>{h.actor_name}</td><td>{students.find(s => s.id === h.enrolment_id)?.name || "—"}</td><td>{h.action}</td><td>{h.before_cents == null ? "—" : formatMark(h.before_cents)} → {h.after_cents == null ? "—" : formatMark(h.after_cents)}</td></tr>)}</tbody></table></div></details>}
    </>
  </>;
}
function SharedStat({ label, value }) { return <div className="stat-card"><div className="stat-top"><span>{label}</span></div><strong className={String(value).length > 7 ? "text-stat" : ""}>{value}</strong></div>; }

