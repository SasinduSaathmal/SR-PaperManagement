import test from "node:test";
import "./domSetup.js";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";
import {parseOnlineHTML,readOnlineFile} from "../src/onlineImport.js";

test("Excel frameset exports explain the missing sheet; companion tables still import",async()=>{
 const index='<html><head><meta name="Excel Workbook Frameset"><link id="shLink" href="export_files/sheet001.htm"></head><frameset><frame src="export_files/sheet001.htm"></frameset></html>';
 await assert.rejects(()=>parseOnlineHTML(index),/_files\/sheet001.htm/);
 const file={name:'export.xls',size:index.length,arrayBuffer:async()=>new TextEncoder().encode(index).buffer};
 await assert.rejects(()=>readOnlineFile(file),/index alone contains no student marks/);
 const sheet=await parseOnlineHTML('<table><tr><td>Student Code</td><td>Student Mark</td></tr><tr><td>SC/2027/1</td><td>12 / 40</td></tr></table>');
 assert.deepEqual(sheet.matrix[1],['SC/2027/1','12 / 40']);
});

test("edited zero fills are attributed correctly and no-paper markers do not block completion",async()=>{
 const db=new PGlite();
 const admin='00000000-0000-0000-0000-000000000001',a='00000000-0000-0000-0000-000000000002',b='00000000-0000-0000-0000-000000000003';
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create schema app_private;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create table profiles(id uuid primary key,display_name text,role text,is_active boolean);
    create function app_private.is_admin() returns boolean language sql stable as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and is_active) $$;
    create function app_private.is_active_member() returns boolean language sql stable as $$ select exists(select 1 from public.profiles where id=auth.uid() and is_active) $$;
    insert into profiles values('${admin}','Admin','admin',true),('${a}','Marker A','marker',true),('${b}','Marker B','marker',true);`);
  const migrate=async name=>db.exec(await readFile(new URL(`../supabase/${name}`,import.meta.url),'utf8'));
  for(const file of ['002_shared_students.sql','003_student_management.sql','004_shared_test_marks.sql','005_import_remove_export.sql','006_online_import_reports.sql'])await migrate(file);
  const as=async id=>db.exec(`set test.uid='${id}'`);
  const rpc=async(sql,args=[])=>(await db.query(`select ${sql} as result`,args)).rows[0].result;
  await as(admin);const group=(await db.query('select id from exam_groups where exam_year=2027')).rows[0].id;
  const students=[];for(let i=1;i<=3;i++)students.push((await rpc("app_add_student($1,$2,'School','Maths',$3,$4)",[group,`Student ${i}`,String(i),crypto.randomUUID()])).id);
  const create=async(paper,markers)=>(await rpc("app_create_marks_test($1,'Phase 1',$2,'2026-11-11','150',$3,$4)",[group,paper,markers,crypto.randomUUID()])).id;
  const snap=t=>rpc('app_get_test_workspace($1)',[t]);
  const save=async(t,s,mark,version=0)=>rpc('app_save_test_score($1,$2,$3,$4,$5)',[t,s,mark,version,crypto.randomUUID()]);
  const submit=async(t,id)=>{await as(id);const p=(await snap(t)).participants.find(p=>p.marker_id===id);return rpc('app_submit_test_batch($1,$2,$3)',[t,p.batch_revision,crypto.randomUUID()]);};
  const complete=async(t,action)=>{await as(admin);const s=await snap(t);const missing=s.students.filter(e=>e.is_active&&!s.scores.some(v=>!v.is_deleted&&v.enrolment_id===e.id)).map(e=>e.id);return rpc('app_complete_marks_test($1,$2,$3,$4,$5)',[t,action,s.test.revision,missing,crypto.randomUUID()]);};
  // Reproduce the deployed bug, then prove the repair changes attribution only.
  const historic=await create(1,[a,b]);await as(a);await save(historic,students[0],'50');await submit(historic,a);await submit(historic,b); // Empty self-submission already works.
  await complete(historic,'zero');await complete(historic,'close');await complete(historic,'reopen');await as(admin);await save(historic,students[1],'12',1);await complete(historic,'close');
  const before=await snap(historic);const broken=before.scores.find(s=>s.enrolment_id===students[1]);assert.equal(broken.source,'Zero fill');assert.equal(broken.marker_id,null);
  const reportId=await rpc("app_generate_report($1,$2,'Report','both',true,0,$3)",[group,[historic],crypto.randomUUID()]);const reportBefore=await rpc('app_get_report($1)',[reportId]);
  await migrate('007_zero_fill_empty_batches.sql');
  const repaired=await snap(historic), fixed=repaired.scores.find(s=>s.enrolment_id===students[1]);assert.equal(fixed.cents,1200);assert.equal(fixed.source,'Paper');assert.equal(fixed.marker_id,admin);assert.equal(fixed.version,broken.version+1);assert.equal(repaired.test.status,'Closed');assert.deepEqual(repaired.participants,before.participants);
  assert.deepEqual((await rpc('app_get_report($1)',[reportId])).rows,reportBefore.rows);
  await migrate('007_zero_fill_empty_batches.sql');assert.equal((await snap(historic)).scores.find(s=>s.enrolment_id===students[1]).version,fixed.version); // Repair reruns safely.
  await complete(historic,'reopen');await as(admin);await save(historic,students[2],'42',1);assert.equal((await snap(historic)).scores.find(s=>s.enrolment_id===students[2]).marker_id,admin); // Non-participating admins can correct placeholders.
  await complete(historic,'close');
  const t=await create(2,[admin,a,b]);await save(t,students[0],'50');await submit(t,admin);
  const confirm=(id,rev=0,request=crypto.randomUUID())=>rpc('app_confirm_empty_marker_batch($1,$2,$3,$4)',[t,id,rev,request]);
  await as(a);await assert.rejects(()=>confirm(b),/admins/);await as(admin);await assert.rejects(()=>confirm(admin,1),/recorded work/);await assert.rejects(()=>confirm(b,99),/batch changed/);
  const request=crypto.randomUUID();assert.deepEqual(await confirm(b,0,request),{submitted:true,empty:true});assert.deepEqual(await confirm(b,0,request),{submitted:true,empty:true});
  await submit(t,a);await complete(t,'zero');await complete(t,'close');await complete(t,'reopen');await as(admin);await save(t,students[1],'32',1);
  let s=await snap(t);assert.equal(s.scores.find(v=>v.enrolment_id===students[1]).source,'Paper');assert.equal(s.scores.find(v=>v.enrolment_id===students[1]).marker_id,admin);const batch=s.participants.find(p=>p.marker_id===admin);assert.notEqual(batch.batch_revision,batch.submitted_revision);
  await assert.rejects(()=>complete(t,'close'),/submit their latest/);
  await as(b);await assert.rejects(()=>save(t,students[2],'20',1),/another marker or an admin zero-fill/);await assert.rejects(()=>save(t,students[0],'20',1),/another marker/);
  await as(admin);await rpc("app_stage_online_import($1,'test.xls','2027 Phase 1 Paper 2',$2,$3)",[t,JSON.stringify([{code:'3',mark:'24 / 150'}]),crypto.randomUUID()]);
  const pending=(await rpc('app_get_online_imports($1)',[t]))[0].rows[0];assert.equal(pending.status,'Pending');await rpc("app_resolve_online_row($1,'import','{}',true,1,'Verified online original',$2)",[pending.id,crypto.randomUUID()]);
  s=await snap(t);const online=s.scores.find(v=>v.enrolment_id===students[2]);assert.equal(online.source,'Online');assert.equal(online.marker_id,null);assert.equal(online.cents,2400);
  await submit(t,admin);await complete(t,'close');const exported=await rpc('app_export_marker_students($1,$2)',[t,admin]);assert.equal(exported.rows.length,2);assert.ok(exported.rows.some(row=>row.cents===3200));
  // Deleted work must never be bypassed by the admin no-papers action.
  const t3=await create(3,[a,b]);await as(a);await save(t3,students[0],'8');await rpc('app_remove_test_score($1,$2,1,$3)',[t3,students[0],crypto.randomUUID()]);await as(admin);
  await assert.rejects(()=>rpc('app_confirm_empty_marker_batch($1,$2,2,$3)',[t3,a,crypto.randomUUID()]),/recorded work/);
 }finally{await db.close();}
});
