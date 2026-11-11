const json=(value,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
export function createWorker(fetcher=globalThis.fetch){return {async fetch(request,env){
 const url=new URL(request.url);
 if(!url.pathname.startsWith("/api/"))return env.ASSETS.fetch(request);
 if(url.pathname!=="/api/admin/invite")return json({error:"API route not found."},404);
 if(request.method!=="POST")return json({error:"Use POST."},405);
 if(request.headers.get("Origin")&&request.headers.get("Origin")!==url.origin)return json({error:"Use the website to invite accounts."},403);
 const token=request.headers.get("Authorization");
 if(!/^Bearer \S+$/.test(token||""))return json({error:"Sign in as an admin."},401);
 const base=String(env.SUPABASE_URL||"").replace(/\/$/,""),key=env.SUPABASE_SECRET_KEY;
 if(!base.startsWith("https://")||!key)return json({error:"Account invitations are not configured yet. Complete the hosting setup."},503);
 const privileged={apikey:key,...(key.startsWith("sb_secret_")?{}:{Authorization:`Bearer ${key}`}),"Content-Type":"application/json"};
 const call=async(path,options={})=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);try{return await fetcher(base+path,{...options,headers:{...privileged,...options.headers},signal:controller.signal});}finally{clearTimeout(timer);}};
 let reserved=false,requestId;
 const finish=sent=>call('/rest/v1/rpc/app_finish_account_invite',{method:"POST",body:JSON.stringify({p_request_id:requestId,p_sent:sent})});
 try{
  const auth=await call('/auth/v1/user',{headers:{Authorization:token}});
  if(!auth.ok)return json({error:"Your session expired. Sign in again."},401);
  const user=await auth.json();if(!user?.id)return json({error:"Sign in again."},401);
  const member=await call(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role,is_active`);
  if(!member.ok)return json({error:"Could not verify account access."},503);
  const profiles=await member.json();if(profiles.length!==1||profiles[0].role!=="admin"||!profiles[0].is_active)return json({error:"Only active admins can invite accounts."},403);
  if(Number(request.headers.get('Content-Length'))>4096)return json({error:"Invitation is too large."},413);
  const raw=await request.text();if(raw.length>4096)return json({error:"Invitation is too large."},413);
  let body;try{body=JSON.parse(raw);}catch{return json({error:"Invalid invitation."},400);}
  if(typeof body.email!=="string"||typeof body.name!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId||""))return json({error:"Enter an email, name and valid invitation request."},400);
  requestId=body.requestId;
  const prepared=await call('/rest/v1/rpc/app_begin_account_invite',{method:"POST",body:JSON.stringify({p_actor_id:user.id,p_email:body.email,p_name:body.name,p_request_id:requestId})});
  const data=await prepared.json();if(!prepared.ok)return json({error:data.message||"Could not prepare invitation."},400);
  if(!data.send)return json({status:data.status,message:data.status==="Sent"?"Invitation already created. Refresh accounts; the marker can request a password link if needed.":"Invitation is being processed. Wait a moment, then retry the same request."},data.status==="Sent"?200:202);
  reserved=true;
  const redirect=encodeURIComponent(`${url.origin}/?auth=setup`);
  const invited=await call(`/auth/v1/invite?redirect_to=${redirect}`,{method:"POST",body:JSON.stringify({email:data.email,data:{display_name:data.display_name}})});
  if(!invited.ok){await finish(false);reserved=false;return json({error:"Invitation could not be sent. Check the email, Supabase email delivery settings and account list, then retry."},502);}
  const saved=await finish(true);reserved=false;
  if(!saved.ok)return json({error:"The invitation may have been sent. Retry the same request and refresh accounts to check."},502);
  return json({status:"Sent",message:"Invitation sent. The marker should open the email and set their password."});
 }catch{
  if(reserved){try{await finish(false);}catch{/* Retry uses the reservation to avoid duplicate accounts. */}}
  return json({error:"The invitation service could not be reached. Retry the same request and refresh accounts to check."},502);
 }
}};}
export default createWorker();
