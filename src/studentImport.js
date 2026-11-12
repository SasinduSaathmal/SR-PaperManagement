import {canonicalSchool} from "./schoolNames.js";
export const IMPORT_LIMIT = 1000;
export const fields = { name: "Student name", school: "School", stream: "Stream", officialId: "Official ID" };
const clean = value => String(value ?? "").trim().replace(/\s+/g, " ");
const fold = value => clean(value).toLowerCase();
export function officialCode(value, year) {
  const raw = clean(value).toUpperCase();
  if (!raw) return "";
  if (raw.length > 100) throw Error("ID is too long");
  const match = raw.match(/^SC\/(\d{4})\/(\d+)$/);
  if (!/^\d+$/.test(raw) && !match) throw Error("Use an official number or SC/year/number");
  if (match && Number(match[1]) !== Number(year)) throw Error("ID year does not match this group");
  return `SC/${year}/${(match ? match[2] : raw).replace(/^0+(?=\d)/, "")}`;
}

// RFC 4180 quoting, including commas/newlines and escaped quotes in fields.
export function parseCSV(text) {
  const rows = []; let row = [], field = "", quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === ',') { row.push(field); field = ""; closed = false; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = ""; closed = false;
    } else if (c === '"' && !field && !closed) quoted = true;
    else if (closed || c === '"') throw Error("Invalid CSV quoting. Save the file as UTF-8 CSV and retry.");
    else field += c;
    if (rows.length > IMPORT_LIMIT + 1) throw Error(`Import up to ${IMPORT_LIMIT} students at a time.`);
  }
  if (quoted) throw Error("CSV has an unclosed quoted field.");
  if (field || row.length || closed) rows.push([...row, field]);
  return rows;
}
export function guessColumns(headers) {
  const aliases = { name: ["name", "student name"], school: ["school", "school name"], stream: ["stream"], officialId: ["id", "student id", "student code", "official id", "official number"] };
  return Object.fromEntries(Object.entries(aliases).map(([key, options]) => [key, headers.findIndex(h => options.includes(fold(h)))]));
}
export function previewStudents(matrix, mapping, existing, year, schools=[]) {
  if (matrix.length - 1 > IMPORT_LIMIT) throw Error(`Import up to ${IMPORT_LIMIT} students at a time.`);
  if (matrix.some(row => row.length > 100)) throw Error("Use a file with up to 100 columns.");
  const seenCodes = new Set(), seenPeople = new Set();
  const signature = s => [fold(s.name), fold(s.school), s.stream].join("\u001f");
  const byCode = new Map(existing.flatMap(e => [e.student_code,...(e.aliases||[]).map(a=>a.student_code)].map(code=>[code,e])));
  const people = new Set(existing.map(e => signature({ name: e.student?.name, school: e.school?.name, stream: e.stream })));
  return matrix.slice(1).flatMap((cells, index) => {
    if (cells.every(c => !clean(c))) return [];
    const row = Object.fromEntries(Object.keys(fields).map(key => [key, clean(cells[mapping[key]])]));
    row.school=canonicalSchool(row.school,schools);
    const errors = [];
    if (Object.values(row).some(value => value.includes("[Unsupported cell:"))) errors.push("Replace formula, date or unsupported cells with plain text");
    for (const key of ["name", "school"]) if (!row[key] || row[key].length > 200) errors.push(`${fields[key]} required (up to 200 characters)`);
    const streams = { maths: "Maths", math: "Maths", mathematics: "Maths", bio: "Bio", biology: "Bio" };
    row.stream = streams[fold(row.stream)] || row.stream;
    if (!["Maths", "Bio"].includes(row.stream)) errors.push("Choose Maths or Bio");
    let code = "";
    try { code = officialCode(row.officialId, year); } catch (e) { errors.push(e.message); }
    const sig = signature(row);
    let status = "New", detail = code ? "Ready to import" : "Temporary ID will be generated";
    if (errors.length) { status = "Invalid"; detail = errors.join("; "); }
    else if ((code && seenCodes.has(code)) || (!code && seenPeople.has(sig))) { status = "Duplicate"; detail = "Repeated in this file; skipped"; }
    else if (code && byCode.has(code)) { status = "Existing"; detail = "ID already exists; record will be preserved"; }
    else if (people.has(sig)) { status = "Review"; detail = "Matching name, school and stream already exist; skipped to avoid duplicates"; }
    if (!errors.length) { if (code) seenCodes.add(code); seenPeople.add(sig); }
    return [{ ...row, officialId: code, rowNumber: index + 2, status, detail }];
  });
}
