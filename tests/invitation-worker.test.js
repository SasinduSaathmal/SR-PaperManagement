import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../worker/index.js';
import {inviteAccount} from '../src/accountAdminApi.js';

const actor='00000000-0000-0000-0000-000000000001',requestId='00000000-0000-4000-8000-000000000002';
const env={SUPABASE_URL:'https://project.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test_server_only',ASSETS:{fetch:async()=>new Response('static asset')}};
const request=(body={email:'marker@school.test',name:'Marker',requestId},headers={})=>new Request('https://marks.example/api/admin/invite',{method:'POST',headers:{Authorization:'Bearer user-jwt',Origin:'https://marks.example','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
function upstream(options={}){
 const calls=[];
 const fetcher=async(url,init)=>{
  calls.push({url,init});const path=new URL(url).pathname;
  if(path==='/auth/v1/user')return Response.json(options.authFailed?{error:'bad token'}:{id:actor},{status:options.authFailed?401:200});
  if(path==='/rest/v1/profiles')return Response.json([{role:options.marker?'marker':'admin',is_active:!options.disabled}]);
  if(path.endsWith('app_begin_account_invite'))return Response.json(options.duplicate?{send:false,status:options.duplicate}:{send:true,email:'marker@school.test',display_name:'Approved name'});
  if(path==='/auth/v1/invite'){
   if(options.throwInvite)throw Error('upstream private credentials should never reach the client');
   return Response.json(options.inviteFailed?{error:'smtp private details'}:{id:'invited'},{status:options.inviteFailed?500:200});
  }
  if(path.endsWith('app_finish_account_invite'))return new Response(null,{status:204});
  throw Error('Unexpected request: '+url);
 };
 return {calls,worker:createWorker(fetcher)};
}
test('invitation endpoint verifies the current admin, uses server-only keys and fixes its redirect',async()=>{
 const {calls,worker}=upstream();const response=await worker.fetch(request(),env);assert.equal(response.status,200);assert.equal((await response.json()).status,'Sent');assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.equal(calls[0].init.headers.Authorization,'Bearer user-jwt');assert.equal(calls[0].init.headers.apikey,env.SUPABASE_SECRET_KEY);
 const reserve=calls.find(c=>c.url.includes('app_begin_account_invite'));assert.equal(JSON.parse(reserve.init.body).p_actor_id,actor);assert.equal(reserve.init.headers.Authorization,undefined);
 const invite=calls.find(c=>new URL(c.url).pathname==='/auth/v1/invite');assert.equal(invite.init.headers.Authorization,undefined);assert.equal(invite.init.headers.apikey,env.SUPABASE_SECRET_KEY);assert.equal(new URL(invite.url).searchParams.get('redirect_to'),'https://marks.example/?auth=setup');assert.deepEqual(JSON.parse(invite.init.body),{email:'marker@school.test',data:{display_name:'Approved name'}});
 assert.equal(JSON.parse(calls.at(-1).init.body).p_sent,true);
 const legacy=upstream();await legacy.worker.fetch(request(),{...env,SUPABASE_SECRET_KEY:'legacy-service-jwt'});assert.equal(legacy.calls.find(c=>c.url.includes('app_begin')).init.headers.Authorization,'Bearer legacy-service-jwt');
});
test('invalid sessions, markers, disabled accounts, cross-origin requests and malformed input cannot send invites',async()=>{
 for(const options of [{authFailed:true},{marker:true},{disabled:true}]){
  const {calls,worker}=upstream(options);const response=await worker.fetch(request(),env);assert.ok([401,403].includes(response.status));assert.ok(!calls.some(c=>c.url.includes('/invite')));
 }
 const {worker,calls}=upstream();assert.equal((await worker.fetch(request({}, {Origin:'https://attacker.example'}),env)).status,403);assert.equal(calls.length,0);
 assert.equal((await worker.fetch(request({}, {Authorization:''}),env)).status,401);assert.equal((await worker.fetch(request(),{...env,SUPABASE_SECRET_KEY:''})).status,503);
 assert.equal((await worker.fetch(request({email:'a',name:'b',requestId:'bad'}),env)).status,400);
 assert.equal((await worker.fetch(request({email:'a',name:'x'.repeat(5000),requestId}),env)).status,413);
 assert.equal((await worker.fetch(new Request('https://marks.example/api/admin/invite'),env)).status,405);
 assert.equal((await worker.fetch(new Request('https://marks.example/api/unknown'),env)).status,404);
 assert.equal(await (await worker.fetch(new Request('https://marks.example/'),env)).text(),'static asset');
});
test('duplicate requests avoid repeat email, failures remain retryable and never expose upstream secrets',async()=>{
 for(const status of ['Sent','Sending']){
  const {worker,calls}=upstream({duplicate:status});const response=await worker.fetch(request(),env);assert.equal(response.status,status==='Sent'?200:202);assert.ok(!calls.some(c=>new URL(c.url).pathname==='/auth/v1/invite'));
 }
 for(const options of [{inviteFailed:true},{throwInvite:true}]){
  const {worker,calls}=upstream(options);const response=await worker.fetch(request(),env);assert.equal(response.status,502);const body=await response.text();assert.ok(!body.includes('private'));assert.ok(!body.includes(env.SUPABASE_SECRET_KEY));assert.equal(JSON.parse(calls.at(-1).init.body).p_sent,false);
 }
});
test('browser invitation calls carry only the signed-in user token and handle unavailable APIs',async()=>{
 const client={auth:{getSession:async()=>({data:{session:{access_token:'user-token'}}})}};
 let sent;await inviteAccount(client,{email:'marker@school.test',name:'Marker',requestId},async(url,init)=>{sent={url,init};return Response.json({status:'Sent'});});assert.equal(sent.url,'/api/admin/invite');assert.equal(sent.init.headers.Authorization,'Bearer user-token');assert.equal(sent.init.headers.apikey,undefined);
 await assert.rejects(()=>inviteAccount(client,{},async()=>new Response('<html>Unavailable</html>',{status:503})),/service is unavailable/);
 await assert.rejects(()=>inviteAccount({auth:{getSession:async()=>({data:{session:null}})}},{}),/Sign in again/);
});
