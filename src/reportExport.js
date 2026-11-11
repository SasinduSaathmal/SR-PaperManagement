import { excel, saveDownload } from "./workbooks.js";
import { formatMark } from "./domain.js";

export const layoutsOf = report => report.layout === "both" ? ["detailed", "summary"] : [report.layout];
export function reportColumns(report, layout) {
  return [...(report.include_ids ? ["Student ID"] : []), "Name", "School", ...(layout === "detailed" && report.tests.length > 1 ? report.tests.map(t => `${t.phase} Paper ${t.paper} / ${formatMark(t.max_cents)}`) : []), report.tests.length === 1 ? "Marks" : "Total", "Rank"];
}
export function reportRows(report, stream, layout, numeric = false) {
  const value = cents => cents == null ? "—" : numeric ? cents / 100 : formatMark(cents);
  return report.rows.filter(r => r.stream === stream).map(r => [...(report.include_ids ? [r.student_code] : []), r.name, r.school,
    ...(layout === "detailed" && report.tests.length > 1 ? r.scores.map(value) : []), value(r.total_cents), r.rank]);
}
export function reportFilename(report, extension) {
  const safe = report.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "").slice(0,120);
  return `${report.exam_year} ${safe} ${report.top_n ? `Top ${report.top_n}` : "Full list"} v${report.version}.${extension}`;
}
const context = (report,stream,layout) => `${report.exam_year} · ${stream} · ${layout === "detailed" ? "Detailed" : "Summary"} · ${report.top_n ? `Top ${report.top_n} (including ties)` : "Full list"} · ${report.is_final ? "Final" : "Provisional"} · Version ${report.version}`;
const generated = report => new Date(report.created_at).toLocaleString("en-GB",{timeZone:"Asia/Colombo"});

export async function rankingWorkbook(report) {
  const ExcelJS = await excel(), workbook = new ExcelJS.Workbook();
  workbook.creator = report.creator; workbook.created = new Date(report.created_at);
  for (const stream of ["Maths","Bio"]) for (const layout of layoutsOf(report)) {
    const sheet = workbook.addWorksheet(`${stream} ${layout}`), headers = reportColumns(report,layout), count = headers.length;
    const tests = report.tests.map(t => `${t.phase}, Paper ${t.paper} (${formatMark(t.max_cents)} marks)`).join("; ");
    for (const line of [report.title, context(report,stream,layout), `Maximum total: ${formatMark(report.max_cents)} | Generated: ${generated(report)} (Asia/Colombo) | By: ${report.creator}`, tests, "A dash means no recorded score and contributes zero. Recorded zeroes count as participation."]) { const row = sheet.addRow([line]); sheet.mergeCells(row.number,1,row.number,count); row.alignment={wrapText:true,vertical:"middle"}; row.height = Math.max(24,Math.ceil(line.length / Math.max(90,count*16))*14); }
    sheet.getRow(1).font={bold:true,size:16}; sheet.getRow(1).height=Math.max(36,sheet.getRow(1).height);
    const header=sheet.addRow(headers); header.font={bold:true,color:{argb:"FFFFFFFF"}}; header.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF087E8B"}};header.height=44;header.alignment={wrapText:true,vertical:"middle"};
    reportRows(report,stream,layout,true).forEach(values => { const row=sheet.addRow(values);row.alignment={wrapText:true,vertical:"top"}; row.height=32; });
    headers.forEach((h,i)=>{const col=sheet.getColumn(i+1);col.width=h==="Student ID"?27:h==="Name"?34:h==="School"?44:h==="Rank"?9:16;if(!["Student ID","Name","School","Rank"].includes(h))col.numFmt="0.##";});
    sheet.views=[{state:"frozen",ySplit:6,xSplit:report.include_ids?2:1}];sheet.autoFilter={from:{row:6,column:1},to:{row:Math.max(6,sheet.rowCount),column:count}};
    sheet.pageSetup={orientation:layout==="detailed"?"landscape":"portrait",paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0};
  }
  return workbook;
}

export async function rankingPDF(report) {
  const [{jsPDF},{autoTable}] = await Promise.all([import("jspdf"),import("jspdf-autotable")]);
  const pdf = new jsPDF({orientation:report.layout==="summary"?"portrait":"landscape",unit:"mm",format:"a4"});
  let first=true;
  for (const stream of ["Maths","Bio"]) for (const layout of layoutsOf(report)) {
    if (!first) pdf.addPage(); first=false;
    const pageWidth=pdf.internal.pageSize.getWidth(), usable=pageWidth-24;
    pdf.setFont("helvetica","bold");pdf.setFontSize(14);
    const titleLines=pdf.splitTextToSize(report.title,usable);
    pdf.setFont("helvetica","normal");pdf.setFontSize(8);
    const metadata=pdf.splitTextToSize(context(report,stream,layout).replaceAll("·","|"),usable);
    const info=pdf.splitTextToSize(`Maximum total: ${formatMark(report.max_cents)} | Generated: ${generated(report)} (Asia/Colombo) | By: ${report.creator}`,usable);
    const tests=pdf.splitTextToSize(report.tests.map(t=>`${t.phase} Paper ${t.paper} / ${formatMark(t.max_cents)}`).join("; "),usable);
    const top=12+titleLines.length*6+metadata.length*4+info.length*4+tests.length*4+12;
    const headers=reportColumns(report,layout), rows=reportRows(report,stream,layout);
    const fixed = report.include_ids ? [0,1] : [0];
    const styles=Object.fromEntries(headers.map((h,i)=>[i,{cellWidth:h==="Student ID"?35:h==="Name"?47:h==="School"?51:h==="Rank"?12:23}]));
    autoTable(pdf,{head:[headers],body:rows.length?rows:[[...Array(headers.length).fill("")]],startY:top,margin:{top,bottom:17,left:12,right:12},
      styles:{fontSize:8,cellPadding:2.2,overflow:"linebreak",valign:"middle"},headStyles:{fillColor:[8,126,139],textColor:255},alternateRowStyles:{fillColor:[241,247,247]},
      columnStyles:styles,horizontalPageBreak:true,horizontalPageBreakRepeat:fixed,rowPageBreak:"avoid",
      didDrawPage:()=>{let y=12;pdf.setTextColor(25);pdf.setFont("helvetica","bold");pdf.setFontSize(14);pdf.text(titleLines,12,y);y+=titleLines.length*6;pdf.setFont("helvetica","normal");pdf.setFontSize(8);for(const lines of [metadata,info,tests]){pdf.text(lines,12,y);y+=lines.length*4;}pdf.text("A dash means no recorded score and contributes zero.",12,y+2);if(!rows.length)pdf.text("No recorded participants in this stream.",12,top+16);},
    });
  }
  const count=pdf.getNumberOfPages();for(let p=1;p<=count;p++){pdf.setPage(p);pdf.setFontSize(8);pdf.setTextColor(90);pdf.text(`Version ${report.version} | ${report.is_final?"Final":"Provisional"} | Page ${p} of ${count}`,12,pdf.internal.pageSize.getHeight()-7);pdf.setTextColor(0);}
  return pdf;
}
export async function downloadReport(report, format) {
  if(format==="xlsx")saveDownload(await (await rankingWorkbook(report)).xlsx.writeBuffer(),reportFilename(report,"xlsx"));
  else saveDownload((await rankingPDF(report)).output("arraybuffer"),reportFilename(report,"pdf"),"application/pdf");
}
