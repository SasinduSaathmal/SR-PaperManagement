import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture,admin,marker,second} from './adminFixture.js';
import {canonicalSchool,similarSchools} from '../src/schoolNames.js';
import {previewStudents} from '../src/studentImport.js';
import {previewOnlineRows} from '../src/onlineImport.js';
import {loadSchools,searchDirectory} from '../src/studentsApi.js';

function actions(f){
 const {rpc,group}=f;
 return {
  save:(t,e,mark='12',version=0,id=crypto.randomUUID())=>rpc('app_save_test_score($1,$2,$3,$4,$5)',[t,e,mark,version,id]),
  report:(t,top=0)=>rpc("app_generate_report($1,$2,'School report','both',true,$3,$4)",[group(2027),[t],top,crypto.randomUUID()]),
  change:(e,code,version=1,id=crypto.randomUUID(),confirmed=true)=>rpc("app_change_student_id($1,$2,$3,'Correct official record',$4,$5)",[e,code,version,confirmed,id]),
  preview:(e,all=false)=>rpc('app_preview_student_removal($1,$2)',[e,all]),
  remove:(e,p,all=false,id=crypto.randomUUID(),phrase=p.confirmation)=>rpc("app_remove_student($1,$2,$3,$4,'Requested removal',$5)",[e,all,p.fingerprint,phrase,id]),
  schoolPreview:(ids,target,name)=>rpc('app_preview_school_merge($1,$2,$3)',[ids,target,name]),
  merge:(ids,target,name,p,id=crypto.randomUUID())=>rpc("app_merge_schools($1,$2,$3,'Verified same school',$4,'MERGE SCHOOLS',$5)",[ids,target,name,p.fingerprint,id]),
  stage:(t,rows,id=crypto.randomUUID())=>rpc("app_import_online_file($1,'online.xlsx','2027 Phase 1 Paper 1',$2,$3)",[t,JSON.stringify(rows),id]),
 };
}
const one=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0];

test('official ID correction preserves enrolment, marks and frozen reports, reserves previous IDs, and resolves them in imports',async()=>{
 const f=await fixture(),{db,rpc,uid,add,create,group}=f,a=actions(f);
 try{
  const e=await add(2027,'ID student','11'),other=await add(2027,'Other','22'),temp=await add(2027,'Temporary');
  const t=await create(2027);await a.save(t,e);const report=await a.report(t),frozen=await rpc('app_get_report($1)',[report]);
  await uid(marker);await assert.rejects(()=>a.change(e,'12'),/Only active admins/);await uid(admin);
  await assert.rejects(()=>a.change(e,'12',1,crypto.randomUUID(),false),/Confirm the same student/);
  await assert.rejects(()=>a.change(e,'SC/2028/12'),/matching this exam/);await assert.rejects(()=>a.change(e,'12',99),/Student changed/);await assert.rejects(()=>a.change(e,'22'),/already belongs/);
  const id=crypto.randomUUID(),changed=await a.change(e,'00012',1,id);assert.equal(changed.student_code,'SC/2027/12');assert.deepEqual(await a.change(e,'00012',1,id),changed);
  await assert.rejects(()=>a.change(e,'13',2,id),/different save/);await assert.rejects(()=>a.change(other,'11'),/earlier ID/);
  await assert.rejects(()=>add(2027,'Accidental duplicate','11'),/reserved as an earlier ID/);
  assert.equal((await one(db,'select cents from test_scores where enrolment_id=$1',[e])).cents,1200);
  const after=await rpc('app_get_report($1)',[report]);assert.deepEqual(after.rows,frozen.rows);assert.equal(after.source_changed,true);
  assert.equal((await rpc("app_search_student_identities('SC/2027/11')"))[0].id,e);
  const importResult=await rpc('app_import_students($1,$2,$3)',[group(2027),JSON.stringify([{name:'ID student',school:'School',stream:'Maths',officialId:'11'}]),crypto.randomUUID()]);assert.deepEqual(importResult,{added:0,skipped:1});
  await a.stage(t,[{code:'SC/2027/11',mark:'12 / 40'}]);assert.equal((await one(db,'select count(*) from test_scores where enrolment_id=$1',[e])).count,1);
  const online=await rpc('app_get_online_imports($1)',[t]);assert.match(online[0].rows[0].message,/Existing Paper/);
  await a.change(e,'11',2);assert.equal((await one(db,'select student_code from enrolments where id=$1',[e])).student_code,'SC/2027/11');
  assert.equal((await one(db,"select count(*) from student_id_aliases where enrolment_id=$1 and student_code='SC/2027/12'",[e])).count,1);
  await a.change(temp,'33');assert.equal((await one(db,'select count(*) from student_id_aliases where enrolment_id=$1',[temp])).count,1);
  await rpc('app_set_group_archived($1,true)',[group(2027)]);await assert.rejects(()=>a.change(e,'99',3),/archived/);
  await uid(second);await db.query('update profiles set is_active=false where id=$1',[second]);await assert.rejects(()=>a.change(other,'99'),/Only active admins/);
 }finally{await db.close();}
});

test('reviewed school merge standardizes all enrolments and future aliases without changing marks or report snapshots',async()=>{
 const f=await fixture(),{db,rpc,uid,group,create}=f,a=actions(f);
 try{
  const addSchool=async(year,name,school,code)=>(await rpc("app_add_student($1,$2,$3,'Maths',$4,$5)",[group(year),name,school,code,crypto.randomUUID()])).id;
  const e=await addSchool(2027,'One','Rahula College, Matara','1'),e2=await addSchool(2028,'Two','Rahula Matara','2'),e3=await addSchool(2027,'Three','RAHULA COLLEGE MATARA','3');
  const t=await create(2027);await a.save(t,e);await a.save(t,e3,'20');const report=await a.report(t),frozen=await rpc('app_get_report($1)',[report]);
  const schools=await rpc('app_school_options()'),ids=schools.map(s=>s.id),target=schools.find(s=>s.name==='Rahula College, Matara').id;
  assert.equal(ids.length,3);const p=await a.schoolPreview(ids,target,'Rahula College, Matara');assert.equal(p.students,2);assert.equal(p._affected,undefined);
  await uid(marker);await assert.rejects(()=>a.schoolPreview(ids,target,'Rahula College, Matara'),/Only active admins/);await assert.rejects(()=>a.merge(ids,target,'Rahula College, Matara',p),/Only active admins/);await uid(admin);
  const request=crypto.randomUUID(),r=await a.merge(ids,target,'Rahula College, Matara',p,request);assert.equal(r.students,2);assert.deepEqual(await a.merge(ids,target,'Rahula College, Matara',p,request),r);
  assert.equal((await one(db,'select count(*) from schools')).count,1);assert.equal((await one(db,'select count(*) from enrolments where school_id=$1',[target])).count,3);
  assert.deepEqual((await db.query('select cents from test_scores order by cents')).rows.map(r=>r.cents),[1200,2000]);
  assert.deepEqual((await rpc('app_get_report($1)',[report])).rows,frozen.rows);assert.equal((await rpc('app_get_report($1)',[report])).source_changed,true);
  const canonical=(await rpc('app_school_options()'))[0];assert.ok(canonical.aliases.includes('Rahula Matara'));assert.deepEqual(canonical.years,[2027,2028]);
  await addSchool(2027,'Four','  rahula   matara  ','4');assert.equal((await one(db,'select count(*) from schools')).count,1);
  const imp=await rpc('app_import_students($1,$2,$3)',[group(2028),JSON.stringify([{name:'Two',school:'RAHULA COLLEGE MATARA',stream:'Maths',officialId:''}]),crypto.randomUUID()]);assert.deepEqual(imp,{added:0,skipped:1});
  let v=await one(db,'select version from enrolments where id=$1',[e2]);await rpc("app_update_student($1,'Two','rahula matara','Bio',$2,1)",[e2,v.version]);assert.equal((await one(db,'select school_id from enrolments where id=$1',[e2])).school_id,target);
  const rename=await a.schoolPreview([target],target,'Rahula College — Matara');assert.equal(rename.students,4);await a.merge([target],target,'Rahula College — Matara',rename);
  await addSchool(2028,'Five','Rahula College, Matara','5');assert.equal((await one(db,'select count(*) from schools')).count,1);
  await rpc('app_set_group_archived($1,true)',[group(2028)]);await assert.rejects(()=>a.schoolPreview([target],target,'Rahula College'),/archived exam/);
  assert.equal((await one(db,'select school_id from enrolments where id=$1',[e])).school_id,target);
 }finally{await db.close();}
});

test('school changes reject stale reviews and outside-name collisions and roll back when a dependent record blocks removal',async()=>{
 const f=await fixture(),{db,rpc,add,group}=f,a=actions(f);
 try{
  const e=await add(2027,'Student','1'),target=(await rpc('app_school_options()'))[0].id;
  await rpc("app_add_student($1,'Other','Other School','Maths','2',$2)",[group(2027),crypto.randomUUID()]);
  await assert.rejects(()=>a.schoolPreview([target],target,'other school'),/already belongs/);
  const p=await a.schoolPreview([target],target,'School Standard');await db.query('update enrolments set version=version+1 where id=$1',[e]);await assert.rejects(()=>a.merge([target],target,'School Standard',p),/School records changed/);
  const other=(await rpc('app_school_options()')).find(s=>s.id!==target).id,ids=[target,other];
  await db.exec('create table school_dependency(school_id uuid references schools(id))');await db.query('insert into school_dependency values($1)',[other]);
  const before=(await db.query('select id,school_id,version from enrolments order by id')).rows;const p2=await a.schoolPreview(ids,target,'School Standard');await assert.rejects(()=>a.merge(ids,target,'School Standard',p2),/foreign key/);
  assert.deepEqual((await db.query('select id,school_id,version from enrolments order by id')).rows,before);assert.equal((await one(db,'select count(*) from student_change_history')).count,0);
  await db.exec('drop table school_dependency');await a.merge(ids,target,'School Standard',p2);
  const q=await a.schoolPreview([target],target,'New Standard');await a.merge([target],target,'New Standard',q);
  // Canonical names and every earlier alias are reserved for that school.
  await rpc("app_add_student($1,'Alias reuse','School','Maths','3',$2)",[group(2027),crypto.randomUUID()]);assert.equal((await one(db,'select count(*) from schools')).count,1);
 }finally{await db.close();}
});

test('student removal deletes scoped marks/history/reports, anonymizes import rows, preserves other students and blocks stale retries',async()=>{
 const f=await fixture(),{db,rpc,uid,add,create,group}=f,a=actions(f);
 try{
  const createRequest=crypto.randomUUID();const e=(await rpc("app_add_student($1,'Remove student','School','Maths','1',$2)",[group(2027),createRequest])).id;
  const other=await add(2027,'Keep student','2'),sameName=await add(2028,'Remove student','3'),t=await create(2027);
  const scoreRequest=crypto.randomUUID();await a.save(t,e,'12',0,scoreRequest);await a.save(t,other,'30');await rpc('app_submit_test_batch($1,2,$2)',[t,crypto.randomUUID()]);
  const beforeParticipant=await one(db,'select batch_revision,submitted_revision from test_participants where test_id=$1 and marker_id=$2',[t,admin]);assert.equal(beforeParticipant.batch_revision,beforeParticipant.submitted_revision);
  const report=await a.report(t),keptReport=await a.report(t,1);await a.stage(t,[{code:'1',mark:'15 / 40'},{code:'2',mark:'0 / 40'}]);
  const p=await a.preview(e);assert.equal(p.counts.scores,1);assert.equal(p.counts.reports,1);assert.equal(p.counts.import_rows,1);assert.equal(p._private,undefined);
  await uid(marker);await assert.rejects(()=>a.preview(e),/Only active admins/);await assert.rejects(()=>a.remove(e,p),/Only active admins/);await uid(admin);
  await assert.rejects(()=>a.remove(e,p,false,crypto.randomUUID(),'DELETE wrong'),/phrase exactly/);
  // Any newly saved score invalidates the reviewed removal.
  await a.save(t,e,'13',1);await assert.rejects(()=>a.remove(e,p),/Student records changed/);
  const latest=await a.preview(e),request=crypto.randomUUID();assert.equal((await a.remove(e,latest,false,request)).deleted,true);assert.equal((await a.remove(e,latest,false,request)).deleted,true);
  assert.equal((await one(db,'select count(*) from enrolments where id=$1',[e])).count,0);assert.equal((await one(db,'select count(*) from test_scores where enrolment_id=$1',[e])).count,0);assert.equal((await one(db,'select count(*) from test_mark_history where enrolment_id=$1',[e])).count,0);assert.equal((await one(db,'select count(*) from student_change_history where enrolment_id=$1',[e])).count,0);
  assert.equal((await one(db,'select count(*) from enrolments where id=any($1::uuid[])',[[other,sameName]])).count,2);assert.equal((await one(db,'select cents from test_scores where enrolment_id=$1',[other])).cents,3000);
  assert.equal((await one(db,'select count(*) from saved_reports where id=$1',[report])).count,0);assert.equal((await rpc('app_get_report($1)',[keptReport])).source_changed,true);
  const rows=(await rpc('app_get_online_imports($1)',[t]))[0].rows;assert.equal(rows[0].status,'Dismissed');assert.deepEqual(rows[0].raw,{});assert.equal(rows[1].status,'Skipped');
  assert.ok(!(await db.query('select payload::text from marks_write_requests')).rows.some(r=>r.payload.includes('15 / 40')));
  const participant=await one(db,'select batch_revision,submitted_revision from test_participants where test_id=$1 and marker_id=$2',[t,admin]);assert.ok(participant.batch_revision>participant.submitted_revision);
  const receipt=await one(db,'select payload,result from marks_write_requests where request_id=$1',[scoreRequest]);assert.deepEqual(receipt.result,{removed:true});assert.ok(!JSON.stringify(receipt).includes(e));
  await assert.rejects(()=>rpc("app_add_student($1,'Remove student','School','Maths','1',$2)",[group(2027),createRequest]),/permanently removed student/);
  await assert.rejects(()=>a.save(t,e,'12',0,scoreRequest),/different save/);await assert.rejects(()=>a.save(t,e),/not found|not available|active student|belongs/i);
  const fresh=await add(2027,'Deliberate new entry','1');assert.notEqual(fresh,e);await a.remove(e,latest,false,request);assert.equal((await one(db,'select count(*) from enrolments where id=$1',[fresh])).count,1);
  await a.stage(t,[{code:'1',mark:'15 / 40'},{code:'2',mark:'0 / 40'}]);assert.equal((await one(db,'select count(*) from test_scores where enrolment_id=$1',[fresh])).count,0);
 }finally{await db.close();}
});

test('removal scope follows explicit person links, protects archives, preserves closed submissions and rolls back failed deletions',async()=>{
 const f=await fixture(),{db,rpc,uid,group,add,create}=f,a=actions(f);
 try{
  const old=await add(2027,'Linked student','1'),person=await one(db,'select student_id from enrolments where id=$1',[old]);
  const current=(await rpc("app_link_returning_student($1,$2,null,'2','School','Maths',null,1,$3,'Verified',true,$4)",[group(2028),old,person.student_id,crypto.randomUUID()])).id;
  const t=await create(2027,1,[admin]);await a.save(t,old);await rpc('app_submit_test_batch($1,1,$2)',[t,crypto.randomUUID()]);let s=await rpc('app_get_test_workspace($1)',[t]);await rpc("app_complete_marks_test($1,'close',$2,'{}',$3)",[t,s.test.revision,crypto.randomUUID()]);
  await rpc('app_set_group_archived($1,true)',[group(2027)]);await assert.rejects(()=>a.preview(current,true),/archived/);assert.equal((await a.preview(current)).counts.enrolments,1);
  await rpc('app_set_group_archived($1,false)',[group(2027)]);const all=await a.preview(current,true);assert.equal(all.counts.enrolments,2);
  await db.exec('create table dependent_record(enrolment_id uuid references enrolments(id))');await db.query('insert into dependent_record values($1)',[old]);await assert.rejects(()=>a.remove(current,all,true),/foreign key/);
  assert.equal((await one(db,'select count(*) from enrolments where student_id=$1',[person.student_id])).count,2);assert.equal((await one(db,'select count(*) from test_scores where enrolment_id=$1',[old])).count,1);assert.equal((await one(db,'select count(*) from cleared_student_requests')).count,0);
  await db.exec('drop table dependent_record');const before=await one(db,'select batch_revision,submitted_revision from test_participants where test_id=$1 and marker_id=$2',[t,admin]);await a.remove(current,all,true);
  assert.equal((await one(db,'select count(*) from students where id=$1',[person.student_id])).count,0);assert.deepEqual(await one(db,'select batch_revision,submitted_revision from test_participants where test_id=$1 and marker_id=$2',[t,admin]),before);assert.equal((await one(db,'select status from marks_tests where id=$1',[t])).status,'Closed');
  // Single-year removal retains the linked identity and other year's marks.
  const first=await add(2027,'Keep earlier','4'),p2=await one(db,'select student_id from enrolments where id=$1',[first]);const later=(await rpc("app_link_returning_student($1,$2,null,'5','School','Maths',null,1,$3,'Verified',true,$4)",[group(2028),first,p2.student_id,crypto.randomUUID()])).id;
  const t2=await create(2028);await a.save(t2,later);await a.remove(first,await a.preview(first));assert.equal((await one(db,'select count(*) from students where id=$1',[p2.student_id])).count,1);assert.equal((await one(db,'select cents from test_scores where enrolment_id=$1',[later])).cents,1200);
  await db.exec('set role authenticated');await assert.rejects(()=>db.exec('delete from school_name_aliases'),/permission denied/);await uid(marker);assert.ok(Array.isArray(await rpc('app_school_options()')));await uid(second);await db.exec('reset role');await db.query('update profiles set is_active=false where id=$1',[second]);await db.exec('set role authenticated');assert.equal((await db.query('select * from school_name_aliases')).rows.length,0);await assert.rejects(()=>rpc('app_school_options()'),/active account/);await db.exec('reset role;set role anon');await assert.rejects(()=>a.preview(later),/permission denied/);await db.exec('reset role');
  // Installing the migration again does not delete any records or lose aliases.
  const count=await one(db,'select count(*) from enrolments');await db.exec(await readFile(new URL('../supabase/013_student_records_schools.sql',import.meta.url),'utf8'));assert.deepEqual(await one(db,'select count(*) from enrolments'),count);
 }finally{await db.close();}
});

test('school suggestions require review, aliases match imports/search, old IDs preview as existing, and school loading supports old schemas',async()=>{
 const schools=[{id:'a',name:'Rahula College, Matara',aliases:['Rahula Matara']},{id:'b',name:'RAHULA COLLEGE MATARA'},{id:'c',name:'Matara Central College'}];
 assert.equal(canonicalSchool('  RAHULA   MATARA ',schools),schools[0].name);assert.equal(canonicalSchool('Rahula College Matara East',schools),'Rahula College Matara East');assert.ok(similarSchools(schools[0],schools).some(s=>s.id==='b'));assert.ok(!similarSchools(schools[0],schools).some(s=>s.id==='c'));
 const existing=[{id:'student',student_code:'SC/2027/12',aliases:[{student_code:'SC/2027/11'}],student:{name:'One'},school:schools[0],stream:'Maths'}];
 const rows=previewStudents([['ID','Name','School','Stream'],['11','One','Rahula Matara','Maths'],['','One','rahula matara','Maths']],{officialId:0,name:1,school:2,stream:3},existing,2027,schools);assert.equal(rows[0].status,'Existing');assert.equal(rows[1].status,'Duplicate');assert.equal(rows[0].school,schools[0].name);
 assert.deepEqual(searchDirectory(existing,'Rahula Matara',2027),existing);
 const snap={test:{max_cents:4000},group:{exam_year:2027},students:[{id:'student',student_code:'SC/2027/12',is_active:true,linked_ids:['SC/2027/11','SC/2028/4']}],scores:[]};assert.equal(previewOnlineRows([{code:'11',mark:'12 / 40'}],snap)[0].status,'Ready');assert.equal(previewOnlineRows([{code:'SC/2028/4',mark:'12 / 40'}],snap)[0].status,'Invalid');
 const client={rpc:()=>({abortSignal:async()=>({data:schools,error:null})})};assert.deepEqual(await loadSchools(client),schools);
 const old={rpc:()=>({abortSignal:async()=>({error:{code:'PGRST202'}})}),from:()=>({select(){return this;},order(){return this;},range(){return this;},async abortSignal(){return {data:schools,error:null};}})};assert.deepEqual(await loadSchools(old),schools);
});
