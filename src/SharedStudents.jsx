import React, { useEffect, useRef, useState } from "react";
import { supabase } from "./lib/supabaseClient.js";
import { callStudentAction, loadEnrolments, loadGroups, loadSchools, searchDirectory } from "./studentsApi.js";
import BulkStudentImport from "./BulkStudentImport.jsx";

export default function SharedStudents({ profile }) {
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState("");
  const [schools, setSchools] = useState([]);
  const [rows, setRows] = useState([]);
  const [rowsGroupId, setRowsGroupId] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [error, setError] = useState("");
  const [rowsError, setRowsError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newYear, setNewYear] = useState("");
  const [showGroup, setShowGroup] = useState(false);
  const group = groups.find((item) => item.id === groupId);
  const admin = profile.role === "admin";

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([loadGroups(supabase, controller.signal), loadSchools(supabase, controller.signal)])
      .then(([nextGroups, nextSchools]) => {
        if (cancelled) return;
        setGroups(nextGroups);
        setSchools(nextSchools.sort((a, b) => a.name.localeCompare(b.name)));
        setGroupId((previous) => nextGroups.some((item) => item.id === previous)
          ? previous : (nextGroups.find((item) => !item.is_archived)?.id || nextGroups[0]?.id || ""));
      })
      .catch((failure) => {
        if (!cancelled) setError(controller.signal.aborted ? "Loading timed out. Check your connection and Refresh." : failure.message);
      })
      .finally(() => { clearTimeout(timer); if (!cancelled) setLoading(false); });
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [refresh]);

  useEffect(() => {
    if (!groupId) { setRows([]); setRowsLoading(false); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let cancelled = false;
    setRowsLoading(true);
    setRowsError("");
    setRows([]);
    loadEnrolments(supabase, groupId, controller.signal)
      .then((next) => {
        if (!cancelled) {
          setRows(next.sort((a, b) => (a.student?.name || "").localeCompare(b.student?.name || "")));
          setRowsGroupId(groupId);
        }
      })
      .catch((failure) => {
        if (!cancelled) setRowsError(controller.signal.aborted ? "Loading students timed out. Refresh to try again." : failure.message);
      })
      .finally(() => { clearTimeout(timer); if (!cancelled) setRowsLoading(false); });
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [groupId, refresh]);

  async function createGroup(event) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const id = await callStudentAction(supabase, "app_create_exam_group", { p_exam_year: Number(newYear) });
      setGroupId(id); setNewYear(""); setShowGroup(false);
      setNotice("Exam group created."); setRefresh((value) => value + 1);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function toggleArchive() {
    const archive = !group.is_archived;
    if (!window.confirm(`${archive ? "Archive" : "Restore"} the ${group.exam_year} group? ${archive ? "Student records will become read-only." : "Student entry will be available again."}`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await callStudentAction(supabase, "app_set_group_archived", { p_group_id: group.id, p_archived: archive });
      setGroups((previous) => previous.map((item) => item.id === group.id ? { ...item, is_archived: archive } : item));
      setNotice(archive ? "Group archived. Records remain available to view." : "Group restored.");
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function changeStatus(row) {
    const active = !row.is_active;
    if (!window.confirm(`${active ? "Reactivate" : "Deactivate"} ${row.student.name} in ${group.exam_year}? Their records and results are preserved.`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await callStudentAction(supabase, "app_set_enrolment_active", {
        p_enrolment_id: row.id, p_is_active: active, p_expected_version: row.version,
      });
      setNotice(active ? "Student reactivated." : "Student deactivated. Records and results are preserved.");
      setRefresh((value) => value + 1);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  const matches = searchDirectory(rowsGroupId === groupId ? rows : [], query, group?.exam_year);
  return (
    <section className="shared-directory">
      <div className="shared-toolbar">
        <label>Exam-year group
          <select aria-label="Exam-year group" value={groupId} disabled={loading || busy || showAdd || !!editing || showImport} onChange={(event) => {
            setShowImport(false); setGroupId(event.target.value); setQuery(""); setNotice("");
          }}>
            {!groups.length && <option value="">No groups available</option>}
            {groups.map((item) => <option key={item.id} value={item.id}>
              {item.exam_year}{item.is_archived ? " · Archived" : ""}
            </option>)}
          </select>
        </label>
        <button className="secondary-button" disabled={loading || busy || showAdd || !!editing || showImport} onClick={() => setRefresh((value) => value + 1)}>Refresh</button>
        {admin && <button className="secondary-button" disabled={busy || showAdd || !!editing || showImport} onClick={() => setShowGroup((value) => !value)}>Add exam group</button>}
        {admin && group && <button className="text-button" disabled={loading || busy || showAdd || !!editing || showImport} onClick={toggleArchive}>
          {group.is_archived ? "Restore group" : "Archive group"}
        </button>}
      </div>
      {showGroup && <form className="panel shared-group-form" onSubmit={createGroup}>
        <label>New exam year<input type="number" min="1900" max="9999" step="1" required value={newYear} disabled={busy} onChange={(event) => setNewYear(event.target.value)} /></label>
        <button className="primary-button" disabled={busy}>{busy ? "Saving..." : "Create group"}</button>
        <button type="button" className="text-button" disabled={busy} onClick={() => setShowGroup(false)}>Cancel</button>
      </form>}
      {error && <p className="alert" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {group?.is_archived && <p className="alert">This group is archived. Everyone can view its student records; an admin must restore it before making changes.</p>}
      {admin && group && !group.is_archived && showImport && <BulkStudentImport key={group.id} group={group}
        onClose={() => setShowImport(false)} onSaved={() => setRefresh(value => value + 1)} />}
      {(showAdd || editing) && group && <StudentEntry key={editing?.id || group.id} group={group} schools={schools} record={editing}
        onClose={() => { setShowAdd(false); setEditing(null); }}
        onSaved={(code) => {
          setShowAdd(false); setEditing(null); setQuery(""); setNotice(`Student ${editing ? "updated" : "saved"} in the shared database: ${code}`);
          setRefresh((value) => value + 1);
        }} />}
      <section className="panel">
        <div className="panel-title-row">
          <div><h3>Shared student directory</h3><p>Saved in Supabase and available to all active markers.</p></div>
          {admin && <button className="secondary-button" disabled={loading || busy || !group || group.is_archived || showAdd || !!editing || showImport} onClick={() => setShowImport(true)}>Import students</button>}
          <button className="primary-button" disabled={loading || busy || !group || group.is_archived || showAdd || !!editing || showImport} onClick={() => { setShowAdd(true); setNotice(""); }}>Add student</button>
        </div>
        <div className="directory-search search-box">
          <input aria-label="Search shared student directory" placeholder="Name, school, full ID, or official number" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        {rowsError && <p className="alert" role="alert">{rowsError}</p>}
        {loading || rowsLoading || (groupId && rowsGroupId !== groupId && !rowsError) ? <p className="shared-empty" role="status">Loading student records...</p> : !error && !rowsError && <>
          <p className="shared-count">{matches.length} {matches.length === 1 ? "student" : "students"} found</p>
          <div className="table-scroll"><table><thead><tr><th>Name</th><th>Student ID</th><th>School</th><th>Stream</th><th>Status</th>{admin && <th>Actions</th>}</tr></thead>
            <tbody>{matches.map((row) => <tr key={row.id}>
              <td><strong>{row.student?.name}</strong></td><td className="mono">{row.student_code}</td>
              <td>{row.school?.name}</td><td>{row.stream}</td><td>{row.is_active ? "Active" : "Inactive"}</td>
              {admin && <td><div className="student-row-actions">
                <button className="text-button" aria-label={`Edit ${row.student?.name}`} disabled={busy || loading || group?.is_archived || showAdd || !!editing || showImport} onClick={() => { setEditing(row); setNotice(""); }}>Edit</button>
                <button className="text-button" aria-label={`${row.is_active ? "Deactivate" : "Reactivate"} ${row.student?.name}`} disabled={busy || loading || group?.is_archived || showAdd || !!editing || showImport} onClick={() => changeStatus(row)}>{row.is_active ? "Deactivate" : "Reactivate"}</button>
              </div></td>}
            </tr>)}</tbody></table></div>
          {!matches.length && <p className="shared-empty">{rows.length ? "No matching students." : "No students in this group yet."}</p>}
        </>}
      </section>
    </section>
  );
}

function StudentEntry({ group, schools, record, onClose, onSaved }) {
  const [values, setValues] = useState({ name: record?.student?.name || "", school: record?.school?.name || "", stream: record?.stream || "", officialId: record?.student_code || "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(null);
  const set = (field, value) => setValues((previous) => ({ ...previous, [field]: value }));
  const hasSchool = schools.some((school) => school.name.toLowerCase() === values.school.trim().replace(/\s+/g, " ").toLowerCase());
  async function save(event) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      const args = {
        p_group_id: group.id, p_name: values.name.trim(), p_school: values.school.trim(),
        p_stream: values.stream, p_official_id: values.officialId.trim(),
      };
      const fingerprint = JSON.stringify(args);
      if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
      const result = record
        ? await callStudentAction(supabase, "app_update_student", {
            p_enrolment_id: record.id, p_name: args.p_name, p_school: args.p_school, p_stream: args.p_stream,
            p_expected_enrolment_version: record.version, p_expected_student_version: record.student.version,
          })
        : await callStudentAction(supabase, "app_add_student", { ...args, p_request_id: request.current.id });
      const saved = Array.isArray(result) ? result[0] : result;
      onSaved(saved.student_code);
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  }
  return <form className="panel shared-student-form" onSubmit={save}>
    <h3>{record ? "Edit student" : "Add student"} · {group.exam_year}</h3>
    <div className="shared-fields">
      <label>Student name<input autoFocus required maxLength={200} value={values.name} disabled={saving} onChange={(event) => set("name", event.target.value)} /></label>
      <label>School<input list="shared-school-options" required maxLength={200} value={values.school} disabled={saving} onChange={(event) => set("school", event.target.value)} />
        <datalist id="shared-school-options">{schools.map((school) => <option key={school.id} value={school.name} />)}</datalist>
        <small>{values.school.trim() && !hasSchool ? "This school will be added when you save the student." : "Choose a school or type a missing school's name."}</small>
      </label>
      <label>Stream<select aria-label="Stream" required value={values.stream} disabled={saving} onChange={(event) => set("stream", event.target.value)}>
        <option value="">Choose stream</option><option value="Maths">Maths</option><option value="Bio">Bio</option>
      </select></label>
      <label>{record ? "Student ID" : "Official ID or number (optional)"}<input readOnly={!!record} maxLength={100} placeholder={`e.g. 6900 or SC/${group.exam_year}/6900`} value={values.officialId} disabled={saving} onChange={(event) => set("officialId", event.target.value)} />
        <small>{record ? "ID replacement and linking returning students will be added in a later step." : "Leave blank to generate a temporary ID."}</small>
      </label>
    </div>
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="shared-form-actions"><button className="primary-button" disabled={saving}>{saving ? "Saving..." : record ? "Save changes" : "Save student"}</button>
      <button type="button" className="text-button" disabled={saving} onClick={onClose}>Cancel</button></div>
  </form>;
}

