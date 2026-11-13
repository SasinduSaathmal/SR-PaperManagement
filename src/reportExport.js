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
  if (extension==="pdf") {
    if (!["Maths","Bio","All"].includes(stream)) throw Error("Choose Maths, Bio or All for the PDF.");
    const papers=reportHeading(report,stream)[0].replace(/[<>:"/\\|?*\u0000-\u001f]/g,"_").replace(/[. ]+$/,"").slice(0,170);
    return `${papers} ${report.top_n?`Top ${report.top_n}`:"Full list"} ${stream} Matara.pdf`;
  }
  const safe = report.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "").slice(0,120);
  return `${report.exam_year} ${safe} ${report.top_n ? `Top ${report.top_n}` : "Full list"} v${report.version}.${extension}`;
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
  if (!["Maths","Bio","All"].includes(stream)) throw Error("Choose Maths, Bio or All for the PDF.");
  const [{jsPDF},{autoTable}] = await Promise.all([import("jspdf"),import("jspdf-autotable")]);
  const single=report.tests.length===1;
  const pdf = new jsPDF({orientation:single||report.layout==="summary"?"portrait":"landscape",unit:"mm",format:"a4"});
  // A single paper has identical detailed and summary columns; include it once.
  const layouts=single?[report.layout==="summary"?"summary":"detailed"]:layoutsOf(report);
  let first=true;
  for (const sectionStream of stream==="All"?["Maths","Bio"]:[stream]) for (const layout of layouts) {
    if (!first) pdf.addPage(); first=false;
    const pageWidth=pdf.internal.pageSize.getWidth(), side=15, usable=pageWidth-side*2;
    pdf.setFont("helvetica","bold");pdf.setFontSize(18);
    const brandLines=pdf.splitTextToSize(REPORT_BRAND,usable);
    pdf.setFontSize(13);
    const titleLines=pdf.splitTextToSize(reportHeading(report,sectionStream).join("\n"),usable);
    const top=16+brandLines.length*8+titleLines.length*5.5+9;
    const headers=reportColumns(report,layout), rows=reportRows(report,sectionStream,layout);
    const fixed = report.include_ids ? [0,1] : [0];
    const widths=headers.map(h=>h==="Student ID"?35:h==="Name"?47:h==="School"?51:h==="Rank"?12:23);
    const natural=widths.reduce((total,width)=>total+width,0), wide=natural>usable;
    const styles=Object.fromEntries(headers.map((h,i)=>[i,{cellWidth:wide?widths[i]:widths[i]*usable/natural,halign:["Name","School"].includes(h)?"left":"center"}]));
    autoTable(pdf,{head:[headers],body:rows.length?rows:[[...Array(headers.length).fill("")]],startY:top,margin:{top,bottom:17,left:side,right:side},
      tableWidth:wide?"wrap":usable,
      styles:{fontSize:single?11:wide?8:9.5,cellPadding:single?3:2.2,minCellHeight:single?11:8,overflow:"linebreak",valign:"middle"},headStyles:{fillColor:[8,126,139],textColor:255},alternateRowStyles:{fillColor:[241,247,247]},
      columnStyles:styles,horizontalPageBreak:wide,horizontalPageBreakRepeat:fixed,rowPageBreak:"avoid",
      didDrawPage:()=>{let y=16;pdf.setTextColor(25);pdf.setFont("helvetica","bold");pdf.setFontSize(18);pdf.text(brandLines,pageWidth/2,y,{align:"center"});y+=brandLines.length*8;pdf.setFontSize(13);pdf.text(titleLines,pageWidth/2,y,{align:"center"});if(!rows.length){pdf.setFont("helvetica","normal");pdf.setFontSize(10);pdf.text("No recorded participants in this stream.",pageWidth/2,top+18,{align:"center"});}},
    });
  }
  const count=pdf.getNumberOfPages();for(let p=1;p<=count;p++){pdf.setPage(p);pdf.setFont("helvetica","normal");pdf.setFontSize(8);pdf.setTextColor(90);pdf.text(`Version ${report.version} | ${report.is_final?"Final":"Provisional"} | Page ${p} of ${count}`,12,pdf.internal.pageSize.getHeight()-7);pdf.setTextColor(0);}
  return pdf;
}
export async function downloadReport(report, format, stream) {
  if(format==="xlsx")saveDownload(await (await rankingWorkbook(report)).xlsx.writeBuffer(),reportFilename(report,"xlsx"));
  else saveDownload((await rankingPDF(report,stream)).output("arraybuffer"),reportFilename(report,"pdf",stream),"application/pdf");
}
