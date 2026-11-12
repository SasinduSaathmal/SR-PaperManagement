import React,{useMemo,useRef,useState} from "react";
import {featureRequest} from "./featureApi.js";
import {schoolKey,similarSchools} from "./schoolNames.js";

export default function SchoolManagement({schools,onClose,onSaved}) {
  const [targetId,setTargetId]=useState(""),[selected,setSelected]=useState([]),[name,setName]=useState("");
  const [query,setQuery]=useState(""),[reason,setReason]=useState(""),[phrase,setPhrase]=useState("");
  const [preview,setPreview]=useState(null),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const receipt=useRef(null);const target=schools.find(s=>s.id===targetId);
  const matches=schools.filter(s=>[s.name,...(s.aliases||[])].some(n=>schoolKey(n).includes(schoolKey(query))));
  const suggestions=useMemo(()=>target?similarSchools(target,schools):[],[target,schools]);
  function reset(){setPreview(null);setConfirmed(false);setPhrase("");receipt.current=null;setError("");}
  function choose(id){const school=schools.find(s=>s.id===id);setTargetId(id);setName(school?.name||"");setSelected(id?[id]:[]);reset();}
  function toggle(id,checked){setSelected(ids=>checked?[...new Set([...ids,id])]:ids.filter(x=>x!==id));reset();}
  async function review(){
    setBusy(true);reset();
    try{setPreview(await featureRequest('app_preview_school_merge',{p_school_ids:[...selected].sort(),p_target_id:targetId,p_name:name.trim()}));}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function save(e){
    e.preventDefault();setBusy(true);setError("");
    const args={p_school_ids:[...selected].sort(),p_target_id:targetId,p_name:name.trim(),p_reason:reason.trim(),p_expected_fingerprint:preview.fingerprint,p_confirmation:phrase};
    const key=JSON.stringify(args);if(receipt.current?.key!==key)receipt.current={key,id:crypto.randomUUID()};
    try{const result=await featureRequest('app_merge_schools',{...args,p_request_id:receipt.current.id});onSaved(result);}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <section className="panel workspace-panel school-management" aria-busy={busy}>
    <div className="panel-title-row"><h3>Standardize school names</h3><button className="text-button" disabled={busy} onClick={onClose}>Close school management</button></div>
    <p>Choose one school record to keep, then select the other spellings that refer to that same school. This applies across exam years. Similar names are suggestions for your review.</p>
    <div className="shared-fields"><label>School record to keep<select disabled={busy} value={targetId} onChange={e=>choose(e.target.value)}><option value="">Choose a school</option>{schools.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Standard display name<input required maxLength={200} disabled={busy||!target} value={name} onChange={e=>{setName(e.target.value);reset();}}/></label></div>
    {target&&<>
      {!!suggestions.length&&<div className="school-suggestions"><h4>Possible variants to review</h4><p className="field-help">Check the school and its students before adding a suggestion.</p><div className="shared-form-actions">{suggestions.map(s=><button type="button" className="secondary-button" key={s.id} disabled={busy||selected.includes(s.id)} onClick={()=>toggle(s.id,true)}>{selected.includes(s.id)?'Selected: ':'Add: '}{s.name}</button>)}</div></div>}
      <label className="school-search">Search names or earlier spellings<input disabled={busy} value={query} maxLength={200} onChange={e=>setQuery(e.target.value)} placeholder="Type part of a school name"/></label>
      <div className="table-scroll school-list"><table><thead><tr><th>Select</th><th>School name / earlier spellings</th><th>Students</th><th>Exam years</th></tr></thead><tbody>{matches.slice(0,100).map(s=><tr key={s.id}><td><input type="checkbox" aria-label={`Include ${s.name}`} checked={selected.includes(s.id)} disabled={busy||s.id===targetId} onChange={e=>toggle(s.id,e.target.checked)}/></td><td><strong>{s.name}</strong>{s.id===targetId&&<small>School record to keep</small>}{!!s.aliases?.length&&<small>Earlier names: {s.aliases.join('; ')}</small>}</td><td>{s.students??'—'}</td><td>{s.years?.join(', ')||'—'}</td></tr>)}</tbody></table></div>
      {matches.length>100&&<p className="field-help">Showing the first 100 matches. Search to narrow the list.</p>}
      <p>{selected.length} school record(s) selected. {selected.map(id=>schools.find(s=>s.id===id)?.name).filter(Boolean).join(' · ')}</p>
      <button type="button" className="secondary-button" disabled={busy||!name.trim()||(selected.length===1&&name.trim()===target.name)} onClick={review}>Review school change</button>
    </>}
    {error&&<p className="alert" role="alert">{error}</p>}
    {preview&&<form onSubmit={save} className="school-merge-review">
      <h4>Use “{preview.name}” for {preview.students} student record(s)</h4>
      <div className="school-review-grid">{preview.schools.map(s=><section key={s.id}><strong>{s.name}</strong><p>{s.students} student record(s)</p>{!!s.samples.length&&<ul>{s.samples.map(e=><li key={`${e.exam_year}-${e.student_code}`}>{e.name} · {e.student_code} · {e.exam_year}</li>)}</ul>}</section>)}</div>
      <p>Marks and student IDs stay attached to their students. Earlier school spellings become recognized aliases for future entries and imports. Saved report snapshots keep their original labels; generate new report versions for the standardized names.</p>
      <div className="shared-fields"><label>Reason<input required maxLength={500} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)}/></label><label>Type MERGE SCHOOLS<input required autoComplete="off" disabled={busy} value={phrase} onChange={e=>setPhrase(e.target.value)}/></label></div>
      <label className="import-confirm"><input type="checkbox" disabled={busy} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I checked that these records refer to the same school.</label>
      <div className="shared-form-actions"><button className="primary-button" disabled={busy||!confirmed||phrase!=='MERGE SCHOOLS'||!reason.trim()}>{busy?'Saving…':'Save standard school name'}</button><button type="button" className="text-button" disabled={busy} onClick={reset}>Cancel school change</button></div>
    </form>}
  </section>;
}
