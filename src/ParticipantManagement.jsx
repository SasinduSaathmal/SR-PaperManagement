import React,{useEffect,useRef,useState} from "react";
import {featureRequest} from "./featureApi.js";

export default function ParticipantManagement({snapshot,profiles,blocked,onSaved}){
 const [add,setAdd]=useState(""),[remove,setRemove]=useState(""),[recipient,setRecipient]=useState(""),[confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");const receipt=useRef(null);
 useEffect(()=>{setConfirmed(false);},[snapshot.test.revision]);
 const editable=snapshot.test.status==='Open'&&!snapshot.group.is_archived&&!blocked;
 const candidates=profiles.filter(p=>p.is_active&&!snapshot.participants.some(v=>v.marker_id===p.id));
 const removed=snapshot.participants.find(p=>p.marker_id===remove),rows=snapshot.scores.filter(s=>s.marker_id===remove&&s.source==='Paper');
 const targets=snapshot.participants.filter(p=>p.is_active&&p.marker_id!==remove);
 async function act(action){setBusy(true);setError("");setNotice("");const args={p_test_id:snapshot.test.id,p_action:action,p_marker_id:action==='add'?add:remove,p_transfer_to:action==='remove'&&rows.length?recipient:null,p_expected_revision:snapshot.test.revision},key=JSON.stringify(args);if(receipt.current?.key!==key)receipt.current={key,id:crypto.randomUUID()};
  try{const r=await featureRequest('app_manage_test_participant',{...args,p_request_id:receipt.current.id});setNotice(action==='add'?'Participant added. Their latest batch must be submitted.':`Participant removed. ${r.transferred} score record(s) reassigned; the receiving marker must review and submit.`);setAdd("");setRemove("");setRecipient("");setConfirmed(false);receipt.current=null;await onSaved();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <details className="panel"><summary>Manage test participants</summary><p>Changes require an open test and no local drafts waiting to sync. Ask affected markers to stop editing before reassigning a batch.</p>
  <div className="shared-toolbar"><label>Add participant<select value={add} disabled={!editable||busy} onChange={e=>setAdd(e.target.value)}><option value="">Choose account</option>{candidates.map(p=><option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label><button className="secondary-button" disabled={!editable||busy||!add} onClick={()=>act('add')}>Add participant</button></div>
  <div className="shared-fields"><label>Remove participant<select value={remove} disabled={!editable||busy} onChange={e=>{setRemove(e.target.value);setRecipient("");setConfirmed(false);}}><option value="">Choose participant</option>{snapshot.participants.map(p=><option key={p.marker_id} value={p.marker_id}>{p.name}{p.is_active?'':' · Disabled'}</option>)}</select></label>
  {!!rows.length&&<label>Reassign all paper entries to<select value={recipient} disabled={!editable||busy} onChange={e=>{setRecipient(e.target.value);setConfirmed(false);}}><option value="">Choose active participant</option>{targets.map(p=><option key={p.marker_id} value={p.marker_id}>{p.name}</option>)}</select></label>}</div>
  {removed&&<><p>{removed.name} has {rows.length} paper score record(s), including removed entries. Original marking attribution and score history will remain. The receiving marker's earlier submission will require resubmission.</p><label className="import-confirm"><input type="checkbox" disabled={!editable||busy} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I checked the participant and reassignment.</label><button className="remove-test-button" disabled={!editable||busy||!confirmed||(rows.length>0&&!recipient)||snapshot.participants.length<2} onClick={()=>act('remove')}>Remove participant{rows.length?' and reassign batch':''}</button></>}
  {error&&<p className="alert" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
 </details>;
}
