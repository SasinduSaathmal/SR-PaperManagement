import React,{useRef,useState} from "react";
import {featureRequest} from "./featureApi.js";

export default function StudentIdentity({mode,record,group,schools,onClose,onSaved}){
 const [official,setOfficial]=useState(""),[reason,setReason]=useState(""),[confirmed,setConfirmed]=useState(false);
 const [query,setQuery]=useState(""),[results,setResults]=useState([]),[source,setSource]=useState(null);
 const [school,setSchool]=useState(""),[stream,setStream]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const receipt=useRef(null);
 async function search(e){e.preventDefault();setBusy(true);setError("");setSource(null);setConfirmed(false);try{const all=await featureRequest('app_search_student_identities',{p_query:query.trim()});setResults(all.filter(r=>r.exam_year<group.exam_year));}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function save(e){e.preventDefault();setBusy(true);setError("");
  const args=mode==='replace'?{p_enrolment_id:record.id,p_official_id:official.trim(),p_expected_version:record.version,p_reason:reason.trim()}:
   {p_group_id:group.id,p_source_enrolment_id:source.id,p_target_enrolment_id:record?.id||null,p_official_id:record?null:official.trim(),p_school:record?null:school.trim(),p_stream:record?null:stream,p_expected_target_version:record?.version??null,p_expected_source_student_version:source.student_version,p_expected_source_person_id:source.student_id,p_reason:reason.trim(),p_confirmed:confirmed};
  const key=JSON.stringify(args);if(receipt.current?.key!==key)receipt.current={key,id:crypto.randomUUID()};
  try{const result=await featureRequest(mode==='replace'?'app_replace_temporary_id':'app_link_returning_student',{...args,p_request_id:receipt.current.id});onSaved(result.student_code);}catch(e){setError(e.message);}finally{setBusy(false);}
 }
 return <section className="panel shared-student-form"><h3>{mode==='replace'?'Replace temporary ID':record?'Link returning student':'Add returning student'} · {group.exam_year}</h3>
  {record&&<p>{record.student.name} · {record.student_code} · {record.school.name} · {record.stream}</p>}
  {mode==='replace'?<p>The original temporary ID will remain searchable. Saved marks and report versions are preserved. An ID already used by another student must be reviewed separately.</p>:<><p>Find an earlier enrolment and verify the identity yourself. Matching names do not automatically link students. An archived earlier year can be used without changing its records.</p>
   <form className="shared-toolbar" onSubmit={search}><label>Earlier name or full ID<input required minLength={2} maxLength={100} disabled={busy} value={query} onChange={e=>setQuery(e.target.value)}/></label><button className="secondary-button" disabled={busy}>Search earlier years</button></form>
   {!!results.length&&<div className="table-scroll"><table><thead><tr><th>Name / ID</th><th>Year</th><th>School / stream</th><th>Select</th></tr></thead><tbody>{results.map(r=><tr key={r.id}><td>{r.name}<small>{r.student_code}</small></td><td>{r.exam_year}{r.is_archived?' · Archived':''}</td><td>{r.school}<small>{r.stream}{r.is_active?'':' · Inactive'}</small></td><td><button className="secondary-button" disabled={busy} onClick={()=>{setSource(r);setSchool(r.school);setStream(r.stream);setConfirmed(false);}}>{source?.id===r.id?'Selected':'Choose student'}</button></td></tr>)}</tbody></table></div>}
   {query&&results.length===0&&!busy&&<p>No earlier enrolments shown. Search using a full ID or a more specific name.</p>}
   {source&&<p>Selected: <strong>{source.name}</strong> · {source.student_code}. {record?`This year's record will use this person's name and keep its existing school, stream, ID and marks.`:`The new enrolment will be linked to this person.`}</p>}
  </>}
  <form onSubmit={save}><div className="shared-fields">
   {(mode==='replace'||!record)&&<label>{mode==='replace'?'New official ID or number':'New-year official ID or number (optional)'}<input required={mode==='replace'} maxLength={100} disabled={busy} placeholder={`SC/${group.exam_year}/6900`} value={official} onChange={e=>setOfficial(e.target.value)}/>{mode!=='replace'&&<small>Leave blank to generate a temporary ID for this year.</small>}</label>}
   {mode!=='replace'&&!record&&<><label>School<input list="returning-schools" required maxLength={200} value={school} disabled={busy} onChange={e=>setSchool(e.target.value)}/><datalist id="returning-schools">{schools.map(s=><option key={s.id} value={s.name}/>)}</datalist></label><label>Stream<select required disabled={busy} value={stream} onChange={e=>setStream(e.target.value)}><option value="">Choose stream</option><option>Maths</option><option>Bio</option></select></label></>}
   <label>Reason<input required maxLength={500} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)}/></label></div>
   {mode!=='replace'&&<label className="import-confirm"><input type="checkbox" disabled={busy||!source} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I checked that these enrolments belong to the same person.</label>}
   {error&&<p className="alert" role="alert">{error}</p>}<div className="shared-form-actions"><button className="primary-button" disabled={busy||(mode!=='replace'&&(!source||!confirmed))}>{busy?'Saving…':mode==='replace'?'Replace ID':'Confirm returning student'}</button><button type="button" className="text-button" disabled={busy} onClick={onClose}>Cancel</button></div>
  </form>
 </section>;
}
