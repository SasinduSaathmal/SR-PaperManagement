import { parseCSV } from "./studentImport.js";
import { dateCellValue } from "./dateMarkRecovery.js";
import { moduleLoadMessage } from "./moduleLoading.js";

export async function excel() {
  try { const module = await import("exceljs"); return module.default || module; }
  catch(error) { throw Error(moduleLoadMessage(error)); }
}
export function saveDownload(bytes, name, type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function markerFilename(test, markerName) {
  const phase = String(test.phase).replace(/^phase\s*/i, "").trim();
  const safe = text => String(text).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "").trim().slice(0, 100) || "Marker";
  return `Phase ${safe(phase)} Paper ${safe(test.paper)} ${safe(markerName)}.xlsx`;
}
function styleTable(sheet, headers, widths, headerRow = 1) {
  widths.forEach((width, i) => { sheet.getColumn(i + 1).width = width; });
  sheet.getRow(headerRow).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(headerRow).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF087E8B" } };
  sheet.getRow(headerRow).height = 26;
  sheet.views = [{ state: "frozen", ySplit: headerRow }];
  sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: sheet.rowCount, column: headers.length } };
  sheet.eachRow(row => { row.alignment = { vertical: "middle", wrapText: true }; });
}
export async function markerWorkbook(data) {
  if (data.test.status !== "Closed") throw Error("Downloads are available only after closing the test.");
  const ExcelJS = await excel(), workbook = new ExcelJS.Workbook();
  workbook.creator = "Physics - Samitha Rathnayake";
  const sheet = workbook.addWorksheet("Student marks");
  sheet.addRow([`${data.test.phase} · Paper ${data.test.paper} · ${data.marker.name}`]); sheet.mergeCells("A1:F1");
  sheet.getRow(1).font = { bold: true, size: 16 }; sheet.getRow(1).height = 32;
  sheet.addRow([`Exam year: ${data.exam_year} | Test date: ${data.test.test_date} | Maximum marks: ${data.test.max_cents / 100}`]); sheet.mergeCells("A2:F2"); sheet.getRow(2).height = 28;
  const headers = ["No.", "Student ID", "Student name", "School", "Stream", "Marks"];
  sheet.addRow(headers);
  data.rows.forEach((s, i) => sheet.addRow([i + 1, String(s.student_code), String(s.name), String(s.school), String(s.stream), s.cents / 100]));
  sheet.getColumn(6).numFmt = "0.##";
  styleTable(sheet, headers, [8, 27, 34, 44, 14, 14], 3);
  sheet.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return workbook;
}
export async function downloadMarker(data) {
  const workbook = await markerWorkbook(data);
  saveDownload(await workbook.xlsx.writeBuffer(), markerFilename(data.test, data.marker.name));
}
export async function downloadStudentTemplate() {
  const ExcelJS = await excel(), workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Students");
  const headers = ["Student name", "School", "Stream", "Official ID"];
  sheet.addRow(headers); styleTable(sheet, headers, [34, 44, 18, 28]);
  for (let i = 2; i <= 1001; i++) {
    sheet.getCell(`C${i}`).dataValidation = { type: "list", allowBlank: false, formulae: ['"Maths,Bio"'], showErrorMessage: true, error: "Choose Maths or Bio" };
    sheet.getCell(`D${i}`).numFmt = "@";
  }
  saveDownload(await workbook.xlsx.writeBuffer(), "Student import template.xlsx");
}
export async function readStudentFile(file,{preserveDates=false}={}) {
  if (file.size > 5 * 1024 * 1024) throw Error("Choose a file smaller than 5 MB.");
  if (/\.csv$/i.test(file.name)) {
    return [{ name: file.name, rows: parseCSV(await file.text()) }];
  }
  if (!/\.xlsx$/i.test(file.name)) throw Error("Use an .xlsx or UTF-8 .csv file. Save older .xls files as .xlsx first.");
  const ExcelJS = await excel(), workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  return workbook.worksheets.map(sheet => {
    if (sheet.rowCount > 1001 || sheet.columnCount > 100) throw Error("Use a sheet with up to 1000 students and 100 columns.");
    const rows = [];
    sheet.eachRow({ includeEmpty: true }, row => {
      const values = [];
      for (let col = 1; col <= sheet.columnCount; col++) {
        const cell = row.getCell(col), value = cell.value;
        if (preserveDates && value instanceof Date) values.push(dateCellValue(value,cell.numFmt));
        else if (value instanceof Date || (value && typeof value === "object" && !(value.richText || value.hyperlink))) values.push("[Unsupported cell: replace with plain text]");
        else values.push(cell.text);
      }
      rows.push(values);
    });
    return { name: sheet.name, rows };
  }).filter(sheet => sheet.rows.length);
}
