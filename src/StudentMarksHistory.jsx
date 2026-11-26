import React,{useEffect,useRef,useState} from "react";
import {featureRequest} from "./featureApi.js";
import {formatMark} from "./domain.js";

const PAGE_SIZE=25;
const time=value=>new Date(value).toLocaleString('en-GB',{timeZone:'Asia/Colombo'});
function Pages({page,total,busy,onChange,label}) {
  if(total<=PAGE_SIZE)return null;
  return <nav className="history-pagination" aria-label={label}>
    <button className="secondary-button" disabled={busy||page===0} onClick={()=>onChange(page-1)}>Previous</button>
    <span>Page {page+1} of {Math.ceil(total/PAGE_SIZE)}</span>
    <button className="secondary-button" disabled={busy||(page+1)*PAGE_SIZE>=total} onClick={()=>onChange(page+1)}>Next</button>
  </nav>;
}
function ScoreChanges({entry,onClose}) {
  const panel=useRef(null);
  useEffect(()=>{panel.current?.scrollIntoView({block:'start'});},[]);
  const [page,setPage]=useState(0),[data,setData]=useState(null),[busy,setBusy]=useState(true),[error,setError]=useState("");
  useEffect(()=>{
    let live=true;setBusy(true);setError("");setData(null);
    featureRequest('app_student_mark_changes',{p_enrolment_id:entry.enrolment_id,p_test_id:entry.test_id,p_limit:PAGE_SIZE,p_offset:page*PAGE_SIZE})
      .then(next=>{if(live){if(page>0&&page*PAGE_SIZE>=next.total){setPage(0);return;}setData(next);}})
      .catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setBusy(false);});
    return()=>{live=false;};
  },[entry.enrolment_id,entry.test_id,page]);
  return <section ref={panel} className="student-score-changes">
    <div className="panel-title-row"><h4>Score changes · {entry.exam_year} · {entry.phase} · Paper {entry.paper}</h4><button className="text-button" onClick={onClose}>Close score changes</button></div>
    {busy&&<p role="status">Loading score changes…</p>}{error&&<p className="alert" role="alert">{error}</p>}
    {data&&<>{data.entries.length?<div className="table-scroll"><table><thead><tr><th>Time (Sri Lanka)</th><th>Changed by</th><th>Action</th><th>Before</th><th>After</th></tr></thead><tbody>{data.entries.map(h=><tr key={h.id}><td>{time(h.created_at)}</td><td>{h.actor_name}</td><td>{h.action}</td><td>{h.before_cents==null?'—':formatMark(h.before_cents)}</td><td>{h.after_cents==null?'—':formatMark(h.after_cents)}</td></tr>)}</tbody></table></div>:<p>No saved score changes for this test.</p>}
      <Pages page={page} total={data.total} busy={busy} onChange={setPage} label="Score change pages"/>
    </>}
  </section>;
}
export default function StudentMarksHistory({record,group,onClose}) {
  const [linked,setLinked]=useState(false),[page,setPage]=useState(0),[refresh,setRefresh]=useState(0);
  const [data,setData]=useState(null),[busy,setBusy]=useState(true),[error,setError]=useState(""),[audit,setAudit]=useState(null);
  const panel=useRef(null);
  useEffect(()=>{panel.current?.scrollIntoView({block:'start'});},[]);
  useEffect(()=>{
    let live=true;setBusy(true);setError("");setData(null);setAudit(null);
    featureRequest('app_student_marks_history',{p_enrolment_id:record.id,p_include_linked_years:linked,p_limit:PAGE_SIZE,p_offset:page*PAGE_SIZE})
      .then(next=>{if(live){if(page>0&&page*PAGE_SIZE>=next.total){setPage(0);return;}setData(next);}})
      .catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setBusy(false);});
    return()=>{live=false;};
  },[record.id,linked,page,refresh]);
  return <section ref={panel} className="panel workspace-panel student-marks-history" aria-busy={busy} aria-labelledby="student-marks-history-heading">
    <div className="panel-title-row"><h3 id="student-marks-history-heading">Marks history · {data?.student.name||record.student?.name}</h3><button className="text-button" onClick={onClose}>Close marks history</button></div>
    <p>{record.student_code} · {group.exam_year}. Only server-saved marks are shown; unsynced drafts are excluded. A missing score is different from a recorded zero.</p>
    <div className="student-history-controls"><label className="import-confirm"><input type="checkbox" disabled={busy} checked={linked} onChange={e=>{setLinked(e.target.checked);setPage(0);}}/>Include linked exam years for this same student</label><button className="secondary-button" disabled={busy} onClick={()=>{setPage(0);setRefresh(v=>v+1);}}>Refresh history</button></div>
    {busy&&<p role="status">Loading marks history…</p>}{error&&<p className="alert" role="alert">{error}</p>}
    {data&&<>
      <p className="history-count">{data.total} test(s){data.enrolments.length>1?` across ${data.enrolments.map(e=>e.exam_year).join(', ')}`:''}{data.total?` · Showing ${page*PAGE_SIZE+1}–${Math.min((page+1)*PAGE_SIZE,data.total)}`:''}</p>
      {data.entries.length?<div className="table-scroll"><table><thead><tr><th>Exam year / ID</th><th>Test</th><th>Date</th><th>Marks</th><th>Source / marker</th><th>Test status</th>{data.is_admin&&<th>History</th>}</tr></thead><tbody>{data.entries.map(e=><tr key={`${e.enrolment_id}:${e.test_id}`}>
        <td>{e.exam_year}{e.is_archived?' · Archived':''}<small>{e.student_code}</small></td><td>{e.phase}<small>Paper {e.paper}</small></td><td>{e.test_date}</td>
        <td>{!e.has_score?'No entry':e.is_deleted?'Removed':`${formatMark(e.cents)} / ${formatMark(e.max_cents)}`}</td>
        <td>{e.has_score?e.source:'—'}<small>{e.has_score?(e.marker_name||(e.source==='Zero fill'?'Admin zero fill':'Online import')):''}</small></td>
        <td>{e.status}{e.status==='Cancelled'&&<small>Excluded from rankings</small>}</td>
        {data.is_admin&&<td><button className="text-button" disabled={!e.change_count} onClick={()=>setAudit(e)}>View changes ({e.change_count})</button></td>}
      </tr>)}</tbody></table></div>:<p>No tests found for this student’s selected exam year(s).</p>}
      <Pages page={page} total={data.total} busy={busy} onChange={setPage} label="Student marks history pages"/>
      {audit&&<ScoreChanges key={`${audit.enrolment_id}:${audit.test_id}`} entry={audit} onClose={()=>setAudit(null)}/>}
    </>}
  </section>;
}
