import React, { useEffect, useRef, useState } from "react";
import { featureRequest } from "./featureApi.js";
import { readOnlineFile, onlineRows, checkOnlineTarget, previewOnlineRows } from "./onlineImport.js";
import { officialCode } from "./studentImport.js";
import { recoveryCandidate,recoverDateMarks } from "./dateMarkRecovery.js";
import { moduleLoadMessage } from "./moduleLoading.js";
import FileUploadField from "./FileUploadField.jsx";

export default function OnlineMarksImport({ snapshot, onChanged }) {
  const [batches, setBatches] = useState([]), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [file, setFile] = useState(null), [busy, setBusy] = useState(false), [selected, setSelected] = useState(null), [confirmed, setConfirmed] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [restoreDates,setRestoreDates] = useState(false);
  const receipt = useRef(null);
  const { test, group } = snapshot, editable = test.status === "Open" && !group.is_archived;
  async function refresh() {
    try { setBatches(await featureRequest("app_get_online_imports", { p_test_id: test.id })); setLoadError(""); }
    catch(e) { setLoadError(e.message); }
  }
  useEffect(() => { let cancelled = false;
    featureRequest("app_get_online_imports", { p_test_id: test.id }).then(b => { if (!cancelled) { setBatches(b); setLoadError(""); } }).catch(e => { if (!cancelled) setLoadError(e.message); });
    return () => { cancelled = true; };
  }, [test.id, test.revision]);
  async function chooseFile(upload) {
    if (!upload) return;
    setBusy(true); setFile(null); setError(""); setNotice(""); setConfirmed(false); setRestoreDates(false); receipt.current = null;
    try {
      const source = await readOnlineFile(upload), rows = onlineRows(source.matrix);
      if (!rows.length) throw Error("This file has no student rows.");
      setFile({ name: upload.name, heading: source.heading, rows });
    } catch(e) { setError(moduleLoadMessage(e)); } finally { setBusy(false); }
  }
  const preparedRows = file ? recoverDateMarks(file.rows,test.max_cents,restoreDates) : [];
  const recoverable = file ? file.rows.filter(row=>recoveryCandidate(row,test.max_cents)) : [];
  const targetErrors = file ? checkOnlineTarget(file.heading, preparedRows, test, group.exam_year) : [];
  const preview = file ? previewOnlineRows(preparedRows, snapshot) : [];
  async function stage() {
    setBusy(true); setError("");
    if (!receipt.current) receipt.current = crypto.randomUUID();
    try {
      const result = await featureRequest("app_import_online_file", { p_test_id: test.id, p_filename: file.name, p_heading: file.heading, p_rows: preparedRows, p_request_id: receipt.current });
      setFile(null); setSelected(null); receipt.current = null; setNotice(`File processed. ${result.recovered_pending || 0} earlier pending row(s) recovered from the file. Valid scores saved; review any remaining issues below.`); await refresh(); onChanged();
    } catch(e) { setError(e.message); } finally { setBusy(false); }
  }
  const pending = batches.flatMap(b => b.rows.filter(r => r.status === "Pending").map(r => ({ ...r, filename: b.filename })));
  return <section className="panel workspace-panel online-import"><div className="panel-title-row"><h3>Online marks import</h3><button className="secondary-button" disabled={busy} onClick={refresh}>Refresh imports</button></div>
    <p>Upload the original online export (.xls HTML table), or a single-sheet .xlsx/CSV. Import all districts. Online zeroes are skipped; existing student details are preserved.</p>
    {!editable && <p className="readonly-note">Reopen the test and restore its group before importing or reviewing rows.</p>}
    <FileUploadField label="Online export" accept=".xls,.xlsx,.csv,.html,.htm" disabled={busy || !editable} hint="Original HTML-table .xls, .xlsx or CSV · Up to 5 MB" onChange={e => { chooseFile(e.target.files[0]); e.target.value = ""; }}/>
    {error && <p className="alert" role="alert">{error}</p>}{loadError && <p className="alert" role="alert">{loadError}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    {file && <><h4>Preview · {file.name}</h4><p>{file.heading || "No test heading detected"}</p>
      {targetErrors.map(e => <p className="alert" key={e}>{e}</p>)}
      {!!recoverable.length && <label className="import-confirm"><input type="checkbox" disabled={busy} checked={restoreDates} onChange={e=>{setRestoreDates(e.target.checked);setConfirmed(false);receipt.current=null;}}/>Restore {recoverable.length} Excel month/year conversions as marks out of {test.max_cents/100} (for example, Dec-40 → 12 / 40). I have checked this interpretation against the original results.</label>}
      <div className="table-scroll import-preview"><table><thead><tr><th>Row</th><th>Student ID / name</th><th>Original marks</th><th>Interpreted score</th><th>Outcome</th></tr></thead><tbody>{preview.map((r,i) => <tr key={i}><td>{r.row_number}</td><td>{r.code}<small>{r.name}</small></td><td>{r.mark_original || r.mark}</td><td>{r.mark_conversion ? r.mark : recoveryCandidate(r,test.max_cents) ? `Recovery available: ${recoveryCandidate(r,test.max_cents).mark}` : r.mark}</td><td><strong>{r.status}</strong><small>{r.detail}</small></td></tr>)}</tbody></table></div>
      <label className="import-confirm"><input type="checkbox" disabled={busy} checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>I checked this export against {group.exam_year}, {test.phase}, Paper {test.paper}, maximum {test.max_cents / 100}.</label>
      <button className="primary-button" disabled={busy || !editable || !confirmed || !!targetErrors.length} onClick={stage}>{busy ? "Processing…" : "Import valid scores and save review rows"}</button></>}
    <h4>Pending review ({pending.length})</h4><p>Every pending row must be imported or explicitly dismissed before adding zeroes or closing this test.</p>
    {pending.some(r=>String(r.raw.mark).includes("[Unsupported cell:")) && <p className="readonly-note">To recover earlier date-converted scores, choose the same .xlsx file again and confirm its date recovery preview. Matching pending rows will be updated; unknown students still need a stream.</p>}
    <div className="table-scroll import-preview"><table><thead><tr><th>File / row</th><th>Student</th><th>Original score</th><th>Issue</th><th>Action</th></tr></thead><tbody>{pending.map(r => <tr key={r.id}><td>{r.filename}<small>Row {r.row_number}</small></td><td>{r.raw.code}<small>{r.raw.name}</small></td><td>{r.raw.mark}</td><td>{r.message}</td><td><button className="secondary-button" disabled={!editable || busy || !!selected} onClick={() => setSelected(r)}>Review</button></td></tr>)}</tbody></table></div>
    {selected && <ReviewOnlineRow key={selected.id} row={selected} snapshot={snapshot} onClose={() => setSelected(null)} onSaved={async () => { setSelected(null); await refresh(); onChanged(); }}/>} 
    {!!batches.length && <details><summary>Import history ({batches.length} files)</summary>{batches.map(b => <div key={b.id} className="import-history"><strong>{b.filename}</strong><small>{new Date(b.created_at).toLocaleString("en-GB", { timeZone: "Asia/Colombo" })}</small><p>{["Imported","Skipped","Pending","Dismissed"].map(status => `${b.rows.filter(r => r.status === status).length} ${status.toLowerCase()}`).join(" · ")}</p>
      <details><summary>Row outcomes and review reasons</summary><ul>{b.rows.map(r => <li key={r.id}>Row {r.row_number}: {r.raw.code} · {r.status} · {r.message}{r.reason ? ` Reason: ${r.reason}` : ""}</li>)}</ul></details></div>)}</details>}
  </section>;
}

function ReviewOnlineRow({ row, snapshot, onClose, onSaved }) {
  const [values, setValues] = useState({ code: row.raw.code || "", mark: row.raw.mark || "", name: row.raw.name || "", school: /^(other|school not updated|-|\d+)$/i.test(row.raw.school) ? "" : row.raw.school || "", stream: ["Maths","Bio"].includes(row.raw.stream) ? row.raw.stream : "", create_student: false });
  const [replace, setReplace] = useState(false), [reason, setReason] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRef(null);
  const reviewedScore = useRef(null);
  const change = (k,v) => { setValues(s => ({ ...s, [k]:v })); request.current = null; };
  let canonical = "";
  try { canonical = officialCode(values.code,snapshot.group.exam_year); } catch {}
  const student = snapshot.students.find(s => s.student_code === canonical);
  const score = snapshot.scores.find(s => s.enrolment_id === student?.id && !s.is_deleted);
  if (!reviewedScore.current || reviewedScore.current.code !== canonical) reviewedScore.current = { code:canonical, version:score?.version ?? 0 };
  const expectedVersion = reviewedScore.current.version;
  const scoreChanged = expectedVersion !== (score?.version ?? 0);
  async function save(action) {
    const args = { p_row_id: row.id, p_action: action, p_details: values, p_replace: replace, p_expected_version: expectedVersion, p_reason: reason };
    const fingerprint = JSON.stringify(args);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id:crypto.randomUUID() };
    setBusy(true); setError("");
    try {
      const result = await featureRequest("app_resolve_online_row", { ...args, p_request_id:request.current.id });
      if (result.status === "Pending") { setError(result.message); request.current = null; } else await onSaved();
    } catch(e) { setError(e.message); } finally { setBusy(false); }
  }
  return <section className="draft-review"><h4>Review row {row.row_number}</h4><div className="shared-fields">
    <label>Official ID<input value={values.code} disabled={busy} onChange={e => change("code",e.target.value)}/></label><label>Original score / maximum<input value={values.mark} disabled={busy} onChange={e => change("mark",e.target.value)}/></label>
    {student ? <p>Matched database student: {student.name}, {student.school}, {student.stream}. These details will be preserved.</p> : <><label className="check-field"><input type="checkbox" checked={values.create_student} disabled={busy} onChange={e => change("create_student",e.target.checked)}/>Create this missing student</label>
      <label>Name<input maxLength={200} disabled={busy} value={values.name} onChange={e => change("name",e.target.value)}/></label><label>School<input maxLength={200} disabled={busy} value={values.school} onChange={e => change("school",e.target.value)}/></label><label>Stream<select disabled={busy} value={values.stream} onChange={e => change("stream",e.target.value)}><option value="">Choose stream</option><option>Maths</option><option>Bio</option></select></label></>}
    {score && <label className="check-field"><input type="checkbox" disabled={busy} checked={replace} onChange={e => { setReplace(e.target.checked); request.current=null; }}/>Replace existing {score.source} score {score.cents / 100} (version {score.version})</label>}
    <label>Reason for replacement or dismissal<input maxLength={500} disabled={busy} value={reason} onChange={e => { setReason(e.target.value); request.current=null; }}/></label></div>
    {scoreChanged && <p className="alert" role="alert">This score changed while you were reviewing it. Cancel review and open the row again to check the latest value.</p>}
    {error && <p className="alert" role="alert">{error}</p>}<div className="shared-form-actions"><button className="primary-button" disabled={busy || scoreChanged} onClick={() => save("import")}>Import reviewed row</button><button className="secondary-button" disabled={busy || !reason.trim()} onClick={() => save("dismiss")}>Dismiss with reason</button><button className="text-button" disabled={busy} onClick={onClose}>Cancel review</button></div>
  </section>;
}
