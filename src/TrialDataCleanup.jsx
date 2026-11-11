import React,{useState,useRef} from "react";
import {featureRequest} from "./featureApi.js";
import {loadSharedDrafts} from "./sharedMarksApi.js";

export default function TrialDataCleanup({group,profileId,tests,onCleared}) {
  const [removeStudents,setRemoveStudents]=useState(false),[preview,setPreview]=useState(null);
  const [confirmation,setConfirmation]=useState(""),[stopped,setStopped]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const receipt=useRef(null);
  function reset(){setPreview(null);setConfirmation("");setStopped(false);receipt.current=null;setError("");setNotice("");}
  function checkDrafts(){
    const stored=loadSharedDrafts(profileId);
    if(stored.error)throw Error(stored.error);
    const ids=new Set([...tests.map(t=>t.id),...(preview?.tests.map(t=>t.id)||[])]);
    if(Object.values(stored.drafts).some(d=>ids.has(d.testId)))throw Error("Save or discard this exam group's local drafts in Test workspace before clearing trial data.");
  }
  async function review(){
    setBusy(true);setError("");setNotice("");setPreview(null);setConfirmation("");setStopped(false);receipt.current=null;
    try{checkDrafts();setPreview(await featureRequest("app_preview_trial_cleanup",{p_group_id:group.id,p_remove_students:removeStudents}));}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function clear(){
    setBusy(true);setError("");
    try{
      checkDrafts();
      if(!receipt.current)receipt.current=crypto.randomUUID();
      const result=await featureRequest("app_clear_trial_data",{p_group_id:group.id,p_remove_students:removeStudents,p_expected_fingerprint:preview.fingerprint,p_confirmation:confirmation,p_request_id:receipt.current});
      reset();setNotice(`Cleared ${result.counts.tests} test(s), ${result.counts.scores} score record(s), ${result.counts.reports} saved report(s), and ${result.counts.students} student enrolment(s) from ${group.exam_year}.`);
      onCleared(result);
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  const canClear=preview&&(preview.counts.tests>0||preview.counts.reports>0||preview.counts.students>0);
  return <details className="panel workspace-panel trial-cleanup"><summary>Clear trial data · {group.exam_year}</summary>
    <p>Before real marking begins, use this to permanently clear <strong>every test</strong> in the {group.exam_year} group, including marks, marker submissions, online imports, saved reports and their history. The app cannot distinguish trial records from real records.</p>
    <p>Student records are kept by default. Accounts, schools and other exam-year groups are kept. Download anything you want to keep before continuing. This cannot be undone.</p>
    {group.is_archived&&<p className="readonly-note">Restore this archived group in Students before clearing its trial data.</p>}
    <label className="import-confirm"><input type="checkbox" checked={removeStudents} disabled={busy||group.is_archived} onChange={e=>{setRemoveStudents(e.target.checked);reset();}}/>Also remove all student records from the {group.exam_year} group. A student's enrolments in other years will be kept.</label>
    <button className="secondary-button" disabled={busy||group.is_archived} onClick={review}>{busy?"Please wait…":"Review records to remove"}</button>
    {error&&<p className="alert" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
    {preview&&<section className="trial-cleanup-review"><h3>Review cleanup · {preview.exam_year}</h3>
      <dl className="trial-cleanup-counts">{[["Tests",preview.counts.tests],["Score records (including removed entries)",preview.counts.scores],["Marker assignments and submissions",preview.counts.participants],["Online import files",preview.counts.import_files],["Online import rows",preview.counts.import_rows],["Saved reports",preview.counts.reports],["History entries",preview.counts.history],["Student records to remove",preview.counts.students],["Student records to keep",preview.counts.students_kept]].map(([label,count])=><div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
      {!!preview.tests.length&&<div className="table-scroll"><table><thead><tr><th>Phase</th><th>Paper</th><th>Status</th></tr></thead><tbody>{preview.tests.map(t=><tr key={t.id}><td>{t.phase}</td><td>{t.paper}</td><td>{t.status}</td></tr>)}</tbody></table></div>}
      {canClear?<><label className="import-confirm"><input type="checkbox" disabled={busy} checked={stopped} onChange={e=>setStopped(e.target.checked)}/>All markers have stopped editing these trial records and closed their test workspaces. Any unsynced drafts on their devices must be discarded.</label>
        <label className="trial-cleanup-phrase">Type <strong>{preview.confirmation}</strong> to permanently clear these records<input autoComplete="off" value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)}/></label>
        <div className="shared-form-actions"><button className="remove-test-button" disabled={busy||!stopped||confirmation!==preview.confirmation} onClick={clear}>Permanently clear trial data</button><button className="text-button" disabled={busy} onClick={reset}>Cancel cleanup</button></div>
      </>:<p>There are no records to remove with this selection.</p>}
    </section>}
  </details>;
}
