import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,admin,otherAdmin,marker,second} from './adminFixture.js';
import {searchDirectory,searchMarksStudents} from '../src/studentsApi.js';

test('temporary ID replacement and confirmed repeater links preserve marks, aliases, archives and reports',async()=>{
 const {db,rpc,group,uid,add,create}=await fixture();
 try{
  const old=await add(2027,'Earlier name'),existing=await add(2028,'Current spelling','88'),duplicate=await add(2027,'Other student','7');
  const tOld=await create(2027),tNew=await create(2028);
  await rpc("app_save_test_score($1,$2,'12',0,$3)",[tOld,old,crypto.randomUUID()]);await rpc("app_save_test_score($1,$2,'20',0,$3)",[tNew,existing,crypto.randomUUID()]);
  const report=await rpc("app_generate_report($1,$2,'Original report','both',true,0,$3)",[group(2027),[tOld],crypto.randomUUID()]),snapshot=await rpc('app_get_report($1)',[report]);
  const replace=(code='6',version=1,request=crypto.randomUUID())=>rpc("app_replace_temporary_id($1,$2,$3,'Verified official ID',$4)",[old,code,version,request]);
  await uid(marker);await assert.rejects(()=>replace(),/Only active admins/);await assert.rejects(()=>rpc("app_search_student_identities('Earlier')"),/Only active admins/);await uid(admin);
  await assert.rejects(()=>replace('7'),/already belongs/);await assert.rejects(()=>replace('SC/2028/6'),/matching this group/);await assert.rejects(()=>replace('6',99),/Student changed/);
  const replaceReq=crypto.randomUUID(),saved=await replace('0006',1,replaceReq);assert.equal(saved.student_code,'SC/2027/6');assert.deepEqual(await replace('0006',1,replaceReq),saved);
  assert.equal((await rpc('app_get_test_workspace($1)',[tOld])).scores[0].cents,1200);assert.deepEqual((await rpc('app_get_report($1)',[report])).rows,snapshot.rows);
  await assert.rejects(()=>replace('9',2),/already has an official/);
  const found=await rpc("app_search_student_identities('TEMP/SC/2027/000001')");assert.equal(found[0].id,old);await assert.rejects(()=>rpc("app_search_student_identities('000001')"),/full SC/);
  const source=found[0],linkReq=crypto.randomUUID();
  const link=(target=existing,version=1,confirmed=true,req=crypto.randomUUID(),person=source.student_id)=>rpc("app_link_returning_student($1,$2,$3,$4,'New School','Bio',$5,$6,$7,'Verified same student',$8,$9)",[group(2028),old,target,target?null:'99',target?version:null,source.student_version,person,confirmed,req]);
  await uid(marker);await assert.rejects(()=>link(),/Only active admins/);await uid(admin);
  await assert.rejects(()=>link(existing,1,false),/Confirm the same person/);await assert.rejects(()=>link(existing,9),/Target student changed/);await assert.rejects(()=>link(existing,1,true,crypto.randomUUID(),crypto.randomUUID()),/Earlier enrolment changed/);
  await rpc('app_set_group_archived($1,true)',[group(2028)]);await assert.rejects(()=>link(),/active target/);await rpc('app_set_group_archived($1,false)',[group(2028)]);
  await rpc('app_set_group_archived($1,true)',[group(2027)]);const linked=await link(existing,1,true,linkReq);assert.equal(linked.id,existing);assert.deepEqual(await link(existing,1,true,linkReq),linked);
  const current=(await db.query('select * from enrolments where id=$1',[existing])).rows[0];assert.equal(current.student_id,source.student_id);assert.equal(current.student_code,'SC/2028/88');assert.equal(current.stream,'Maths');
  const workspace=await rpc('app_get_test_workspace($1)',[tNew]);assert.ok(workspace.students.find(s=>s.id===existing).linked_ids.includes('SC/2027/6'));
  const score=workspace.scores[0];assert.equal(score.enrolment_id,existing);assert.equal(score.cents,2000);
  const afterOld=(await db.query('select * from enrolments where id=$1',[old])).rows[0];assert.equal(afterOld.student_code,'SC/2027/6');assert.deepEqual((await rpc('app_get_report($1)',[report])).rows,snapshot.rows);
  await assert.rejects(()=>link(null),/already has an enrolment/);
  const source2=(await rpc("app_search_student_identities('SC/2027/7')"))[0];
  const newLink=await rpc("app_link_returning_student($1,$2,null,'100','New School','Bio',null,$3,$4,'Repeating exam',true,$5)",[group(2028),duplicate,source2.student_version,source2.student_id,crypto.randomUUID()]);assert.equal(newLink.student_code,'SC/2028/100');assert.equal((await db.query('select student_id from enrolments where id=$1',[newLink.id])).rows[0].student_id,source2.student_id);
  const row={student_code:'SC/2028/88',student:{name:'Earlier name',enrolments:[{student_code:'SC/2027/6',aliases:[{student_code:'TEMP/SC/2027/000001'}]}]}};
  assert.deepEqual(searchDirectory([row],'SC/2027/0006',2028),[row]);assert.deepEqual(searchDirectory([row],'TEMP/SC/2027/000001',2028),[row]);assert.deepEqual(searchDirectory([row],'6',2028),[]);assert.deepEqual(searchDirectory([row],'88',2028),[row]);
  const marksStudent={id:'current',name:'Earlier name',school:'School',student_code:'SC/2028/88',linked_ids:['SC/2027/6','TEMP/SC/2027/000001']};assert.deepEqual(searchMarksStudents([marksStudent],'SC/2027/0006',2028),[marksStudent]);assert.deepEqual(searchMarksStudents([marksStudent],'1',2028),[]);
  // New alias foreign keys cooperate with the already-deployed cleanup.
  const p=await rpc('app_preview_trial_cleanup($1,true)',[group(2028)]);await rpc('app_clear_trial_data($1,true,$2,$3,$4)',[group(2028),p.fingerprint,p.confirmation,crypto.randomUUID()]);
  assert.equal((await db.query('select count(*) from student_id_aliases where enrolment_id=$1',[old])).rows[0].count,1);assert.equal((await rpc('app_get_report($1)',[report])).rows[0].id,old);
 }finally{await db.close();}
});

test('account administration protects roles, handles invitation retries and ignores forged signup metadata',async()=>{
 const {db,rpc,uid}=await fixture();
 try{
  const list=()=>rpc("app_list_accounts('',0)");assert.equal((await list()).length,4);
  const update=(id,name,role,active,version=1,request=crypto.randomUUID())=>rpc('app_update_account($1,$2,$3,$4,$5,$6)',[id,name,role,active,version,request]);
  await uid(marker);await assert.rejects(list,/Only active admins/);await assert.rejects(()=>update(marker,'Self','admin',true),/Only active admins/);await uid(admin);
  await assert.rejects(()=>update(admin,'Admin','marker',true),/another admin/);await assert.rejects(()=>update(marker,'Marker','owner',true),/Enter a name/);
  const request=crypto.randomUUID();await update(marker,'Renamed marker','marker',false,1,request);await update(marker,'Renamed marker','marker',false,1,request);
  await uid(marker);await assert.rejects(list,/Only active admins/);await uid(admin);await assert.rejects(()=>update(marker,'Changed','admin',true,1),/Account changed/);await update(marker,'Renamed marker','marker',true,2);
  await update(second,'New admin','admin',true);assert.equal((await list()).find(a=>a.id===second).role,'admin');
  const invite=crypto.randomUUID(),begin=(req=invite,email='new@school.test',name='New marker')=>rpc('app_begin_account_invite($1,$2,$3,$4)',[admin,email,name,req]);
  await assert.rejects(()=>begin(),/Server invitation/);await db.exec("set test.jwt_role='service_role'");
  await db.exec('set role service_role');assert.equal((await db.query('select role,is_active from profiles where id=$1',[admin])).rows[0].role,'admin');await db.exec('reset role');
  await assert.rejects(()=>begin(crypto.randomUUID(),'admin@school.test'),/already has an account/);
  assert.equal((await begin()).send,true);assert.equal((await begin()).status,'Sending');await assert.rejects(()=>begin(invite,'changed@school.test'),/another action/);
  await rpc('app_finish_account_invite($1,false)',[invite]);assert.equal((await begin()).send,true);
  const invited=crypto.randomUUID();await db.query("insert into auth.users(id,email,invited_at,raw_user_meta_data) values($1,'new@school.test',now(),'{\"role\":\"admin\",\"display_name\":\"Forged\"}')",[invited]);
  let profile=(await db.query('select * from profiles where id=$1',[invited])).rows[0];assert.equal(profile.role,'marker');assert.equal(profile.display_name,'New marker');assert.equal(profile.is_active,true);
  await rpc('app_finish_account_invite($1,true)',[invite]);assert.equal((await begin()).status,'Sent');assert.equal((await begin()).send,false);
  // A later disabled account must never be reactivated by an old invite retry.
  await db.exec("set test.jwt_role='authenticated'");await update(invited,'New marker','marker',false);await db.exec("set test.jwt_role='service_role'");await rpc('app_finish_account_invite($1,true)',[invite]);assert.equal((await db.query('select is_active from profiles where id=$1',[invited])).rows[0].is_active,false);
  const outsider=crypto.randomUUID();await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'outsider@school.test','{\"role\":\"admin\",\"is_active\":true}')",[outsider]);profile=(await db.query('select * from profiles where id=$1',[outsider])).rows[0];assert.equal(profile.role,'marker');assert.equal(profile.is_active,false);
  // Auth can populate invited_at after insertion; finish verifies it before activation.
  const lateRequest=crypto.randomUUID(),late=crypto.randomUUID();await begin(lateRequest,'late@school.test');await db.query("insert into auth.users(id,email) values($1,'late@school.test')",[late]);assert.equal((await db.query('select is_active from profiles where id=$1',[late])).rows[0].is_active,false);await db.query('update auth.users set invited_at=now() where id=$1',[late]);await rpc('app_finish_account_invite($1,true)',[lateRequest]);assert.equal((await db.query('select is_active from profiles where id=$1',[late])).rows[0].is_active,true);
  await db.exec("set test.jwt_role='authenticated';set role authenticated");await assert.rejects(()=>db.query("update profiles set role='admin'"),/permission denied/);await assert.rejects(()=>begin(),/permission denied/);await assert.rejects(()=>db.query('select * from auth.users'),/permission denied/);
  assert.ok((await rpc('app_list_account_invitations()')).length>=2);await uid(marker);await assert.rejects(()=>rpc('app_list_account_invitations()'),/Only active admins/);
 }finally{await db.close();}
});

test('participant reassignment preserves scores and original ownership and requires the recipient to resubmit',async()=>{
 const {db,rpc,uid,add,create}=await fixture();
 try{
  const a=await add(2027,'Student','1'),t=await create(2027),snap=()=>rpc('app_get_test_workspace($1)',[t]);
  const manage=async(action,id,to=null,revision=null,request=crypto.randomUUID())=>rpc('app_manage_test_participant($1,$2,$3,$4,$5,$6)',[t,action,id,to,revision??(await snap()).test.revision,request]);
  await uid(marker);await rpc("app_save_test_score($1,$2,'22',0,$3)",[t,a,crypto.randomUUID()]);await rpc('app_submit_test_batch($1,1,$2)',[t,crypto.randomUUID()]);await assert.rejects(()=>manage('add',second),/Only active admins/);await uid(admin);
  await rpc('app_submit_test_batch($1,0,$2)',[t,crypto.randomUUID()]);await assert.rejects(()=>manage('add',second,null,999),/Test changed/);await manage('add',second);
  await assert.rejects(()=>manage('remove',marker),/Reassign this batch/);
  const req=crypto.randomUUID(),revision=(await snap()).test.revision;const result=await manage('remove',marker,admin,revision,req);assert.equal(result.transferred,1);assert.deepEqual(await manage('remove',marker,admin,revision,req),result);
  let s=await snap(),score=s.scores[0],receiver=s.participants.find(p=>p.marker_id===admin);assert.equal(score.cents,2200);assert.equal(score.marker_id,admin);assert.equal(score.original_marker_id,marker);assert.equal(score.original_marker_name,'Marker');assert.ok(receiver.batch_revision>receiver.submitted_revision);assert.ok(!s.participants.some(p=>p.marker_id===marker));
  await assert.rejects(()=>rpc("app_save_test_score($1,$2,'24',1,$3)",[t,a,crypto.randomUUID()]),/score changed/);
  await uid(marker);await assert.rejects(()=>rpc("app_save_test_score($1,$2,'24',$3,$4)",[t,a,score.version,crypto.randomUUID()]),/another marker/);await uid(admin);
  await manage('remove',second);await assert.rejects(()=>manage('remove',admin),/last marker/);
  s=await snap();await assert.rejects(()=>rpc("app_complete_marks_test($1,'close',$2,'{}',$3)",[t,s.test.revision,crypto.randomUUID()]),/submit|submitted/);
  await rpc('app_submit_test_batch($1,$2,$3)',[t,receiver.batch_revision,crypto.randomUUID()]);s=await snap();await rpc("app_complete_marks_test($1,'close',$2,'{}',$3)",[t,s.test.revision,crypto.randomUUID()]);await assert.rejects(()=>manage('add',second),/Reopen/);
  assert.equal((await rpc('app_export_marker_students($1,$2)',[t,admin])).rows[0].cents,2200);
 }finally{await db.close();}
});
