import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {readFile} from 'node:fs/promises';
import {fixture,admin,marker,second} from './adminFixture.js';
import {markerWorkbook,markerFilename} from '../src/workbooks.js';

const batchReader=f=>(testId,markerId)=>f.rpc('app_export_marker_students($1,$2)',[testId,markerId]);
const workbookMark=async(data,code)=>{
 const file=await (await markerWorkbook(data)).xlsx.writeBuffer();
 const book=new ExcelJS.Workbook();await book.xlsx.load(file);
 const rows=book.worksheets[0].getRows(4,data.rows.length)||[];
 return rows.find(r=>r.getCell(2).value===code)?.getCell(6).value;
};

test('markers download submitted open-test entries immediately and freshly after resubmission without storing export data',async()=>{
 const f=await fixture(),{db,rpc,uid,group,add,create}=f,download=batchReader(f);
 try{
  const a=await add(2027,'A student','1'),zero=await add(2027,'Recorded zero','2'),removed=await add(2027,'Removed score','3'),other=await add(2027,'Other marker','4'),online=await add(2027,'Online student','5');await add(2027,'Absent student','6');
  const t=await create(2027,1,[marker,second]);
  const save=(e,text,version=0)=>rpc('app_save_test_score($1,$2,$3,$4,$5)',[t,e,text,version,crypto.randomUUID()]);
  const submit=async()=>{const current=(await db.query('select auth.uid() as id')).rows[0].id;const p=(await rpc('app_get_test_workspace($1)',[t])).participants.find(p=>p.marker_id===current);await rpc('app_submit_test_batch($1,$2,$3)',[t,p.batch_revision,crypto.randomUUID()]);};
  await db.exec('set role authenticated');await uid(marker);
  await save(a,'12.25');await save(zero,'0');await save(removed,'18');await rpc('app_remove_test_score($1,$2,1,$3)',[t,removed,crypto.randomUUID()]);
  await assert.rejects(()=>download(t,marker),/not submitted their latest batch/);
  await assert.rejects(()=>download(t,second),/only your own/);
  await submit();const original=await download(t,marker);
  assert.equal(original.test.status,'Open');assert.deepEqual(original.rows.map(r=>r.cents),[1225,0]);assert.equal(original.submission.revision,4);assert.ok(original.submission.submitted_at);assert.equal(await workbookMark(original,'SC/2027/1'),12.25);
  assert.equal(markerFilename(original.test,original.marker.name),'Phase 1 Paper 1 Marker.xlsx');
  // A different marker has not submitted: this does not block the first download.
  assert.equal((await rpc('app_get_test_workspace($1)',[t])).participants.find(p=>p.marker_id===second).submitted_revision,null);
  const counts=async()=>{await db.exec('reset role');const value=JSON.stringify((await db.query('select (select count(*) from marks_write_requests) as receipts,(select count(*) from saved_reports) as reports,(select count(*) from test_mark_history) as history')).rows);await db.exec('set role authenticated');return value;};
  const before=await counts();await db.exec('begin read only');assert.deepEqual(await download(t,marker),original);await db.exec('rollback');assert.equal(await counts(),before);
  await save(a,'12.75',1);await assert.rejects(()=>download(t,marker),/not submitted their latest batch/);await submit();const updated=await download(t,marker);
  assert.equal(updated.submission.revision,5);assert.equal(await workbookMark(updated,'SC/2027/1'),12.75);assert.equal(await workbookMark(original,'SC/2027/1'),12.25);assert.equal(markerFilename(updated.test,updated.marker.name),markerFilename(original.test,original.marker.name));
  // Existing admin-correction behavior and ownership remain intact.
  await uid(admin);await save(a,'12.90',2);assert.equal((await download(t,marker)).rows[0].cents,1290);assert.equal((await download(t,marker)).submission.revision,5);
  await rpc("app_import_online_file($1,'online.xlsx','2027 Phase 1 Paper 1',$2,$3)",[t,JSON.stringify([{code:'5',mark:'15 / 40'}]),crypto.randomUUID()]);
  await uid(second);await save(other,'20');await submit();await uid(admin);assert.deepEqual((await download(t,second)).rows.map(r=>r.cents),[2000]);
  let s=await rpc('app_get_test_workspace($1)',[t]);const missing=s.students.filter(e=>!s.scores.some(v=>v.enrolment_id===e.id&&!v.is_deleted)).map(e=>e.id);
  await rpc("app_complete_marks_test($1,'zero',$2,$3,$4)",[t,s.test.revision,missing,crypto.randomUUID()]);s=await rpc('app_get_test_workspace($1)',[t]);await rpc("app_complete_marks_test($1,'close',$2,'{}',$3)",[t,s.test.revision,crypto.randomUUID()]);
  await uid(marker);const closed=await download(t,marker);assert.equal(closed.test.status,'Closed');assert.deepEqual(closed.rows.map(r=>r.cents),[1290,0]);assert.ok(!closed.rows.some(r=>r.student_code==='SC/2027/5'));assert.equal(await workbookMark(closed,'SC/2027/1'),12.9);
  await uid(admin);await rpc('app_set_group_archived($1,true)',[group(2027)]);await uid(marker);assert.deepEqual((await download(t,marker)).rows,closed.rows);
  await uid(admin);await rpc('app_set_group_archived($1,false)',[group(2027)]);s=await rpc('app_get_test_workspace($1)',[t]);await rpc("app_complete_marks_test($1,'reopen',$2,'{}',$3)",[t,s.test.revision,crypto.randomUUID()]);await uid(marker);assert.equal((await download(t,marker)).test.status,'Open');
  await save(a,'13',3);await assert.rejects(()=>download(t,marker),/not submitted their latest batch/);
 }finally{await db.close();}
});

test('submitted downloads support empty batches and enforce active accounts, participation, cancellation and grants',async()=>{
 const f=await fixture(),{db,rpc,uid,create}=f,download=batchReader(f);
 try{
  const t=await create(2027,1,[admin,marker]);await db.exec('set role authenticated');
  await assert.rejects(()=>download(t,admin),/not submitted their latest batch/);await assert.rejects(()=>download(t,second),/not a participant/);
  await rpc('app_submit_test_batch($1,0,$2)',[t,crypto.randomUUID()]);const empty=await download(t,admin);assert.deepEqual(empty.rows,[]);assert.equal(empty.submission.revision,0);const wb=await markerWorkbook(empty);assert.equal(wb.worksheets[0].rowCount,3);assert.match(wb.worksheets[0].getCell('A2').value,/Batch revision: 0/);
  await uid(marker);await rpc('app_submit_test_batch($1,0,$2)',[t,crypto.randomUUID()]);assert.deepEqual((await download(t,marker)).rows,[]);await uid(second);await assert.rejects(()=>download(t,second),/not a participant/);
  await db.exec('reset role');await db.query('update profiles set is_active=false where id=$1',[marker]);await uid(marker);await db.exec('set role authenticated');await assert.rejects(()=>download(t,marker),/active account/);await db.exec('reset role');await db.query('update profiles set is_active=true where id=$1',[marker]);await uid(admin);await db.exec('set role authenticated');
  const s=await rpc('app_get_test_workspace($1)',[t]);await rpc("app_complete_marks_test($1,'cancel',$2,'{}',$3)",[t,s.test.revision,crypto.randomUUID()]);await assert.rejects(()=>download(t,admin),/Cancelled tests/);
  await db.exec('reset role;set role anon');await assert.rejects(()=>download(t,admin),/permission denied/);await db.exec('reset role');
  const history=(await db.query('select count(*) from test_mark_history')).rows[0].count;
  await db.exec(await readFile(new URL('../supabase/014_submitted_marker_downloads.sql',import.meta.url),'utf8'));assert.equal((await db.query('select count(*) from test_mark_history')).rows[0].count,history);
 }finally{await db.close();}
});
