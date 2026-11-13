import test from 'node:test';
import assert from 'node:assert/strict';
import {rankingPDF,reportFilename,REPORT_BRAND} from '../src/reportExport.js';
const report={title:'Saved report name',exam_year:2027,top_n:10,tests:[{phase:'Phase 3',paper:9,max_cents:4000}],layout:'both',include_ids:false,version:4,is_final:true,
 rows:[{name:'Maths participant',school:'School A',stream:'Maths',total_cents:2825,scores:[2825],rank:1},{name:'Bio participant',school:'School B',stream:'Bio',total_cents:2700,scores:[2700],rank:1}]};

test('single-paper PDFs fill the centered portrait page and the combined file has both headed streams without duplicated layouts',async()=>{
 const maths=await rankingPDF(report,'Maths'),bio=await rankingPDF(report,'Bio'),all=await rankingPDF(report,'All');
 assert.equal(maths.getNumberOfPages(),1);assert.equal(bio.getNumberOfPages(),1);assert.equal(all.getNumberOfPages(),2);
 assert.ok(maths.output().includes('Maths participant'));assert.ok(!maths.output().includes('Bio participant'));
 assert.ok(bio.output().includes('Bio participant'));assert.ok(!bio.output().includes('Maths participant'));
 assert.ok(all.output().includes('Maths participant'));assert.ok(all.output().includes('Bio participant'));assert.ok(all.output().includes('28.25'));
 assert.ok(all.internal.pages[1].join('\n').includes('Top 10 Maths'));assert.ok(all.internal.pages[2].join('\n').includes('Top 10 Bio'));
 for(const pdf of [maths,bio,all]){
  const width=pdf.internal.pageSize.getWidth(),height=pdf.internal.pageSize.getHeight(),table=pdf.lastAutoTable;
  assert.ok(height>width);const cells=Object.values(table.head[0].cells),left=Math.min(...cells.map(c=>c.x)),right=Math.max(...cells.map(c=>c.x+c.width));
  assert.ok(Math.abs(left-(width-right))<0.01,'equal page margins');assert.ok(Math.abs((right-left)-(width-30))<0.01,'table fills page width');
  assert.ok(table.head[0].cells[0].styles.fontSize>=10);assert.ok(table.finalY<height-17);
  assert.ok(pdf.output().includes(REPORT_BRAND));assert.ok(!pdf.output().includes('Maximum total:'));assert.ok(!pdf.output().includes('A dash means'));
 }
 assert.equal(reportFilename(report,'pdf','All'),'2027 Phase 3 Paper 9 Top 10 All Matara.pdf');
 assert.equal(reportFilename(report,'pdf','Bio'),'2027 Phase 3 Paper 9 Top 10 Bio Matara.pdf');
 assert.equal(reportFilename(report,'pdf','Maths'),'2027 Phase 3 Paper 9 Top 10 Maths Matara.pdf');
 assert.equal(reportFilename({...report,top_n:25,exam_year:2028,tests:[{phase:'2',paper:3}]},'pdf','All'),'2028 Phase 2 Paper 3 Top 25 All Matara.pdf');
 assert.equal(reportFilename({...report,top_n:0},'pdf','All'),'2027 Phase 3 Paper 9 Full list All Matara.pdf');
 assert.equal(reportFilename(report,'xlsx'),'2027 Saved report name Top 10 v4.xlsx');
 await assert.rejects(()=>rankingPDF(report,'Unknown'),/Choose Maths, Bio or All/);assert.throws(()=>reportFilename(report,'pdf','Unknown'),/Choose Maths, Bio or All/);
});

test('long full-list and wide combined reports paginate while preserving headings, IDs and raw totals',async()=>{
 const long={...report,layout:'summary',top_n:0,include_ids:true,rows:Array.from({length:65},(_,i)=>({name:`Participant ${i+1} with a long name to exercise wrapped text`,school:'A school name long enough to require wrapping in the school column',student_code:`SC/2027/${i+1}`,stream:'Bio',total_cents:2500+i,rank:i+1}))};
 const full=await rankingPDF(long,'Bio');assert.ok(full.getNumberOfPages()>1);assert.ok(full.output().includes('SC/2027/65'));assert.ok(full.output().includes('25.64'));assert.equal(full.output().split(REPORT_BRAND).length-1,full.getNumberOfPages());
 const wide={...report,include_ids:true,layout:'detailed',tests:Array.from({length:12},(_,i)=>({phase:'Phase 1',paper:i+1,max_cents:4000})),rows:report.rows.map((r,i)=>({...r,student_code:`SC/2027/${i+1}`,scores:Array(12).fill(2500),total_cents:30000}))};
 const combined=await rankingPDF(wide,'All');assert.ok(combined.getNumberOfPages()>2);assert.ok(combined.output().includes('Top 10 Maths'));assert.ok(combined.output().includes('Top 10 Bio'));assert.ok(combined.output().includes('Paper 12'));assert.ok(combined.output().includes('300'));assert.ok(combined.output().includes('SC/2027/2'));
});
