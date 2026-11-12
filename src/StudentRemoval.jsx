import React,{useRef,useState} from "react";
import {featureRequest} from "./featureApi.js";
import {loadSharedDrafts} from "./sharedMarksApi.js";

export default function StudentRemoval({record,group,profileId,onClose,onSaved}) {
  const [allYears,setAllYears]=useState(false),[preview,setPreview]=useState(null);
  const [reason,setReason]=useState(""),[phrase,setPhrase]=useState(""),[stopped,setStopped]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");const receipt=useRef(null);
  function reset(){setPreview(null);setPhrase("");setStopped(false);receipt.current=null;setError("");}
  async function review(){
    setBusy(true);reset();
    try{setPreview(await featureRequest('app_preview_student_removal',{p_enrolment_id:record.id,p_all_years:allYears}));}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function remove(e){
    e.preventDefault();setBusy(true);setError("");
    try{
      const stored=loadSharedDrafts(profileId);
      if(stored.error)throw Error(stored.error);
      const ids=new Set(preview.enrolments.map(e=>e.id));
      if(Object.values(stored.drafts).some(d=>ids.has(d.enrolmentId)))throw Error("Discard this student's local drafts in Test workspace before permanent removal.");
      const args={p_enrolment_id:record.id,p_all_years:allYears,p_expected_fingerprint:preview.fingerprint,p_confirmation:phrase,p_reason:reason.trim()};
      const key=JSON.stringify(args);if(receipt.current?.key!==key)receipt.current={key,id:crypto.randomUUID()};
      await featureRequest('app_remove_student',{...args,p_request_id:receipt.current.id});onSaved();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <section className="panel workspace-panel student-removal" aria-busy={busy}>
    <div className="panel-title-row"><h3>Remove student · {group.exam_year}</h3><button className="text-button" disabled={busy} onClick={onClose}>Cancel removal</button></div>
    <p><strong>{record.student?.name}</strong> · {record.student_code}</p>
    <p>Permanently removes the selected enrolment and its marks, including removed score entries and student/mark history. Deactivate the student instead if their results should stay available.</p>
    <label className="import-confirm"><input type="checkbox" disabled={busy} checked={allYears} onChange={e=>{setAllYears(e.target.checked);reset();}}/>Also remove this same linked student from every exam year.</label>
    <p className="field-help">By default only {group.exam_year} is removed. Other students with similar names are never selected automatically. Archived years must be restored before removal.</p>
    <button className="secondary-button" disabled={busy} onClick={review}>{busy?'Please wait…':'Review student removal'}</button>
    {error&&<p className="alert" role="alert">{error}</p>}
    {preview&&<form onSubmit={remove} className="removal-review">
      <h4>Records for {preview.name}</h4>
      <dl className="trial-cleanup-counts">{[['Enrolments',preview.counts.enrolments],['Score records',preview.counts.scores],['History entries',preview.counts.history],['Saved reports to remove',preview.counts.reports],['Online rows to anonymize',preview.counts.import_rows]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <div className="table-scroll"><table><thead><tr><th>Exam year</th><th>ID</th><th>School</th></tr></thead><tbody>{preview.enrolments.map(e=><tr key={e.id}><td>{e.exam_year}</td><td>{e.student_code}</td><td>{e.school}</td></tr>)}</tbody></table></div>
      {!!preview.reports.length&&<><p className="alert">These immutable saved reports contain this student and will be deleted in full. Generate new reports afterward. Previously downloaded files are separate.</p><ul>{preview.reports.map((r,i)=><li key={i}>{r.title} · Version {r.version}</li>)}</ul></>}
      <p>Matching online import rows are replaced by anonymous dismissed records so old file retries cannot silently restore the marks. Other report versions remain unchanged and show a source-change notice where applicable.</p>
      <div className="shared-fields"><label>Reason for removal<input required maxLength={500} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
      <label>Type {preview.confirmation}<input required autoComplete="off" value={phrase} disabled={busy} onChange={e=>setPhrase(e.target.value)}/></label></div>
      <label className="import-confirm"><input type="checkbox" checked={stopped} disabled={busy} onChange={e=>setStopped(e.target.checked)}/>All markers have stopped editing this student and discarded their unsynced drafts. I reviewed the permanent removal above.</label>
      <div className="shared-form-actions"><button className="remove-test-button" disabled={busy||!stopped||phrase!==preview.confirmation||!reason.trim()}>{busy?'Removing…':'Permanently remove student and marks'}</button><button type="button" className="text-button" disabled={busy} onClick={onClose}>Cancel removal</button></div>
    </form>}
  </section>;
}
