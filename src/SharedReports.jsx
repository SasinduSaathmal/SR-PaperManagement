import React, { useEffect, useRef, useState } from "react";
import { featureRequest } from "./featureApi.js";
import { reportColumns, reportRows, downloadReport } from "./reportExport.js";

export default function SharedReports({ group, tests, profile, pendingDrafts }) {
  const [ids,setIds]=useState([]),[title,setTitle]=useState("Physics - Samitha Rathnayake"),[layout,setLayout]=useState("both"),[includeIds,setIncludeIds]=useState(false),[top,setTop]=useState("10");
  const [reports,setReports]=useState([]),[selected,setSelected]=useState(null),[stream,setStream]=useState("Maths"),[viewLayout,setViewLayout]=useState("detailed");
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");const receipt=useRef(null);
  const admin=profile.role==="admin";
  useEffect(()=>{setIds(previous=>previous.filter(id=>tests.some(t=>t.id===id&&t.status!=="Cancelled")));},[tests]);
  async function refresh(){try{setReports(await featureRequest("app_list_reports",{p_group_id:group.id}));setError("");}catch(e){setError(e.message);}}
  useEffect(()=>{let cancelled=false;setReports([]);setSelected(null);setIds([]);setError("");receipt.current=null;
    featureRequest("app_list_reports",{p_group_id:group.id}).then(r=>{if(!cancelled)setReports(r);}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[group.id]);
  const chosen=ids.map(id=>tests.find(t=>t.id===id)).filter(Boolean), provisional=chosen.some(t=>t.status!=="Closed");
  async function generate(){setBusy(true);setError("");setNotice("");
    const args={p_group_id:group.id,p_test_ids:ids,p_title:title.trim(),p_layout:layout,p_include_ids:includeIds,p_top_n:Number(top)};const fingerprint=JSON.stringify(args);
    if(receipt.current?.fingerprint!==fingerprint)receipt.current={fingerprint,id:crypto.randomUUID()};
    try{const id=await featureRequest("app_generate_report",{...args,p_request_id:receipt.current.id});setSelected(await featureRequest("app_get_report",{p_report_id:id}));await refresh();setNotice("Saved a new report version. Later corrections will not alter this report.");receipt.current=null;}
    catch(e){setError(e.message);}finally{setBusy(false);}}
  async function openReport(id,format,downloadStream){setBusy(true);setError("");try{const report=await featureRequest("app_get_report",{p_report_id:id});setSelected(report);if(format)await downloadReport(report,format,downloadStream);}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <section className="reports-workspace">
    {error&&<p className="alert" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
    {admin&&<section className="panel workspace-panel"><h3>Generate a saved report</h3><p>Select one or more tests in the order their scores should appear. Totals add raw marks; Maths and Bio are ranked separately.</p>
      <fieldset disabled={busy} className="report-test-list"><legend>Tests in {group.exam_year}</legend>{tests.filter(t=>t.status!=="Cancelled").map(t=><label key={t.id}><input type="checkbox" checked={ids.includes(t.id)} onChange={e=>setIds(list=>e.target.checked?[...list,t.id]:list.filter(id=>id!==t.id))}/>{t.phase} · Paper {t.paper} · {t.status}{ids.includes(t.id)?` · Column ${ids.indexOf(t.id)+1}`:""}</label>)}</fieldset>
      <div className="shared-fields"><label>Report name<input value={title} maxLength={200} disabled={busy} onChange={e=>setTitle(e.target.value)}/></label><label>Layout<select value={layout} disabled={busy} onChange={e=>setLayout(e.target.value)}><option value="both">Detailed and summary</option><option value="detailed">Detailed</option><option value="summary">Summary</option></select></label>
        <label>List<select value={top==="0"?"full":"top"} disabled={busy} onChange={e=>setTop(e.target.value==="full"?"0":"10")}><option value="top">Top N (including ties)</option><option value="full">Full list</option></select></label>{top!=="0"&&<label>Top N<input type="number" min="1" max="1000" value={top} disabled={busy} onChange={e=>setTop(e.target.value)}/></label>}
        <label className="check-field"><input type="checkbox" checked={includeIds} disabled={busy} onChange={e=>setIncludeIds(e.target.checked)}/>Include student IDs</label></div>
      {pendingDrafts>0&&<p className="readonly-note">There are {pendingDrafts} unsynced local drafts. Reports include server-saved marks only.</p>}
      <p>{ids.length?`${provisional?"Provisional: at least one test is open":"Final: all selected tests are closed"}. Maximum total: ${chosen.reduce((sum,t)=>sum+t.max_cents,0)/100}.`:"Choose tests to generate a report."}</p>
      <button className="primary-button" disabled={busy||!ids.length||ids.length>30||!title.trim()||!Number.isInteger(Number(top))||Number(top)<0||Number(top)>1000||top===""} onClick={generate}>{busy?"Please wait…":"Generate and save report"}</button>
    </section>}
    <section className="panel workspace-panel"><div className="panel-title-row"><h3>Saved report versions</h3><button className="secondary-button" disabled={busy} onClick={refresh}>Refresh reports</button></div>
      {!admin&&<p>Final reports remain available here even when a source test is reopened.</p>}
      {!reports.length&&<p>No accessible reports in this exam group yet.</p>}
      <div className="table-scroll"><table><thead><tr><th>Version / name</th><th>Status</th><th>Generated</th><th>Downloads</th></tr></thead><tbody>{reports.map(r=><tr key={r.id}><td><strong>v{r.version} · {r.title}</strong><small>{r.creator}</small>{r.changed&&<small className="field-error">Test reopened - results may have changed. This saved version is unchanged.</small>}</td><td>{r.is_final?"Final":"Provisional"}</td><td>{new Date(r.created_at).toLocaleString("en-GB",{timeZone:"Asia/Colombo"})}</td><td><div className="shared-form-actions"><button className="text-button" disabled={busy} onClick={()=>openReport(r.id)}>View</button><button className="secondary-button" disabled={busy} onClick={()=>openReport(r.id,"xlsx")}>Excel</button><button className="secondary-button" disabled={busy} onClick={()=>openReport(r.id,"pdf","Maths")}>Maths PDF</button><button className="secondary-button" disabled={busy} onClick={()=>openReport(r.id,"pdf","Bio")}>Bio PDF</button></div></td></tr>)}</tbody></table></div>
    </section>
    {selected&&<section className="panel workspace-panel"><h3>{selected.title} · v{selected.version}</h3><p>{selected.is_final?"Final":"Provisional"} · {selected.exam_year} · Maximum total {selected.max_cents/100}</p>
      {selected.source_changed&&<p className="readonly-note">Test reopened - results may have changed. The scores below are the saved snapshot.</p>}
      <div className="shared-form-actions"><label>Stream<select value={stream} onChange={e=>setStream(e.target.value)}><option>Maths</option><option>Bio</option></select></label><label>View<select value={viewLayout} onChange={e=>setViewLayout(e.target.value)}><option value="detailed">Detailed</option><option value="summary">Summary</option></select></label></div>
      <p>Tests: {selected.tests.map(t=>`${t.phase} Paper ${t.paper}`).join("; ")}. A dash contributes zero; a recorded zero counts as participation.</p>
      <div className="table-scroll"><table><thead><tr>{reportColumns(selected,viewLayout).map((h,i)=><th key={i}>{h}</th>)}</tr></thead><tbody>{reportRows(selected,stream,viewLayout).map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>
    </section>}
  </section>;
}
