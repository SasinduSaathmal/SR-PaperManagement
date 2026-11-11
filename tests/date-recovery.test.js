import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";
import ExcelJS from "exceljs";
import "./domSetup.js";
import {dateCellValue,recoveryCandidate,recoverDateMarks} from "../src/dateMarkRecovery.js";
import {readOnlineFile,onlineRows,parseOnlineHTML} from "../src/onlineImport.js";
import {moduleLoadMessage} from "../src/moduleLoading.js";

const conversion=(month,maximum=40)=>({kind:"excel-date",year:1940,month,day:1,format:"mmm-yy",maximum,confirmed:true});
test("Excel month/year scores are recovered only after explicit confirmation and a matching maximum",()=>{
 const row={mark_date:dateCellValue(new Date(Date.UTC(1940,11,1)),"mmm-yy"),mark:"Excel date"};
 assert.equal(recoveryCandidate(row,4000).mark,"12 / 40");
 assert.equal(recoverDateMarks([row],4000,false)[0].mark,"Excel date");
 const recovered=recoverDateMarks([row],4000,true)[0];assert.equal(recovered.mark,"12 / 40");assert.equal(recovered.mark_conversion.confirmed,true);assert.match(recovered.mark_original,/Dec-40/);
 assert.equal(recoveryCandidate({mark:"Nov-40"},4000).mark,"11 / 40");assert.equal(recoveryCandidate({mark:"Oct-40"},4000).mark,"10 / 40");
 assert.equal(recoveryCandidate(row,15000),null);assert.equal(recoveryCandidate({mark:"Dec-12"},1200),null);
 assert.equal(recoveryCandidate({mark:"Jan-27"},4000),null);
 assert.equal(recoveryCandidate({mark_date:dateCellValue(new Date(Date.UTC(1940,11,15)),"mmm-yy"),mark:"x"},4000),null);
 assert.equal(recoveryCandidate({mark_date:dateCellValue(new Date(Date.UTC(1940,11,1)),"dd/mm/yyyy"),mark:"x"},4000),null);
});
test("online XLSX reads preserve dates and provenance in both Excel date systems; formula cells remain blocked",async()=>{
 for(const date1904 of [false,true]){
  const wb=new ExcelJS.Workbook();wb.properties.date1904=date1904;const s=wb.addWorksheet("Marks");s.addRow(["Student Code","Student Name","Student School","Student Mark"]);
  s.addRow(["SC/2027/1","A","School",new Date(Date.UTC(1940,11,1))]);s.getCell("D2").numFmt="mmm-yy";
  s.addRow(["SC/2027/2","B","School",new Date(Date.UTC(2040,10,1))]);s.getCell("D3").numFmt="mmm-yy";
  s.addRow(["SC/2027/3","C","School",{formula:'12/40',result:0.3}]);
  const bytes=await wb.xlsx.writeBuffer(), file={name:"online.xlsx",size:bytes.length,arrayBuffer:async()=>bytes};
  const rows=onlineRows((await readOnlineFile(file)).matrix);
  assert.match(rows[0].mark,/Dec-40/);assert.equal(rows[0].mark_date.year,1940);
  const restored=recoverDateMarks(rows,4000,true);assert.equal(restored[0].mark,"12 / 40");assert.equal(restored[1].mark,"11 / 40");assert.match(restored[2].mark,/Unsupported/);
 }
 const html=await parseOnlineHTML('<table><tr><th>Student Code</th><th>Student Mark</th></tr><tr><td>SC/2027/1</td><td>12 / 40</td></tr></table>');assert.equal(html.matrix[1][1],"12 / 40");
});
test("missing deployment modules give a safe manual reload instruction, while ordinary errors are preserved",()=>{
 assert.match(moduleLoadMessage(Error('Failed to fetch dynamically imported module: https://example/old.js')),/Refresh the website/);
 assert.equal(moduleLoadMessage(Error('Invalid file')), 'Invalid file');
});
test("confirmed recovery repairs old pending rows without duplicate unknowns or overwriting existing marks",async()=>{
 const db=new PGlite();const admin='00000000-0000-0000-0000-000000000001',marker='00000000-0000-0000-0000-000000000002';
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create schema app_private;
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
   create table profiles(id uuid primary key,display_name text,role text,is_active boolean);
   create function app_private.is_admin() returns boolean language sql stable as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and is_active) $$;
   create function app_private.is_active_member() returns boolean language sql stable as $$ select exists(select 1 from public.profiles where id=auth.uid() and is_active) $$;
   insert into profiles values('${admin}','Admin','admin',true),('${marker}','Marker','marker',true);set test.uid='${admin}';`);
  for(const f of ['002_shared_students.sql','003_student_management.sql','004_shared_test_marks.sql','005_import_remove_export.sql','006_online_import_reports.sql','007_zero_fill_empty_batches.sql','008_online_date_recovery.sql'])await db.exec(await readFile(new URL(`../supabase/${f}`,import.meta.url),'utf8'));
  const rpc=async(sql,args=[])=>(await db.query(`select ${sql} as result`,args)).rows[0].result;
  const group=(await db.query('select id from exam_groups where exam_year=2027')).rows[0].id;
  const add=async(id)=>(await rpc("app_add_student($1,$2,'School','Maths',$3,$4)",[group,`Student ${id}`,String(id),crypto.randomUUID()])).id;
  const a=await add(1);await add(3);
  const create=async(paper)=>(await rpc("app_create_marks_test($1,'Phase 1',$2,'2026-11-11','40',$3,$4)",[group,paper,[admin],crypto.randomUUID()])).id;
  const tid=await create(1);
  const raw=[{code:'SC/2027/1',name:'A',school:'School',mark:'[Unsupported cell: replace with plain text]'},{code:'SC/2027/2',name:'B',school:'School B',mark:'[Unsupported cell: replace with plain text]'},{code:'SC/2027/3',mark:'20 / 40'}];
  await rpc("app_stage_online_import($1,'old.xlsx','2027 Phase 1 Paper 1',$2,$3)",[tid,JSON.stringify(raw),crypto.randomUUID()]);
  const recovered=[{...raw[0],mark:'12 / 40',mark_original:'Dec-40',mark_conversion:conversion(12)},{...raw[1],mark:'11 / 40',mark_original:'Nov-40',mark_conversion:conversion(11)},raw[2]];
  const importFile=(rows,id=crypto.randomUUID(),t=tid,heading='2027 Phase 1 Paper 1')=>rpc('app_import_online_file($1,$2,$3,$4,$5)',[t,'online.xlsx',heading,JSON.stringify(rows),id]);
  await db.exec(`set test.uid='${marker}'`);await assert.rejects(()=>importFile(recovered),/admins/);await db.exec(`set test.uid='${admin}'`);
  await assert.rejects(()=>importFile([{...recovered[0],mark_conversion:{...conversion(12),confirmed:false}}]),/explicitly confirmed/);
  await assert.rejects(()=>importFile([{...recovered[0],mark_conversion:{...conversion(12),day:2}}]),/explicitly confirmed/);
  await assert.rejects(()=>importFile([recovered[0],recovered[0]]),/duplicate student/);
  const request=crypto.randomUUID(),result=await importFile(recovered,request);assert.equal(result.recovered_pending,2);assert.deepEqual(await importFile(recovered,request),result);
  let s=await rpc('app_get_test_workspace($1)',[tid]);assert.equal(s.pending_online,1);assert.equal(s.scores.find(v=>v.enrolment_id===a).cents,1200);
  let batches=await rpc('app_get_online_imports($1)',[tid]);const pending=batches.flatMap(b=>b.rows).filter(r=>r.status==='Pending');assert.equal(pending.length,1);assert.equal(pending[0].raw.mark,'11 / 40');assert.equal(pending[0].raw.mark_original,'Nov-40');assert.match(pending[0].raw.previous_mark,/Unsupported/);
  await importFile(recovered);batches=await rpc('app_get_online_imports($1)',[tid]);assert.equal(batches.flatMap(b=>b.rows).filter(r=>r.status==='Pending').length,1);assert.equal(batches.length,2);
  await rpc("app_resolve_online_row($1,'import',$2,false,0,'',$3)",[pending[0].id,JSON.stringify({create_student:true,name:'B',school:'School B',stream:'Bio'}),crypto.randomUUID()]);
  assert.equal((await rpc('app_get_test_workspace($1)',[tid])).pending_online,0);
  const t2=await create(2);await rpc("app_stage_online_import($1,'bad.xlsx','2027 Phase 1 Paper 2',$2,$3)",[t2,JSON.stringify([raw[0]]),crypto.randomUUID()]);await rpc("app_save_test_score($1,$2,'25',0,$3)",[t2,a,crypto.randomUUID()]);
  await importFile([recovered[0]],crypto.randomUUID(),t2,'2027 Phase 1 Paper 2');s=await rpc('app_get_test_workspace($1)',[t2]);assert.equal(s.scores[0].cents,2500);assert.equal(s.pending_online,1);
  const t3=await create(3);await rpc("app_stage_online_import($1,'old.xlsx','2027 Phase 1 Paper 3',$2,$3)",[t3,JSON.stringify([raw[0]]),crypto.randomUUID()]);
  await importFile([{...raw[0],mark:'14 / 40'}],crypto.randomUUID(),t3,'2027 Phase 1 Paper 3');s=await rpc('app_get_test_workspace($1)',[t3]);assert.equal(s.pending_online,0);assert.equal(s.scores[0].cents,1400);
 }finally{await db.close();}
});
