import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";

test("admin trial cleanup previews scope, rejects changed data, rolls back safely and preserves other years",async()=>{
 const db=new PGlite(),admin="00000000-0000-0000-0000-000000000001",marker="00000000-0000-0000-0000-000000000002";
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create schema app_private;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
   create table profiles(id uuid primary key,display_name text,role text,is_active boolean);
   create function app_private.is_admin() returns boolean language sql stable as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and is_active)$$;
   create function app_private.is_active_member() returns boolean language sql stable as $$select exists(select 1 from public.profiles where id=auth.uid() and is_active)$$;
   insert into profiles values('${admin}','Admin','admin',true),('${marker}','Marker','marker',true);set test.uid='${admin}';`);
  for(const file of ['002_shared_students.sql','003_student_management.sql','004_shared_test_marks.sql','005_import_remove_export.sql','006_online_import_reports.sql','007_zero_fill_empty_batches.sql','008_online_date_recovery.sql','009_trial_data_cleanup.sql','009_trial_data_cleanup.sql'])
   await db.exec(await readFile(new URL(`../supabase/${file}`,import.meta.url),'utf8'));
  const rpc=async(sql,args=[])=>(await db.query(`select ${sql} as result`,args)).rows[0].result;
  const count=async(table,where='true',args=[])=>Number((await db.query(`select count(*) from ${table} where ${where}`,args)).rows[0].count);
  const groups=(await db.query('select id,exam_year from exam_groups')).rows,g=groups.find(x=>x.exam_year===2027).id,other=groups.find(x=>x.exam_year===2028).id;
  const reqA=crypto.randomUUID(),reqB=crypto.randomUUID();
  const add=(group,name,id,request=crypto.randomUUID())=>rpc("app_add_student($1,$2,'School','Maths',$3,$4)",[group,name,id,request]);
  const a=(await add(g,'Linked student','1',reqA)).id,b=(await add(g,'Trial student','',reqB)).id,c=(await add(other,'Other-year student','2')).id;
  const personA=(await db.query('select student_id from enrolments where id=$1',[a])).rows[0].student_id;
  const personB=(await db.query('select student_id from enrolments where id=$1',[b])).rows[0].student_id;
  await db.query("insert into enrolments(student_id,group_id,school_id,stream,student_code,created_by,request_id) select student_id,$2,school_id,stream,'SC/2028/1',created_by,$3 from enrolments where id=$1",[a,other,crypto.randomUUID()]);
  await rpc('app_set_enrolment_active($1,false,1)',[b]);
  const create=(group,paper,request=crypto.randomUUID())=>rpc("app_create_marks_test($1,'Trial phase',$2,'2026-11-11','40',$3,$4)",[group,paper,[admin,marker],request]);
  const createRequest=crypto.randomUUID(),tid=(await create(g,1,createRequest)).id,t2=(await create(g,2)).id,t3=(await create(g,3)).id,tOther=(await create(other,1)).id;
  await rpc("app_save_test_score($1,$2,'15',0,$3)",[tid,a,crypto.randomUUID()]);
  await rpc("app_save_test_score($1,$2,'30',0,$3)",[tOther,c,crypto.randomUUID()]);
  const importRows=JSON.stringify([{code:'1',mark:'10 / 40'},{code:'999',mark:'bad score'}]);
  await rpc("app_import_online_file($1,'trial.xlsx','2027',$2,$3)",[tid,importRows,crypto.randomUUID()]);
  await rpc("app_import_online_file($1,'trial.xlsx','2027',$2,$3)",[t2,JSON.stringify([{code:'1',mark:'20 / 40'}]),crypto.randomUUID()]);
  const report=(group,ids)=>rpc("app_generate_report($1,$2,'Trial report','both',true,0,$3)",[group,ids,crypto.randomUUID()]);
  await report(g,[tid,t2]);await db.query("update marks_tests set status='Closed' where id=any($1::uuid[])",[[tid,t2]]);await report(g,[tid,t2]);
  await db.query("update marks_tests set status='Open',revision=revision+1 where id=$1",[tid]);await db.query("update marks_tests set status='Cancelled' where id=$1",[t3]);
  const otherReport=await report(other,[tOther]),otherSnapshot=await rpc('app_get_report($1)',[otherReport]);
  const preview=(students=false)=>rpc('app_preview_trial_cleanup($1,$2)',[g,students]);
  const clear=(p,students=p.remove_students,request=crypto.randomUUID(),phrase=p.confirmation)=>rpc('app_clear_trial_data($1,$2,$3,$4,$5)',[g,students,p.fingerprint,phrase,request]);
  let p=await preview();assert.equal(p.counts.tests,3);assert.equal(p.tests.length,3);assert.equal(p.counts.scores,2);assert.equal(p.counts.reports,2);assert.equal(p.counts.import_rows,3);assert.equal(p.counts.students,0);assert.equal(p.counts.students_kept,2);assert.equal(p.confirmation,'CLEAR TRIAL 2027');
  await db.exec(`set test.uid='${marker}'`);await assert.rejects(preview,/Only active admins/);await assert.rejects(()=>clear(p),/Only active admins/);
  await db.exec(`set test.uid='${admin}'`);
  await db.query('update profiles set is_active=false where id=$1',[admin]);await assert.rejects(preview,/Only active admins/);await db.query('update profiles set is_active=true where id=$1',[admin]);
  await assert.rejects(()=>clear(p,false,crypto.randomUUID(),'CLEAR TRIAL 2028'),/Type CLEAR TRIAL/);
  await assert.rejects(()=>clear(p,true),/Data changed/);
  await rpc("app_save_test_score($1,$2,'16',1,$3)",[tid,a,crypto.randomUUID()]);await assert.rejects(()=>clear(p),/Data changed/);assert.equal(await count('marks_tests'),4);
  await rpc('app_set_group_archived($1,true)',[g]);await assert.rejects(preview,/Restore the archived group/);await assert.rejects(()=>clear(p),/Restore the archived group/);await rpc('app_set_group_archived($1,false)',[g]);
  p=await preview();
  await db.exec('create table cleanup_hold(test_id uuid references marks_tests(id));');await db.query('insert into cleanup_hold values($1)',[tid]);
  await assert.rejects(()=>clear(p),/foreign key/);
  assert.equal(await count('marks_tests'),4);assert.equal(await count('saved_reports','group_id=$1',[g]),2);assert.equal(await count('online_import_rows'),3);assert.equal(await count('trial_cleanup_runs'),0);
  await db.exec('drop table cleanup_hold');
  const request=crypto.randomUUID(),result=await clear(p,false,request);assert.equal(result.cleared,true);assert.equal(result.removed_test_ids.length,3);assert.deepEqual(await clear(p,false,request),result);
  await assert.rejects(()=>clear(p,true,request),/different action/);
  for(const table of ['marks_tests','test_scores','saved_reports'])assert.equal(await count(table,'group_id=$1',[g]),0);
  for(const table of ['test_mark_history','test_participants','online_import_batches','online_import_rows','online_file_import_receipts'])assert.equal(await count(table,'test_id=any($1::uuid[])',[[tid,t2,t3]]),0);
  assert.equal(await count('enrolments','group_id=$1',[g]),2);assert.equal(await count('student_change_history'),1);
  assert.deepEqual(await rpc('app_get_report($1)',[otherReport]),otherSnapshot);assert.equal(await count('test_scores','test_id=$1',[tOther]),1);
  await assert.rejects(()=>create(g,1,createRequest),/already used/);
  await assert.rejects(()=>rpc("app_save_test_score($1,$2,'17',2,$3)",[tid,a,crypto.randomUUID()]),/Test not found/);
  assert.equal((await preview()).counts.tests,0);
  // Full reset also removes student history and orphan people; linked people survive.
  const full=await preview(true);assert.equal(full.counts.students,2);await clear(full,true);
  assert.equal(await count('enrolments','group_id=$1',[g]),0);assert.equal(await count('student_change_history'),0);assert.equal(await count('students','id=$1',[personA]),1);assert.equal(await count('students','id=$1',[personB]),0);assert.equal(await count('enrolments','group_id=$1',[other]),2);
  const peopleBefore=await count('students');await assert.rejects(()=>add(g,'Trial student','',reqB),/cleared trial data/);await assert.rejects(()=>add(g,'Linked student','1',reqA),/cleared trial data/);assert.equal(await count('students'),peopleBefore);
  const newStudent=await add(g,'New student','');assert.notEqual(newStudent.student_code,'TEMP/SC/2027/000001');assert.equal(await count('profiles'),2);assert.equal(await count('schools'),1);assert.equal(await count('exam_groups'),2);
  // Authenticated users cannot bypass the RPCs or read internal cleanup receipts.
  await db.exec('set role authenticated');
  await assert.rejects(()=>db.query('select * from trial_cleanup_runs'),/permission denied/);await assert.rejects(()=>db.query('delete from enrolments'),/permission denied/);
  await assert.rejects(()=>db.query('select app_private.trial_cleanup_snapshot($1,false)',[g]),/permission denied/);
  await db.exec('reset role;set role anon');await assert.rejects(()=>preview(),/permission denied/);
 }finally{await db.close();}
});
