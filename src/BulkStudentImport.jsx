import React, { useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabaseClient.js";
import { loadEnrolments } from "./studentsApi.js";
import { fields, guessColumns, previewStudents } from "./studentImport.js";
import { downloadStudentTemplate, readStudentFile } from "./workbooks.js";

export default function BulkStudentImport({ group, onClose, onSaved }) {
  const [sheets, setSheets] = useState([]), [sheetIndex, setSheetIndex] = useState(0);
  const [mapping, setMapping] = useState({}), [existing, setExisting] = useState([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [ready, setReady] = useState(false);
  const [result, setResult] = useState(null);
  const receipt = useRef(null);
  const matrix = sheets[sheetIndex]?.rows || [];
  const headers = matrix[0] || [];
  const mappingReady = ["name", "school", "stream"].every(k => mapping[k] >= 0);
  const preview = useMemo(() => {
    try { return mappingReady ? { rows: previewStudents(matrix, mapping, existing, group.exam_year) } : { rows: [] }; }
    catch (e) { return { rows: [], error: e.message }; }
  }, [matrix, mapping, existing, group.exam_year, mappingReady]);
  const valid = preview.rows.filter(row => row.status === "New");
  const count = status => preview.rows.filter(row => row.status === status).length;
  async function loadExisting() {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try { return await loadEnrolments(supabase, group.id, controller.signal); }
    finally { clearTimeout(timer); }
  }
  async function selectFile(file) {
    if (!file) return;
    setBusy(true); setError(""); setReady(false); setSheets([]); setResult(null); receipt.current = null;
    try {
      const [nextSheets, records] = await Promise.all([readStudentFile(file), loadExisting()]);
      if (!nextSheets.length || !nextSheets[0].rows.length) throw Error("This file contains no student sheets. Add column headings and student rows.");
      setSheets(nextSheets); setSheetIndex(0); setMapping(guessColumns(nextSheets[0].rows[0])); setExisting(records); setReady(true);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function importRows() {
    const rows = valid.map(({ name, school, stream, officialId }) => ({ name, school, stream, officialId }));
    if (!rows.length || !window.confirm(`Import ${rows.length} new student(s) into ${group.exam_year}? Other rows will be skipped and existing records preserved.`)) return;
    setBusy(true); setError("");
    const payload = JSON.stringify(rows);
    if (receipt.current?.payload !== payload) receipt.current = { payload, id: crypto.randomUUID() };
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 60000);
    try {
      const { data, error: failure } = await supabase.rpc("app_import_students", { p_group_id: group.id, p_rows: rows, p_request_id: receipt.current.id }).abortSignal(controller.signal);
      if (failure) throw Error(failure.code === "PGRST202" ? "Bulk import setup is missing. Run 005_import_remove_export.sql in Supabase first." : failure.message);
      setResult(data); setReady(false); onSaved(data);
    } catch (e) { setError(controller.signal.aborted ? "Import timed out. Retry this same preview safely; it will not duplicate a completed import." : e.message); }
    finally { clearTimeout(timer); setBusy(false); }
  }
  return <section className="panel student-import" aria-busy={busy}>
    <div className="panel-title-row"><h3>Import students · {group.exam_year}</h3><button className="text-button" disabled={busy} onClick={onClose}>Close import</button></div>
    <p>Upload .xlsx or UTF-8 CSV, with column headings in the first row. Name, school and Maths/Bio stream are required. Leave unknown official IDs blank for temporary IDs. Up to 1000 students per import.</p>
    <div className="shared-form-actions"><button className="secondary-button" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await downloadStudentTemplate(); } catch(e) { setError(e.message); } finally { setBusy(false); } }}>Download template</button>
      <label>Student file<input type="file" accept=".xlsx,.csv" disabled={busy} onChange={e => { selectFile(e.target.files[0]); e.target.value = ""; }}/></label></div>
    {error && <p className="alert" role="alert">{error}</p>}
    {result && <p className="notice" role="status">Imported {result.added} students; {result.skipped} already present at save time. {preview.rows.length - valid.length} preview rows were excluded. Existing records were preserved.</p>}
    {sheets.length > 0 && !result && <>
      <label>Worksheet<select disabled={busy} value={sheetIndex} onChange={e => { const i = Number(e.target.value); setSheetIndex(i); setMapping(guessColumns(sheets[i].rows[0])); receipt.current = null; }}>{sheets.map((sheet, i) => <option value={i} key={i}>{sheet.name}</option>)}</select></label>
      <div className="shared-fields">{Object.entries(fields).map(([key, label]) => <label key={key}>{label}<select disabled={busy} value={mapping[key] ?? -1} onChange={e => { setMapping(p => ({ ...p, [key]: Number(e.target.value) })); receipt.current = null; }}><option value={-1}>{key === "officialId" ? "No ID column" : "Select a column"}</option>{headers.map((h, i) => <option key={i} value={i}>{i + 1}: {h || "(blank header)"}</option>)}</select></label>)}</div>
      {!mappingReady && <p className="field-help">Select the name, school and stream columns to preview.</p>}
      {preview.error && <p className="alert" role="alert">{preview.error}</p>}
      {mappingReady && <><p>{valid.length} new · {count("Existing")} existing · {count("Duplicate")} duplicates · {count("Review")} to review · {count("Invalid")} invalid</p>
        <p>Only new valid rows will be imported. Fix excluded rows in the file and upload again; existing details are never overwritten.</p>
        <div className="table-scroll import-preview"><table><thead><tr><th>File row</th><th>Name</th><th>School</th><th>Stream</th><th>ID</th><th>Status</th></tr></thead><tbody>{preview.rows.map(row => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.name}</td><td>{row.school}</td><td>{row.stream}</td><td>{row.officialId || "Temporary"}</td><td><strong>{row.status}</strong><small>{row.detail}</small></td></tr>)}</tbody></table></div>
        <button className="primary-button" disabled={busy || !ready || !valid.length || !!preview.error} onClick={importRows}>{busy ? "Importing…" : `Import ${valid.length} new students`}</button></>}
    </>}
  </section>;
}
