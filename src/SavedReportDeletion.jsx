import React,{useEffect,useRef,useState} from "react";
import {featureRequest} from "./featureApi.js";

export default function SavedReportDeletion({report,onClose,onSaved}) {
  const [snapshot,setSnapshot]=useState(null),[confirmed,setConfirmed]=useState(false);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const request=useRef(crypto.randomUUID()),panel=useRef(null);
  useEffect(()=>{panel.current?.scrollIntoView({block:'start'});},[]);
  useEffect(()=>{
    let live=true;
    featureRequest('app_get_report',{p_report_id:report.id}).then(data=>{
      if(!live)return;
      if(data.id!==report.id||data.version!==report.version)throw Error('Report changed. Refresh and review it again.');
      setSnapshot(data);
    }).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[report.id,report.version]);
  async function remove(e){
    e.preventDefault();setBusy(true);setError("");
    try{
      await featureRequest('app_delete_saved_report',{p_report_id:report.id,p_expected_version:report.version,p_expected_created_at:report.created_at,p_confirmed:confirmed,p_request_id:request.current});
      onSaved(report);
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <section ref={panel} className="panel workspace-panel saved-report-deletion" aria-busy={loading||busy} aria-labelledby="delete-report-heading">
    <div className="panel-title-row"><h3 id="delete-report-heading">Delete saved report</h3><button className="text-button" disabled={busy} onClick={onClose}>Cancel deletion</button></div>
    <p><strong>{report.title} · Version {report.version}</strong><br/>{report.is_final?'Final':'Provisional'} · Created {new Date(report.created_at).toLocaleString('en-GB',{timeZone:'Asia/Colombo'})}</p>
    {loading&&<p role="status">Loading report details…</p>}
    {snapshot&&<>
      <p>{snapshot.exam_year} · {snapshot.tests.length} test(s) · {snapshot.rows.length} student row(s) across Maths and Bio</p>
      <p>This permanently deletes this saved version and its snapshot from the database. Its PDF and Excel downloads will no longer be available. Original tests, marks and other report versions are kept. Files already downloaded to a device are separate copies.</p>
      <form onSubmit={remove}>
        <label className="import-confirm"><input type="checkbox" disabled={busy} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I reviewed this report version and understand that deletion cannot be undone in the website.</label>
        <div className="shared-form-actions"><button className="remove-test-button" disabled={busy||!confirmed}>{busy?'Deleting…':'Permanently delete report'}</button><button type="button" className="text-button" disabled={busy} onClick={onClose}>Cancel deletion</button></div>
      </form>
    </>}
    {error&&<p className="alert" role="alert">{error}</p>}
  </section>;
}
