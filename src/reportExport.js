import { excel, saveDownload } from "./workbooks.js";
import { formatMark } from "./domain.js";

export const REPORT_BRAND = "Physics - Samitha Rathnayaka";
export const layoutsOf = report => report.layout === "both" ? ["detailed", "summary"] : [report.layout];
export function reportColumns(report, layout) {
  return [...(report.include_ids ? ["Student ID"] : []), "Name", "School", ...(layout === "detailed" && report.tests.length > 1 ? report.tests.map(t => `${t.phase} Paper ${t.paper} / ${formatMark(t.max_cents)}`) : []), report.tests.length === 1 ? "Marks" : "Total", "Rank"];
}
export function reportRows(report, stream, layout, numeric = false) {
  const value = cents => cents == null ? "—" : numeric ? cents / 100 : formatMark(cents);
  return report.rows.filter(r => r.stream === stream).map(r => [...(report.include_ids ? [r.student_code] : []), r.name, r.school,
    ...(layout === "detailed" && report.tests.length > 1 ? r.scores.map(value) : []), value(r.total_cents), r.rank]);
}
export function reportFilename(report, extension, stream) {
  if (extension==="pdf" && !["Maths","Bio"].includes(stream)) throw Error("Choose Maths or Bio for the PDF.");
  const safe = report.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "").slice(0,120);
  return `${report.exam_year} ${safe} ${report.top_n ? `Top ${report.top_n}` : "Full list"}${extension==="pdf"?` ${stream}`:""} v${report.version}.${extension}`;
}
export function reportHeading(report,stream) {
  const papers=report.tests.map(t=>`Phase ${String(t.phase).replace(/^phase\s*/i,"").trim()} Paper ${t.paper}`).join("; ");
  return [`${report.exam_year} ${papers}`,`${report.top_n ? `Top ${report.top_n}` : "Full list"} ${stream}`];
}

export async function rankingWorkbook(report) {
  const ExcelJS = await excel(), workbook = new ExcelJS.Workbook();
  workbook.creator = report.creator; workbook.created = new Date(report.created_at);
  for (const stream of ["Maths","Bio"]) for (const layout of layoutsOf(report)) {
    const sheet = workbook.addWorksheet(`${stream} ${layout}`), headers = reportColumns(report,layout), count = headers.length;
    const heading=reportHeading(report,stream).join("\n");
    for (const line of [REPORT_BRAND,heading]) {
      const row=sheet.addRow([line]);sheet.mergeCells(row.number,1,row.number,count);
      row.alignment={wrapText:true,vertical:"middle"};row.font={bold:true,size:row.number===1?16:14};
      row.height=row.number===1?36:12+heading.split("\n").reduce((lines,line)=>lines+Math.max(1,Math.ceil(line.length/Math.max(70,count*14))),0)*20;
    }
    const header=sheet.addRow(headers); header.font={bold:true,color:{argb:"FFFFFFFF"}}; header.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF087E8B"}};header.height=44;header.alignment={wrapText:true,vertical:"middle"};
    reportRows(report,stream,layout,true).forEach(values => { const row=sheet.addRow(values);row.alignment={wrapText:true,vertical:"top"}; row.height=32; });
    headers.forEach((h,i)=>{const col=sheet.getColumn(i+1);col.width=h==="Student ID"?27:h==="Name"?34:h==="School"?44:h==="Rank"?9:16;if(!["Student ID","Name","School","Rank"].includes(h))col.numFmt="0.##";});
    sheet.views=[{state:"frozen",ySplit:header.number,xSplit:report.include_ids?2:1}];sheet.autoFilter={from:{row:header.number,column:1},to:{row:Math.max(header.number,sheet.rowCount),column:count}};
    sheet.pageSetup={orientation:layout==="detailed"?"landscape":"portrait",paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0};
  }
  return workbook;
}

export async function rankingPDF(report,stream) {
  if (!["Maths","Bio"].includes(stream)) throw Error("Choose Maths or Bio for the PDF.");
  const [{jsPDF},{autoTable}] = await Promise.all([import("jspdf"),import("jspdf-autotable")]);
  const pdf = new jsPDF({orientation:report.layout==="summary"?"portrait":"landscape",unit:"mm",format:"a4"});
  let first=true;
  for (const layout of layoutsOf(report)) {
    if (!first) pdf.addPage(); first=false;
    const pageWidth=pdf.internal.pageSize.getWidth(), usable=pageWidth-24;
    pdf.setFont("helvetica","bold");pdf.setFontSize(16);
    const brandLines=pdf.splitTextToSize(REPORT_BRAND,usable);
    pdf.setFontSize(12);
    const titleLines=pdf.splitTextToSize(reportHeading(report,stream).join("\n"),usable);
    const top=12+brandLines.length*7+titleLines.length*5+7;
    const headers=reportColumns(report,layout), rows=reportRows(report,stream,layout);
    const fixed = report.include_ids ? [0,1] : [0];
    const styles=Object.fromEntries(headers.map((h,i)=>[i,{cellWidth:h==="Student ID"?35:h==="Name"?47:h==="School"?51:h==="Rank"?12:23}]));
    autoTable(pdf,{head:[headers],body:rows.length?rows:[[...Array(headers.length).fill("")]],startY:top,margin:{top,bottom:17,left:12,right:12},
      styles:{fontSize:8,cellPadding:2.2,overflow:"linebreak",valign:"middle"},headStyles:{fillColor:[8,126,139],textColor:255},alternateRowStyles:{fillColor:[241,247,247]},
      columnStyles:styles,horizontalPageBreak:true,horizontalPageBreakRepeat:fixed,rowPageBreak:"avoid",
      didDrawPage:()=>{let y=12;pdf.setTextColor(25);pdf.setFont("helvetica","bold");pdf.setFontSize(16);pdf.text(brandLines,12,y);y+=brandLines.length*7;pdf.setFontSize(12);pdf.text(titleLines,12,y);if(!rows.length){pdf.setFont("helvetica","normal");pdf.setFontSize(8);pdf.text("No recorded participants in this stream.",12,top+16);}},
    });
  }
  const count=pdf.getNumberOfPages();for(let p=1;p<=count;p++){pdf.setPage(p);pdf.setFont("helvetica","normal");pdf.setFontSize(8);pdf.setTextColor(90);pdf.text(`Version ${report.version} | ${report.is_final?"Final":"Provisional"} | Page ${p} of ${count}`,12,pdf.internal.pageSize.getHeight()-7);pdf.setTextColor(0);}
  return pdf;
}
export async function downloadReport(report, format, stream) {
  if(format==="xlsx")saveDownload(await (await rankingWorkbook(report)).xlsx.writeBuffer(),reportFilename(report,"xlsx"));
  else saveDownload((await rankingPDF(report,stream)).output("arraybuffer"),reportFilename(report,"pdf",stream),"application/pdf");
}
