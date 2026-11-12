// API helpers take a client argument so the data rules can be tested separately.
export function databaseError(error) {
  if (error.code === "42703") {
    return new Error("Student management setup is missing. Run 003_student_management.sql, then Refresh.");
  }
  if (["42P01", "PGRST202", "PGRST205"].includes(error.code)) {
    return new Error("Student database setup is missing. Run 002_shared_students.sql in Supabase, then Refresh.");
  }
  return new Error(error.message || "The database request failed.");
}

export async function readPages(makeQuery, signal) {
  const rows = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await makeQuery().range(offset, offset + pageSize - 1).abortSignal(signal);
    if (error) throw databaseError(error);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

export const loadGroups = (client, signal) => readPages(
  () => client.from("exam_groups").select("id, exam_year, is_archived").order("exam_year"), signal,
);
export async function loadSchools(client,signal) {
  const {data,error}=await client.rpc('app_school_options',{}).abortSignal(signal);
  if(!error)return data||[];
  // Keep the existing directory available while migration 013 is installed.
  if(!['PGRST202','42883'].includes(error.code))throw databaseError(error);
  return readPages(()=>client.from('schools').select('id, name').order('id'),signal);
}
export const loadEnrolments = (client, groupId, signal) => readPages(
  () => client.from("enrolments")
    .select("id, student_code, stream, is_active, version, student:students(id, name, version, enrolments(student_code, aliases:student_id_aliases(student_code))), aliases:student_id_aliases(student_code), school:schools(id, name)")
    .eq("group_id", groupId).order("id"), signal,
);

export async function callStudentAction(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw databaseError(error);
  return data;
}

const canonicalNumber = (value) => value.replace(/^0+(?=\d)/, "");
export function searchDirectory(rows, query, year) {
  const text = query.trim();
  if (!text) return rows;
  if (/^\d+$/.test(text)) {
    const code = `SC/${year}/${canonicalNumber(text)}`;
    return rows.filter((row) => row.student_code === code);
  }
  const full = text.match(/^SC\/(\d{4})\/(\d+)$/i);
  if (full) {
    const code = `SC/${full[1]}/${canonicalNumber(full[2])}`;
    return rows.filter((row) => identityCodes(row).includes(code));
  }
  const lower = text.toLowerCase();
  return rows.filter((row) => [row.student?.name, row.school?.name, ...(row.school?.aliases||[]), ...identityCodes(row)]
    .some((value) => value?.toLowerCase().includes(lower)));
}


export function identityCodes(row) {
  return [...new Set([row.student_code,...(row.aliases||[]).map(a=>a.student_code),...(row.student?.enrolments||[]).flatMap(e=>[e.student_code,...(e.aliases||[]).map(a=>a.student_code)])])];
}

export function searchMarksStudents(students,query,year) {
  return searchDirectory(students.map(s=>({record:s,student_code:s.student_code,school:{name:s.school},student:{name:s.name,enrolments:(s.linked_ids||[]).map(code=>({student_code:code}))}})),query,year).map(row=>row.record);
}
