import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import ExcelJS from 'exceljs';
import {fixture,admin,marker,second} from './adminFixture.js';
import {markerFilename,markerWorkbook} from '../src/workbooks.js';
import {rankingWorkbook,rankingPDF} from '../src/reportExport.js';
import {compareInventories} from '../scripts/compare-backups.mjs';

test('current schema: two markers close two papers, export exact tied rankings, and recover the saved database',async()=>{
  const {db,rpc,uid,group,add}=await fixture();let restored;
  try {
    await db.exec('create table auth.identities(id uuid primary key,user_id uuid references auth.users(id),provider text)');
    const a=await add(2028,'A','1'),b=await add(2028,'B','2'),zero=await add(2028,'Recorded zero','3');
    const bio=(await rpc("app_add_student($1,'Bio student','School','Bio','4',$2)",[group(2028),crypto.randomUUID()])).id;
    const absent=await add(2028,'Absent','5');
    const create=max=>rpc("app_create_marks_test($1,'Phase 1',$2,'2026-11-11',$3,$4,$5)",[group(2028),max==='40'?1:2,max,[marker,second],crypto.randomUUID()]);
    // Exercise the real database role grants as well as the profile-level checks.
    await db.exec('set role authenticated');
    const t1=(await create('40')).id,t2=(await create('150')).id;
    const save=async(person,t,id,mark)=>{
      await uid(person);
      await rpc('app_save_test_score($1,$2,$3,0,$4)',[t,id,mark,crypto.randomUUID()]);
    };
    await save(marker,t1,a,'30.25');await save(marker,t1,zero,'0');
    await save(second,t1,b,'20.25');await save(second,t1,bio,'35');
    await save(marker,t2,a,'100');await save(second,t2,b,'110');await save(second,t2,bio,'90');
    for (const t of [t1,t2]) {
      await uid(marker);
      await assert.rejects(()=>rpc('app_export_marker_students($1,$2)',[t,marker]),/not submitted their latest batch/);
      for (const person of [marker,second]) {
        await uid(person);const s=await rpc('app_get_test_workspace($1)',[t]);
        const p=s.participants.find(p=>p.marker_id===person);
        await rpc('app_submit_test_batch($1,$2,$3)',[t,p.batch_revision,crypto.randomUUID()]);
      }
      await uid(admin);let s=await rpc('app_get_test_workspace($1)',[t]);
      const missing=s.students.filter(e=>!s.scores.some(v=>!v.is_deleted&&v.enrolment_id===e.id)).map(e=>e.id);
      await rpc("app_complete_marks_test($1,'zero',$2,$3,$4)",[t,s.test.revision,missing,crypto.randomUUID()]);
      s=await rpc('app_get_test_workspace($1)',[t]);
      await rpc("app_complete_marks_test($1,'close',$2,'{}',$3)",[t,s.test.revision,crypto.randomUUID()]);
      await assert.rejects(()=>rpc("app_save_test_score($1,$2,'1',0,$3)",[t,absent,crypto.randomUUID()]),/not open/);
    }
    await uid(marker);const batch=await rpc('app_export_marker_students($1,$2)',[t1,marker]);
    assert.equal(markerFilename(batch.test,batch.marker.name),'Phase 1 Paper 1 Marker.xlsx');
    assert.deepEqual(batch.rows.map(r=>r.cents),[3025,0]);
    await assert.rejects(()=>rpc('app_export_marker_students($1,$2)',[t1,second]),/only your own/);
    const markerExcel=new ExcelJS.Workbook();await markerExcel.xlsx.load(await (await markerWorkbook(batch)).xlsx.writeBuffer());
    assert.equal(markerExcel.worksheets[0].getCell('F4').value,30.25);
    assert.equal(markerExcel.worksheets[0].getCell('F5').value,0);
    await uid(admin);
    const reportId=await rpc("app_generate_report($1,$2,'Innovative Physics','both',true,1,$3)",[group(2028),[t1,t2],crypto.randomUUID()]);
    await uid(marker);const report=await rpc('app_get_report($1)',[reportId]);
    assert.equal(report.is_final,true);assert.equal(report.max_cents,19000);
    assert.deepEqual(report.rows.filter(r=>r.stream==='Maths').map(r=>[r.id,r.total_cents,r.rank]),[[a,13025,1],[b,13025,1]]);
    assert.deepEqual(report.rows.find(r=>r.stream==='Bio').scores,[3500,9000]);
    const excel=new ExcelJS.Workbook();await excel.xlsx.load(await (await rankingWorkbook(report)).xlsx.writeBuffer());
    assert.equal(excel.getWorksheet('Maths detailed').getCell('F7').value,130.25);
    assert.equal(excel.getWorksheet('Maths detailed').getCell('G8').value,1);
    assert.equal(excel.getWorksheet('Bio summary').getCell('D7').value,125);
    assert.ok((await rankingPDF(report)).output('arraybuffer').byteLength>1000);
    await db.exec('reset role');
    const inventorySQL=await readFile(new URL('../supabase/checks/backup_inventory.sql',import.meta.url),'utf8');
    const inventory=async database=>JSON.parse((await database.exec(inventorySQL)).find(r=>r.rows?.[0]?.inventory).rows[0].inventory);
    const before=await inventory(db);
    // PGlite data-directory rehearsal, NOT a hosted Supabase CLI restore.
    restored=new PGlite({loadDataDir:await db.dumpDataDir()});
    assert.deepEqual(compareInventories(before,await inventory(restored)),[]);
    await restored.exec(await readFile(new URL('../supabase/checks/restore_readiness.sql',import.meta.url),'utf8'));
    await restored.exec(`set test.uid='${marker}';set test.jwt_role='authenticated';set role authenticated`);
    const recovered=(await restored.query('select app_get_report($1) as report',[reportId])).rows[0].report;
    assert.deepEqual(recovered,report);
    const recoveredBatch=(await restored.query('select app_export_marker_students($1,$2) as batch',[t1,marker])).rows[0].batch;
    assert.deepEqual(recoveredBatch,batch);
  } finally {if(restored)await restored.close();await db.close();}
});
