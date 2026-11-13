import test from "node:test";
import "./domSetup.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { parseOnlineHTML, onlineRows, checkOnlineTarget, previewOnlineRows } from "../src/onlineImport.js";
import { reportColumns, reportRows, reportHeading, reportFilename, rankingWorkbook, rankingPDF } from "../src/reportExport.js";
import ExcelJS from "exceljs";

test("original HTML-table .xls scores stay text, all districts are included and test mismatches block import",async()=>{
  const source=await parseOnlineHTML('<h4>Marks sheet of : 2027 - Phase 3 - Paper 05 - Sinhala</h4><table><tr><th>ID</th><th>Student Code</th><th>Student Name</th><th>District</th><th>Student School</th><th>Student Mark</th><th>Rank</th></tr><tr><td>1</td><td>SC/2027/005</td><td>A &amp; B</td><td>Ratnapura</td><td>School</td><td>34 / 40</td><td>77</td></tr><tr><td>2</td><td>SC/2027/6</td><td>C</td><td>Matara</td><td>Other</td><td>0 / 40</td><td>1</td></tr></table>');
  const rows=onlineRows(source.matrix),testInfo={phase:"Phase 3",paper:5,max_cents:4000};
  assert.equal(rows[0].mark,"34 / 40");assert.equal(rows[0].name,"A & B");assert.equal(rows.length,2);
  assert.deepEqual(checkOnlineTarget(source.heading,rows,testInfo,2027),[]);
  assert.equal(checkOnlineTarget(source.heading,rows,{phase:"Phase 2",paper:7,max_cents:15000},2028).length,4);
  const result=previewOnlineRows(rows,{test:testInfo,group:{exam_year:2027},students:[],scores:[]});
  assert.deepEqual(result.map(r=>r.status),["Unknown","Skipped"]);assert.equal(result[0].cents,3400);
});

export const sampleReport={id:"sample",title:"Physics - Samitha Rathnayake",exam_year:2028,is_final:true,version:2,creator:"Sasindu",created_at:"2026-11-11T07:30:00Z",layout:"both",include_ids:true,top_n:10,max_cents:19000,
 tests:[{phase:"Phase 1",paper:1,max_cents:4000},{phase:"Phase 1",paper:2,max_cents:15000}],
 rows:[{name:"Student with a long name to check wrapping",school:"A long school name, Matara Central College",student_code:"SC/2028/1",stream:"Maths",scores:[4000,10000],total_cents:14000,rank:1},{name:"Second student",school:"School B",student_code:"SC/2028/2",stream:"Maths",scores:[null,0],total_cents:0,rank:2}]};
test("report downloads preserve exact raw totals, missing vs zero, both streams and both layouts",async()=>{
 const wb=await rankingWorkbook(sampleReport),buffer=await wb.xlsx.writeBuffer(),reopened=new ExcelJS.Workbook();await reopened.xlsx.load(buffer);
 assert.deepEqual(reopened.worksheets.map(s=>s.name),["Maths detailed","Maths summary","Bio detailed","Bio summary"]);
 const s=reopened.worksheets[0];assert.equal(s.getCell("D4").value,40);assert.equal(s.getCell("E4").value,100);assert.equal(s.getCell("F4").value,140);assert.equal(s.getCell("D5").value,"—");assert.equal(s.getCell("E5").value,0);
 assert.deepEqual(reportRows(sampleReport,"Maths","summary",true)[0],["SC/2028/1",sampleReport.rows[0].name,sampleReport.rows[0].school,140,1]);
 const pdf=await rankingPDF(sampleReport,"Maths"),bio=await rankingPDF(sampleReport,"Bio");
 assert.equal(pdf.getNumberOfPages(),2);assert.equal(bio.getNumberOfPages(),2);assert.ok(pdf.output("arraybuffer").byteLength>1000);
 const text=pdf.output(),bioText=bio.output();
 assert.ok(text.includes("Top 10 Maths"));assert.ok(!text.includes("Top 10 Bio"));assert.ok(text.includes("Second student"));
 assert.ok(bioText.includes("Top 10 Bio"));assert.ok(!bioText.includes("Second student"));assert.ok(bioText.includes("No recorded participants in this stream."));
 assert.ok(text.includes("Physics - Samitha Rathnayaka"));assert.ok(bioText.includes("Physics - Samitha Rathnayaka"));assert.ok(text.includes("Version 2"));
 for(const removed of ["Maximum total:","Generated:","including ties","By: Sasindu","A dash means","Summary"]){assert.ok(!text.includes(removed));assert.ok(!bioText.includes(removed));}
 assert.match(reportFilename(sampleReport,"pdf","Maths"),/ Maths Matara\.pdf$/);assert.match(reportFilename(sampleReport,"pdf","Bio"),/ Bio Matara\.pdf$/);
 await assert.rejects(()=>rankingPDF(sampleReport),/Choose Maths, Bio or All/);
 assert.deepEqual(reportHeading({...sampleReport,exam_year:2027,tests:[{phase:"Phase 3",paper:6}],top_n:10},"Maths"),["2027 Phase 3 Paper 6","Top 10 Maths"]);
 assert.deepEqual(reportHeading({...sampleReport,top_n:0},"Bio"),["2028 Phase 1 Paper 1; Phase 1 Paper 2","Full list Bio"]);
 assert.equal(s.getCell("A1").value,"Physics - Samitha Rathnayaka");assert.equal(s.getCell("A2").value,"2028 Phase 1 Paper 1; Phase 1 Paper 2\nTop 10 Maths");
 assert.ok(s.getRow(2).height>=52);assert.equal(s.views[0].ySplit,3);assert.match(s.autoFilter,/^A3:/);assert.equal(s.getCell("A3").value,"Student ID");
});

test("online imports, closure and immutable reports work together with server-side access rules",async()=>{
 const db=new PGlite();const admin="00000000-0000-0000-0000-000000000001",marker="00000000-0000-0000-0000-000000000002";
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create schema app_private;
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
   create table profiles(id uuid primary key,display_name text,role text,is_active boolean);
   create function app_private.is_admin() returns boolean language sql stable as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and is_active) $$;
   create function app_private.is_active_member() returns boolean language sql stable as $$ select exists(select 1 from public.profiles where id=auth.uid() and is_active) $$;
   insert into profiles values('${admin}','Admin','admin',true),('${marker}','Marker','marker',true);set test.uid='${admin}';`);
  for(const f of ['002_shared_students.sql','003_student_management.sql','004_shared_test_marks.sql','005_import_remove_export.sql','006_online_import_reports.sql'])await db.exec(await readFile(new URL(`../supabase/${f}`,import.meta.url),'utf8'));
  const rpc=async(sql,args=[])=>(await db.query(`select ${sql} as result`,args)).rows[0].result;
  const group=(await db.query('select id from exam_groups where exam_year=2028')).rows[0].id;
  const add=async(name,id,stream='Maths')=>(await rpc("app_add_student($1,$2,'School',$3,$4,$5)",[group,name,stream,id,crypto.randomUUID()])).id;
  const a=await add('A','1'), b=await add('B','2'),zero=await add('Zero participant','3'),absent=await add('Absent','4'),bio=await add('Bio student','5','Bio');
  const create=async(paper,max)=>(await rpc("app_create_marks_test($1,'Phase 1',$2,'2026-11-11',$3,$4,$5)",[group,paper,max,[admin,marker],crypto.randomUUID()])).id;
  const t1=await create(1,'40'),t2=await create(2,'150');
  const save=async(t,e,mark,version=0)=>rpc("app_save_test_score($1,$2,$3,$4,$5)",[t,e,mark,version,crypto.randomUUID()]);
  await save(t1,zero,'0');await save(t1,bio,'20');
  const fileRows=[{code:'SC/2028/1',name:'Wrong name',school:'Wrong school',mark:'30 / 40'},{code:'SC/2028/2',mark:'0 / 40'},{code:'SC/2028/99',name:'New',school:'Other',mark:'10 / 40'},{code:'SC/2028/3',mark:'18 / 40'},{code:'SC/2028/8',mark:'Jan-12'}];
  const stage=async(rows,id=crypto.randomUUID(),heading='2028 Phase 1 Paper 1')=>rpc("app_stage_online_import($1,'export.xls',$2,$3,$4)",[t1,heading,JSON.stringify(rows),id]);
  await db.exec(`set test.uid='${marker}'`);await assert.rejects(()=>stage(fileRows),/admins/);await db.exec(`set test.uid='${admin}'`);
  await assert.rejects(()=>stage(fileRows,crypto.randomUUID(),'2027 Phase 1 Paper 1'),/year differs/);
  await assert.rejects(()=>stage([{code:'1',mark:'30 / 150'}]),/denominator/);
  const request=crypto.randomUUID();const batch=await stage(fileRows,request);assert.deepEqual(await stage(fileRows,request),batch);assert.deepEqual(await stage(fileRows),batch);
  let imports=await rpc("app_get_online_imports($1)",[t1]);assert.equal(imports.length,1);assert.deepEqual(imports[0].rows.map(r=>r.status),['Imported','Skipped','Pending','Pending','Pending']);
  let snap=await rpc("app_get_test_workspace($1)",[t1]);assert.equal(snap.pending_online,3);assert.equal(snap.scores.find(s=>s.enrolment_id===a).cents,3000);assert.equal(snap.students.find(s=>s.id===a).name,'A');assert.ok(!snap.scores.some(s=>s.enrolment_id===b));
  await assert.rejects(()=>rpc("app_complete_marks_test($1,'close',$2,'{}',$3)",[t1,snap.test.revision,crypto.randomUUID()]),/pending online/);
  const resolve=async(row,details={},replace=false,version=0,reason='',action='import')=>rpc("app_resolve_online_row($1,$2,$3,$4,$5,$6,$7)",[row.id,action,JSON.stringify(details),replace,version,reason,crypto.randomUUID()]);
  const unknown=imports[0].rows[2],conflict=imports[0].rows[3],bad=imports[0].rows[4];
  assert.equal((await resolve(unknown,{create_student:true,name:'New',school:'Other',stream:'Bio'})).status,'Pending');
  assert.equal((await resolve(unknown,{create_student:true,name:'New',school:'School C',stream:'Bio'})).status,'Imported');
  await assert.rejects(()=>resolve(conflict,{},true,999,'Correct original'),/score changed/);
  assert.equal((await resolve(conflict,{},true,1,'Verified original score')).status,'Imported');
  await assert.rejects(()=>resolve(bad,{},false,0,'','dismiss'),/reason/);
  assert.equal((await resolve(bad,{},false,0,'Original score unavailable','dismiss')).status,'Dismissed');
  await save(t2,a,'100');await save(t2,b,'130');
  const generate=async(ids,top=0)=>rpc("app_generate_report($1,$2,'Physics - Samitha Rathnayake','both',true,$3,$4)",[group,ids,top,crypto.randomUUID()]);
  const provisional=await generate([t1,t2]);const pre=await rpc("app_get_report($1)",[provisional]);assert.equal(pre.is_final,false);assert.equal(pre.max_cents,19000);assert.equal(pre.rows.find(r=>r.id===a).total_cents,13000);assert.equal(pre.rows.find(r=>r.id===b).total_cents,13000);assert.equal(pre.rows.find(r=>r.id===b).rank,1);assert.ok(!pre.rows.some(r=>r.id===absent));
  assert.equal(pre.rows.find(r=>r.id===bio).rank,1); // Separate stream ranks.
  await db.exec(`set test.uid='${marker}'`);await assert.rejects(()=>generate([t1]),/admins/);assert.deepEqual(await rpc("app_list_reports($1)",[group]),[]);await assert.rejects(()=>rpc("app_get_report($1)",[provisional]),/access denied/);await db.exec(`set test.uid='${admin}'`);
  const close=async(t)=>{await db.exec(`set test.uid='${marker}'`);await rpc("app_submit_test_batch($1,0,$2)",[t,crypto.randomUUID()]);await db.exec(`set test.uid='${admin}'`);const p=(await rpc("app_get_test_workspace($1)",[t])).participants.find(p=>p.marker_id===admin);await rpc("app_submit_test_batch($1,$2,$3)",[t,p.batch_revision,crypto.randomUUID()]);let s=await rpc("app_get_test_workspace($1)",[t]);const missing=s.students.filter(e=>!s.scores.some(v=>!v.is_deleted&&v.enrolment_id===e.id)).map(e=>e.id);await rpc("app_complete_marks_test($1,'zero',$2,$3,$4)",[t,s.test.revision,missing,crypto.randomUUID()]);s=await rpc("app_get_test_workspace($1)",[t]);await rpc("app_complete_marks_test($1,'close',$2,'{}',$3)",[t,s.test.revision,crypto.randomUUID()]);};
  await close(t1);await close(t2);
  const final=await generate([t1,t2],1);const frozen=await rpc("app_get_report($1)",[final]);assert.equal(frozen.is_final,true);assert.equal(frozen.rows.filter(r=>r.stream==='Maths').length,2); // Tie at cutoff.
  await db.exec('grant usage on schema auth,app_private to authenticated; grant select on profiles to authenticated; set role authenticated;');
  await assert.rejects(()=>db.query("update saved_reports set title='Changed' where id=$1",[final]),/permission denied/);
  await db.exec(`set test.uid='${marker}'`);
  assert.equal((await db.query('select id from saved_reports where id=$1',[provisional])).rows.length,0);
  assert.equal((await db.query('select id from saved_reports where id=$1',[final])).rows.length,1);
  await db.exec(`reset role; set test.uid='${admin}'`);
  await db.exec(`set test.uid='${marker}'`);assert.equal((await rpc("app_get_report($1)",[final])).is_final,true);assert.equal((await rpc("app_list_reports($1)",[group])).length,1);await db.exec(`set test.uid='${admin}'`);
  snap=await rpc("app_get_test_workspace($1)",[t1]);await rpc("app_complete_marks_test($1,'reopen',$2,'{}',$3)",[t1,snap.test.revision,crypto.randomUUID()]);await save(t1,a,'35',1);
  const unchanged=await rpc("app_get_report($1)",[final]);assert.deepEqual(unchanged.rows,frozen.rows);assert.equal(unchanged.source_changed,true);
  await db.exec(`set test.uid='${marker}'`);assert.equal((await rpc("app_get_report($1)",[final])).is_final,true);await db.exec(`set test.uid='${admin}'`);
  await db.exec(`update profiles set is_active=false where id='${marker}';set test.uid='${marker}';`);await assert.rejects(()=>rpc("app_get_report($1)",[final]),/active account/);
 }finally{await db.close();}
});
