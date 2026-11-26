import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture,admin,otherAdmin,marker,second} from './adminFixture.js';
const one=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0];
function actions(f){const {rpc,group}=f;return {
 save:(t,e,text='12',v=0)=>rpc('app_save_test_score($1,$2,$3,$4,$5)',[t,e,text,v,crypto.randomUUID()]),
 generate:(t,request=crypto.randomUUID())=>rpc("app_generate_report($1,$2,'History report','both',true,0,$3)",[group(2027),[t],request]),
 snapshot:id=>rpc('app_get_report($1)',[id]),
 remove:(r,request=crypto.randomUUID(),confirmed=true,version=r.version,date=r.created_at)=>rpc('app_delete_saved_report($1,$2,$3,$4,$5)',[r.id,version,date,confirmed,request]),
 history:(e,linked=false,limit=25,offset=0)=>rpc('app_student_marks_history($1,$2,$3,$4)',[e,linked,limit,offset]),
 changes:(e,t,limit=25,offset=0)=>rpc('app_student_mark_changes($1,$2,$3,$4)',[e,t,limit,offset]),
};}

test('saved reports are permanently deleted by admins, safe on retries, and version numbers are never reused',async()=>{
 const f=await fixture(),{db,rpc,uid,add,create,group}=f,a=actions(f);
 try{
  const e=await add(2027,'Report student','1'),t=await create(2027);await a.save(t,e,'18.25');
  await db.exec('set role authenticated');const first=await a.snapshot(await a.generate(t)),genRequest=crypto.randomUUID(),latest=await a.snapshot(await a.generate(t,genRequest));
  assert.equal(first.version,1);assert.equal(latest.version,2);
  await uid(marker);await assert.rejects(()=>a.remove(latest),/Only active admins/);await uid(admin);
  await assert.rejects(()=>a.remove(latest,crypto.randomUUID(),false),/Confirm permanent/);
  await assert.rejects(()=>a.remove(latest,crypto.randomUUID(),true,99),/Report changed/);
  await assert.rejects(()=>a.remove(latest,crypto.randomUUID(),true,2,'2000-01-01T00:00:00Z'),/Report changed/);
  const scores=(await db.query('select * from test_scores')).rows,history=(await db.query('select * from test_mark_history')).rows,participants=(await db.query('select * from test_participants')).rows;
  await uid(otherAdmin);const request=crypto.randomUUID(),result=await a.remove(latest,request);assert.equal(result.deleted,true);assert.deepEqual(await a.remove(latest,request),result);
  await assert.rejects(()=>a.remove(first,request),/different save/);await assert.rejects(()=>a.snapshot(latest.id),/not found/);
  assert.equal((await one(db,'select count(*) from saved_reports where id=$1',[latest.id])).count,0);assert.equal((await one(db,'select count(*) from saved_report_tests where report_id=$1',[latest.id])).count,0);
  assert.deepEqual((await db.query('select * from test_scores')).rows,scores);assert.deepEqual((await db.query('select * from test_mark_history')).rows,history);assert.deepEqual((await db.query('select * from test_participants')).rows,participants);
  assert.equal((await a.snapshot(first.id)).version,1);assert.deepEqual((await rpc('app_list_reports($1)',[group(2027)])).map(r=>r.id),[first.id]);
  await uid(admin);await assert.rejects(()=>a.generate(t,genRequest),/different save/);
  const third=await a.snapshot(await a.generate(t));assert.equal(third.version,3);
  await a.remove(first);await a.remove(third);assert.equal((await one(db,'select count(*) from saved_reports')).count,0);
  await db.exec('reset role');await db.query("update marks_tests set status='Closed' where id=$1",[t]);await db.exec('set role authenticated');
  const final=await a.snapshot(await a.generate(t));assert.equal(final.version,4);assert.equal(final.is_final,true);
  await uid(marker);assert.equal((await a.snapshot(final.id)).is_final,true);await assert.rejects(()=>a.remove(final),/Only active admins/);await uid(admin);
  await rpc('app_set_group_archived($1,true)',[group(2027)]);await a.remove(final);
  await assert.rejects(()=>a.snapshot(final.id),/not found/);assert.equal((await one(db,'select count(*) from test_scores')).count,1);
  await db.exec('reset role;set role anon');await assert.rejects(()=>a.remove(final),/permission denied/);await db.exec('reset role');
 }finally{await db.close();}
});

test('report deletion rolls back dependent failures and migration preserves populated data and version counters',async()=>{
 const f=await fixture(),{db,rpc,add,create,group}=f,a=actions(f);
 try{
  const e=await add(2027,'Rollback student','1'),t=await create(2027);await a.save(t,e);const report=await a.snapshot(await a.generate(t));
  await db.exec('create table report_dependency(report_id uuid references saved_reports(id))');await db.query('insert into report_dependency values($1)',[report.id]);
  const request=crypto.randomUUID();await assert.rejects(()=>a.remove(report,request),/foreign key/);
  assert.equal((await a.snapshot(report.id)).version,1);assert.equal((await one(db,'select count(*) from saved_report_tests where report_id=$1',[report.id])).count,1);assert.equal((await one(db,'select count(*) from marks_write_requests where request_id=$1',[request])).count,0);
  await db.query('update exam_groups set report_version=0 where id=$1',[group(2027)]);
  const migration=await readFile(new URL('../supabase/015_report_delete_student_history.sql',import.meta.url),'utf8');await db.exec(migration);
  assert.equal((await one(db,'select report_version from exam_groups where id=$1',[group(2027)])).report_version,1);
  const secondReport=await a.snapshot(await a.generate(t));assert.equal(secondReport.version,2);await a.remove(secondReport);await db.exec(migration);assert.equal((await a.snapshot(await a.generate(t))).version,3);
  await db.exec('drop table report_dependency');await a.remove(report,request);assert.equal((await one(db,'select count(*) from test_scores')).count,1);
  await db.exec('create table auth.identities(id uuid primary key)');await db.exec(await readFile(new URL('../supabase/checks/restore_readiness.sql',import.meta.url),'utf8'));
 }finally{await db.close();}
});

test('student marks history separates missing, zero, removed and online scores, follows explicit linked years and respects roles',async()=>{
 const f=await fixture(),{db,rpc,uid,add,create,group}=f,a=actions(f);
 try{
  const e=await add(2027,'Shared name','1'),sameName=await add(2028,'Shared name','2');
  const person=await one(db,'select student_id from enrolments where id=$1',[e]);const linked=(await rpc("app_link_returning_student($1,$2,null,'3','School','Bio',null,1,$3,'Confirmed identity',true,$4)",[group(2028),e,person.student_id,crypto.randomUUID()])).id;
  const zero=await create(2027,1),online=await create(2027,2),removed=await create(2027,3),missing=await create(2027,4),cancelled=await create(2027,5),closed=await create(2027,6),later=await create(2028,1);
  await uid(marker);await a.save(zero,e,'0');await a.save(removed,e,'15');await rpc('app_remove_test_score($1,$2,1,$3)',[removed,e,crypto.randomUUID()]);await uid(admin);
  await rpc("app_import_online_file($1,'export.xlsx','2027 Phase 1 Paper 2',$2,$3)",[online,JSON.stringify([{code:'1',mark:'22 / 40'}]),crypto.randomUUID()]);
  await a.save(cancelled,e,'25');await a.save(closed,e,'30');await a.save(later,linked,'35');await a.save(later,sameName,'40');
  await db.query("update marks_tests set status='Cancelled' where id=$1",[cancelled]);await db.query("update marks_tests set status='Closed' where id=$1",[closed]);
  await rpc("app_change_student_id($1,'10',1,'Verified correction',true,$2)",[e,crypto.randomUUID()]);
  await rpc('app_set_group_archived($1,true)',[group(2027)]);await db.exec('set role authenticated');await uid(marker);
  const saved=await a.history(e);assert.equal(saved.total,6);assert.equal(saved.student.student_code,'SC/2027/10');assert.equal(saved.is_admin,false);assert.ok(saved.entries.every(r=>r.change_count===null));
  assert.equal(saved.entries.find(r=>r.test_id===zero).cents,0);assert.equal(saved.entries.find(r=>r.test_id===missing).has_score,false);assert.equal(saved.entries.find(r=>r.test_id===removed).is_deleted,true);assert.equal(saved.entries.find(r=>r.test_id===removed).cents,null);
  assert.equal(saved.entries.find(r=>r.test_id===online).source,'Online');assert.equal(saved.entries.find(r=>r.test_id===online).cents,2200);assert.equal(saved.entries.find(r=>r.test_id===cancelled).status,'Cancelled');assert.ok(saved.entries.every(r=>r.is_archived));
  const all=await a.history(e,true);assert.equal(all.total,7);assert.equal(all.enrolments.length,2);assert.equal(all.entries.find(r=>r.enrolment_id===linked).cents,3500);assert.ok(!all.entries.some(r=>r.enrolment_id===sameName));
  const pages=[];for(let offset=0;offset<6;offset+=2){const page=await a.history(e,false,2,offset);assert.equal(page.total,6);pages.push(...page.entries.map(r=>r.test_id));}assert.equal(new Set(pages).size,6);assert.deepEqual(pages,saved.entries.map(r=>r.test_id));
  await assert.rejects(()=>a.changes(e,zero),/Only active admins/);assert.equal((await db.query('select count(*) from test_mark_history')).rows[0].count,0);
  await db.exec('begin read only');assert.equal((await a.history(e,true)).total,7);await db.exec('rollback');
  await assert.rejects(()=>a.history(crypto.randomUUID()),/no longer exists/);await assert.rejects(()=>a.history(e,null),/scope/);await assert.rejects(()=>a.history(e,false,101),/page size/);await assert.rejects(()=>a.history(e,false,25,-1),/page size/);
  await db.exec('reset role');await db.query('update profiles set is_active=false where id=$1',[marker]);await db.exec('set role authenticated');await assert.rejects(()=>a.history(e),/active account/);await db.exec('reset role;set role anon');await assert.rejects(()=>a.history(e),/permission denied/);await db.exec('reset role');
 }finally{await db.close();}
});

test('admin score-change history is scoped and paginated without exposing another student or test',async()=>{
 const f=await fixture(),{db,rpc,uid,add,create}=f,a=actions(f);
 try{
  const e=await add(2027,'History student','1'),other=await add(2027,'Other student','2'),t=await create(2027),differentYear=await create(2028);
  await uid(marker);await a.save(t,e,'0');await uid(admin);await a.save(t,e,'13',1);await a.save(t,other,'39');await uid(marker);await rpc('app_remove_test_score($1,$2,2,$3)',[t,e,crypto.randomUUID()]);await uid(admin);await db.exec('set role authenticated');
  const first=await a.changes(e,t,2,0),last=await a.changes(e,t,2,2);assert.equal(first.total,3);assert.equal(first.entries.length,2);assert.equal(last.entries.length,1);assert.equal(new Set([...first.entries,...last.entries].map(h=>h.id)).size,3);
  const events=[...first.entries,...last.entries];assert.ok(events.some(h=>h.before_cents===0&&h.after_cents===1300));assert.ok(events.some(h=>h.before_cents===1300&&h.after_cents===null));assert.ok(events.some(h=>h.after_cents===0));assert.ok(events.every(h=>h.before_cents!==3900&&h.after_cents!==3900));assert.ok(events.some(h=>h.actor_name==='Marker'));const adminName=(await one(db,'select display_name from profiles where id=$1',[admin])).display_name;assert.ok(events.some(h=>h.actor_name===adminName));
  assert.equal((await a.history(e)).entries[0].change_count,3);await assert.rejects(()=>a.changes(e,differentYear),/same exam year/);await assert.rejects(()=>a.changes(e,t,0),/page size/);await assert.rejects(()=>a.changes(e,t,25,-1),/page size/);
  await db.exec('begin read only');assert.equal((await a.changes(e,t)).total,3);await db.exec('rollback');
  await uid(second);await assert.rejects(()=>a.changes(e,t),/Only active admins/);await db.exec('reset role');await db.query('update profiles set is_active=false where id=$1',[admin]);await uid(admin);await db.exec('set role authenticated');await assert.rejects(()=>a.changes(e,t),/Only active admins/);await assert.rejects(()=>a.history(e),/active account/);await db.exec('reset role;set role anon');await assert.rejects(()=>a.changes(e,t),/permission denied/);await db.exec('reset role');
 }finally{await db.close();}
});
