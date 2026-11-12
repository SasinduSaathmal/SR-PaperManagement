import test from "node:test";
import assert from "node:assert/strict";
import { officialCode, parseCSV, previewStudents, guessColumns } from "../src/studentImport.js";
import { markerFilename, markerWorkbook, readStudentFile } from "../src/workbooks.js";
import ExcelJS from "exceljs";

test("CSV preserves quoted commas, newlines, escaped quotes and Sinhala names", () => {
  const rows = parseCSV('\uFEFFStudent name,School,Stream,Official ID\r\n"සසිඳු, A","School ""A""\nMatara",Maths,005\r\n');
  assert.deepEqual(rows[1], ["සසිඳු, A", 'School "A"\nMatara', "Maths", "005"]);
  assert.throws(() => parseCSV('"unfinished'), /unclosed/);
  assert.throws(() => parseCSV('"x"junk,y'), /quoting/);
});
test("preview canonicalises IDs, preserves existing records and flags bad/duplicate rows", () => {
  assert.equal(officialCode("00012", 2028), "SC/2028/12");
  assert.throws(() => officialCode("SC/2027/12", 2028), /year/);
  const matrix = [Object.values({ a: "Student name", b: "School", c: "Stream", d: "Official ID" }),
    ["A", "School", "Maths", "012"], ["B", "School", "Bio", "SC/2028/12"],
    ["C", "School", "biology", ""], ["C", "School", "Bio", ""], ["D", "", "", "3"],
    ["Existing", "School", "Bio", "55"], ["Existing", "School", "Bio", ""], ["Z", "School", "Maths", "SC/2027/9"]];
  const rows = previewStudents(matrix, guessColumns(matrix[0]), [{ student_code: "SC/2028/55", student: { name: "Existing" }, school: { name: "School" }, stream: "Bio" }], 2028);
  assert.deepEqual(rows.map(r => r.status), ["New", "Duplicate", "New", "Duplicate", "Invalid", "Existing", "Duplicate", "Invalid"]);
  assert.equal(rows[2].stream, "Bio");
});
test("Excel output round-trips as typed marks and literal text with exact filename", async () => {
  const data = { test: { phase: "Phase 2", paper: 5, test_date: "2026-11-11", max_cents: 15000, status: "Closed" }, exam_year: 2028,
    marker: { name: "Sasindu" }, rows: [{ name: "=HYPERLINK(\"x\")", school: "School", student_code: "SC/2028/0005", stream: "Maths", cents: 0 }, { name: "B", school: "School B", student_code: "TEMP/SC/2028/000001", stream: "Bio", cents: 12525 }] };
  assert.equal(markerFilename(data.test, data.marker.name), "Phase 2 Paper 5 Sasindu.xlsx");
  assert.equal(markerFilename({ phase: "2", paper: 5 }, "A/B:C"), "Phase 2 Paper 5 A_B_C.xlsx");
  const workbook = await markerWorkbook(data), buffer = await workbook.xlsx.writeBuffer();
  const reopened = new ExcelJS.Workbook(); await reopened.xlsx.load(buffer);
  const sheet = reopened.worksheets[0];
  assert.equal(sheet.getCell("F4").value, 0);
  assert.equal(sheet.getCell("F5").value, 125.25);
  assert.equal(sheet.getCell("C4").value, '=HYPERLINK("x")');
  assert.equal(sheet.getCell("B4").value, "SC/2028/0005");
  assert.equal(sheet.views[0].ySplit, 3);
  await assert.rejects(() => markerWorkbook({ ...data, test: { ...data.test, status: "Open" } }), /Submit your latest batch/);
  const submitted={...data,test:{...data.test,status:"Open"},submission:{revision:2,submitted_at:"2026-11-12T05:00:00Z"}};
  const open=await markerWorkbook(submitted);
  assert.equal(open.worksheets[0].getCell("F5").value,125.25);
  assert.match(open.worksheets[0].getCell("A2").value,/Submitted:.*Batch revision: 2/);
  await assert.rejects(()=>markerWorkbook({...submitted,test:{...submitted.test,status:"Cancelled"}}),/Cancelled/);
});
test("Excel import reads multiple worksheets and rejects formula/date cells", async () => {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Students");
  sheet.addRow(["Student name", "School", "Stream", "Official ID"]);
  sheet.addRow(["A", "School", "Maths", "005"]);
  sheet.addRow(["B", "School", "Bio", { formula: "1+1", result: 2 }]);
  const bytes = await workbook.xlsx.writeBuffer();
  const sheets = await readStudentFile({ name: "students.xlsx", size: bytes.length, arrayBuffer: async () => bytes });
  assert.equal(sheets[0].rows[1][3], "005");
  assert.match(sheets[0].rows[2][3], /Unsupported/);
});
