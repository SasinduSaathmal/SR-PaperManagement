import { officialCode } from "./studentImport.js";
import { parseMark } from "./domain.js";
import { readStudentFile } from "./workbooks.js";
import { parseOnlineHTML as parseHTML } from "./onlineHTML.js";

const text = value => String(value && typeof value === "object" && value.text ? value.text : value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const normal = value => text(value).toLowerCase();
export async function parseOnlineHTML(html) {
  return parseHTML(html);
}
export async function readOnlineFile(file) {
  if (file.size > 5 * 1024 * 1024) throw Error("Choose a file smaller than 5 MB.");
  const bytes = await file.arrayBuffer();
  const raw = new TextDecoder().decode(bytes);
  // The original .xls exports are HTML; never interpret their scores as dates.
  if (/<table[\s>]|<frameset[\s>]|Excel Workbook Frameset/i.test(raw)) return parseOnlineHTML(raw);
  if (/\.xls$/i.test(file.name)) throw Error("This .xls is not the supported HTML-table export. Use the original downloaded export, or save a genuine workbook as .xlsx.");
  const sheets = await readStudentFile(file,{preserveDates:true});
  if (sheets.length !== 1) throw Error("For online imports, upload one worksheet at a time.");
  return { heading: file.name.replace(/\.(xlsx|csv)$/i, ""), matrix: sheets[0].rows };
}
export function onlineRows(matrix) {
  if (!matrix.length || matrix.length > 1001) throw Error("Use an export containing 1 to 1000 student rows.");
  const headers = matrix[0].map(normal);
  const find = names => headers.findIndex(h => names.includes(h));
  const columns = { code: find(["student code", "student id", "official id"]), name: find(["student name", "name"]), school: find(["student school", "school"]), mark: find(["student mark", "marks", "score"]), stream: find(["stream"]) };
  if (columns.code < 0 || columns.mark < 0) throw Error("Student Code and Student Mark columns are required.");
  return matrix.slice(1).filter(cells => cells.some(c => text(c))).map((cells, index) => {
    const cell=cells[columns.mark];
    return {row_number:index+2,code:text(cells[columns.code]),name:text(cells[columns.name]),school:text(cells[columns.school]),
      mark:cell&&typeof cell==="object"?cell.text:text(cell),stream:text(cells[columns.stream]),
      ...(cell?.kind==="excel-date"?{mark_date:cell}:{}),};
  });
}
export function checkOnlineTarget(heading, rows, test, year) {
  const errors = [];
  const phase = text(heading).match(/phase\s*(\d+)/i), paper = text(heading).match(/paper\s*0*(\d+)/i), examYear = text(heading).match(/\b(20\d{2})\b/);
  const targetPhase = text(test.phase).match(/(?:phase\s*)?(\d+)/i);
  if (examYear && Number(examYear[1]) !== Number(year)) errors.push("The export year differs from the selected exam group.");
  if (phase && targetPhase && Number(phase[1]) !== Number(targetPhase[1])) errors.push("The export phase differs from the selected test.");
  if (paper && Number(paper[1]) !== Number(test.paper)) errors.push("The export paper differs from the selected test.");
  for (const row of rows) {
    const max = row.mark.match(/\/\s*(\d+(?:\.\d{1,2})?)\s*$/);
    if (max && Number(max[1]) * 100 !== test.max_cents) { errors.push("The export marks denominator differs from this test's maximum."); break; }
  }
  return [...new Set(errors)];
}
export function previewOnlineRows(rows, snapshot) {
  const seen = new Set();
  return rows.map(row => {
    const score = row.mark.split("/");
    const mark = score.length <= 2 ? parseMark(score[0].trim(), snapshot.test.max_cents / 100) : { error: "Invalid score" };
    let code = "", issue = "";
    try { code = officialCode(row.code, snapshot.group.exam_year); if (!code) issue = "Official ID is missing"; } catch(e) { issue = e.message; }
    const student = snapshot.students.find(s => (s.student_code === code || s.linked_ids?.includes(code)));
    const old = snapshot.scores.find(s => s.enrolment_id === student?.id && !s.is_deleted);
    let status = "Ready", detail = "Use existing database details";
    if (mark.cents === 0) { status = "Skipped"; detail = "Online zero: no score will be recorded"; }
    else if (mark.error || row.mark.includes("[Unsupported")) { status = "Invalid"; detail = "Review the original score text; date/formula conversions are not guessed"; }
    else if (issue) { status = "Invalid"; detail = issue; }
    else if (seen.has(code)) { status = "Conflict"; detail = "Repeated ID in this file"; }
    else if (!student) { status = "Unknown"; detail = "Complete student details and stream after staging"; }
    else if (!student.is_active) { status = "Invalid"; detail = "Student is inactive; reactivate before import"; }
    else if (old && old.source === "Online" && old.cents === mark.cents) { status = "Already imported"; detail = "Identical online score; no change"; }
    else if (old) { status = "Conflict"; detail = `Existing ${old.source} score: ${old.cents / 100}; requires admin review`; }
    if (code) seen.add(code);
    return { ...row, code, status, detail, cents: mark.cents ?? null };
  });
}
