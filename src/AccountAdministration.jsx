import React,{useEffect,useRef,useState} from "react";
import {supabase} from "./lib/supabaseClient.js";
import {featureRequest} from "./featureApi.js";
import {inviteAccount} from "./accountAdminApi.js";

export default function AccountAdministration({profile,onChanged}){
 const [rows,setRows]=useState([]),[query,setQuery]=useState(""),[filter,setFilter]=useState(""),[editing,setEditing]=useState(null);
 const [name,setName]=useState(""),[email,setEmail]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [more,setMore]=useState(false);const invitation=useRef(null);
 const [invitations,setInvitations]=useState([]);
 async function load(append=false){setBusy(true);setError("");try{const [next,invites]=await Promise.all([featureRequest('app_list_accounts',{p_query:filter,p_offset:append?rows.length:0}),featureRequest('app_list_account_invitations',{})]);setRows(old=>append?[...old,...next]:next);setInvitations(invites);setMore(next.length===100);}catch(e){setError(e.message);}finally{setBusy(false);}}
 useEffect(()=>{load();},[filter]);
 async function invite(event){event.preventDefault();setBusy(true);setError("");setNotice("");
  const key=JSON.stringify([email.trim(),name.trim()]);if(invitation.current?.key!==key)invitation.current={key,id:crypto.randomUUID()};
  try{const result=await inviteAccount(supabase,{email:email.trim(),name:name.trim(),requestId:invitation.current.id});setNotice(result.message);if(result.status==='Sent'){setEmail("");setName("");invitation.current=null;}await load();onChanged();}catch(e){setError(e.message);}finally{setBusy(false);}
 }
 async function retryInvite(i){setBusy(true);setError("");try{const result=await inviteAccount(supabase,{email:i.email,name:i.display_name,requestId:i.request_id});setNotice(result.message);await load();onChanged();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <section className="shared-directory"><section className="panel"><h2>Invite a marker</h2><p>The new marker receives an email to set their password. Invitees start as active markers; an admin can change their role afterward.</p>
  <form className="shared-fields" onSubmit={invite}><label>Marker name<input required maxLength={100} value={name} disabled={busy} onChange={e=>setName(e.target.value)}/></label><label>Email<input required type="email" maxLength={254} value={email} disabled={busy} onChange={e=>setEmail(e.target.value)}/></label><button className="primary-button" disabled={busy}>Send invitation</button></form></section>
  {error&&<p className="alert" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
  {editing&&<AccountEditor key={editing.id} account={editing} self={editing.id===profile.id} onClose={()=>setEditing(null)} onSaved={async()=>{setEditing(null);setNotice("Account updated. Existing marks and history are preserved.");await load();onChanged();window.dispatchEvent(new Event('physics:profile-changed'));}}/>}
  <section className="panel"><h2>Accounts</h2><form className="shared-toolbar" onSubmit={e=>{e.preventDefault();setFilter(query.trim());}}><label>Name or email<input value={query} onChange={e=>setQuery(e.target.value)} maxLength={200}/></label><button className="secondary-button" disabled={busy}>Search</button><button type="button" className="text-button" disabled={busy} onClick={()=>load()}>Refresh accounts</button></form>
  <div className="table-scroll"><table><thead><tr><th>Name / email</th><th>Role</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map(a=><tr key={a.id}><td>{a.display_name}<small>{a.email}</small></td><td>{a.role}</td><td>{a.is_active?'Active':'Disabled'}</td><td><button className="text-button" disabled={busy||!!editing} onClick={()=>setEditing(a)}>Edit account</button></td></tr>)}</tbody></table></div>
  {!rows.length&&!busy&&<p>No matching accounts.</p>}{more&&<button className="secondary-button" disabled={busy} onClick={()=>load(true)}>Load more accounts</button>}</section>
  {!!invitations.length&&<details className="panel"><summary>Recent invitations</summary><p>Use Retry for an unfinished invitation. For a sent invitation whose email is missing, the marker can use Set or reset password on the sign-in screen.</p><ul>{invitations.map(i=><li key={i.request_id}>{i.display_name} · {i.email} · {i.status} · invited by {i.created_by}{i.status!=='Sent'&&<button className="text-button" disabled={busy} onClick={()=>retryInvite(i)}>Retry invitation</button>}</li>)}</ul></details>}
 </section>;
}
function AccountEditor({account,self,onClose,onSaved}){
 const [name,setName]=useState(account.display_name),[role,setRole]=useState(account.role),[active,setActive]=useState(account.is_active),[busy,setBusy]=useState(false),[error,setError]=useState("");const receipt=useRef(null);
 async function save(e){e.preventDefault();const args={p_profile_id:account.id,p_name:name.trim(),p_role:role,p_active:active,p_expected_version:account.version},key=JSON.stringify(args);if(receipt.current?.key!==key)receipt.current={key,id:crypto.randomUUID()};setBusy(true);setError("");try{await featureRequest('app_update_account',{...args,p_request_id:receipt.current.id});await onSaved();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <form className="panel shared-student-form" onSubmit={save}><h3>Edit account · {account.email}</h3><div className="shared-fields"><label>Display name<input required maxLength={100} value={name} disabled={busy} onChange={e=>setName(e.target.value)}/></label><label>Role<select value={role} disabled={busy||self} onChange={e=>setRole(e.target.value)}><option value="marker">Marker</option><option value="admin">Admin & marker</option></select></label><label className="import-confirm"><input type="checkbox" checked={active} disabled={busy||self} onChange={e=>setActive(e.target.checked)}/>Active account</label></div>
  {self&&<p>Another admin must change your own role or disable your account.</p>}<p>Disabling access keeps their work. Reassign any unfinished paper batch in Test workspace before closing its test.</p>{error&&<p className="alert" role="alert">{error}</p>}<div className="shared-form-actions"><button className="primary-button" disabled={busy}>Save account</button><button type="button" className="text-button" disabled={busy} onClick={onClose}>Cancel</button></div></form>;
}
