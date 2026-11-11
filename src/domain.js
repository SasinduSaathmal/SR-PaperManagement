// These functions contain the rules. They do not know anything about React.
// Marks are stored as integer hundredths: 37.25 marks becomes 3725.
export function normaliseOfficialId(input, year) {
  const text = String(input).trim().replace(/\s/g, "").toUpperCase();
  const full = text.match(/^SC\/(\d{4})\/(\d+)$/);
  if (full && full[1] === String(year))
    return `SC/${year}/${full[2].replace(/^0+(?=\d)/, "")}`;
  if (/^\d+$/.test(text)) return `SC/${year}/${text.replace(/^0+(?=\d)/, "")}`;
  return null;
}

export function searchStudents(students, query, year) {
  const text = String(query).trim();
  const group = students.filter(
    (student) => student.year === Number(year) && student.active,
  );
  if (!text) return group;
  if (/^\d+$/.test(text)) {
    const exact = normaliseOfficialId(text, year);
    const match = group.filter(
      (student) =>
        !student.id.startsWith("TEMP/") &&
        normaliseOfficialId(student.id, year) === exact,
    );
    if (match.length) return match;
    const number = text.replace(/^0+(?=\d)/, "");
    return group.filter(
      (student) =>
        !student.id.startsWith("TEMP/") &&
        student.id.split("/").at(-1).includes(number),
    );
  }
  const canonical = normaliseOfficialId(text, year);
  return group.filter(
    (student) =>
      (canonical &&
        !student.id.startsWith("TEMP/") &&
        normaliseOfficialId(student.id, year) === canonical) ||
      student.name.toLowerCase().includes(text.toLowerCase()) ||
      (student.school ?? "").toLowerCase().includes(text.toLowerCase()) ||
      student.id.toLowerCase().includes(text.toLowerCase()),
  );
}

export function parseMark(input, maxMark) {
  const text = String(input).trim();
  if (!text) return { error: "Enter a score." };
  if (!/^\d+(?:\.\d{1,2})?$/.test(text))
    return { error: "Use a number with up to two decimal places." };
  const [whole, decimal = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > maxMark * 100)
    return { error: `Enter a score from 0 to ${maxMark}.` };
  return { cents };
}

export function formatMark(cents) {
  return (cents / 100).toFixed(2).replace(/\.?0+$/, "") || "0";
}

export function submissionKey(testId, markerId) {
  return `${testId}:${markerId}`;
}

export function saveScore(
  state,
  { testId, studentKey, actorId, text, now = new Date().toISOString() },
) {
  const test = state.tests.find((item) => item.key === testId);
  const actor = state.users.find((item) => item.key === actorId);
  const student = state.students.find((item) => item.key === studentKey);
  if (!test || !actor || !student)
    throw new Error("Select a test and student.");
  if (test.status !== "Open")
    throw new Error("This test is closed. Scores are read-only.");
  if (!student.active || student.year !== test.year)
    throw new Error("Choose an active student in this exam group.");
  const old = state.scores.find(
    (score) => score.testId === testId && score.studentKey === studentKey,
  );
  if (old && old.markerId !== actorId && !actor.admin)
    throw new Error(
      "This score belongs to another marker. Ask an admin to review it.",
    );
  if (
    !test.participants.includes(actorId) &&
    !(actor.admin && old && old.markerId !== actorId)
  )
    throw new Error("You are not a participating marker for this test.");
  const mark = parseMark(text, test.max);
  if (mark.error) throw new Error(mark.error);
  if (old && old.cents === mark.cents) return state;
  const score = {
    testId,
    studentKey,
    markerId: old?.markerId ?? actorId,
    cents: mark.cents,
    source: old?.source ?? "Paper",
    updatedAt: now,
  };
  const scores = old
    ? state.scores.map((item) => (item === old ? score : item))
    : [...state.scores, score];
  const submissions = { ...state.submissions };
  // An admin correcting SOMEONE ELSE'S score keeps their submission status.
  if (!old || old.markerId === actorId) {
    const key = submissionKey(testId, actorId);
    if (submissions[key]?.status === "Submitted")
      submissions[key] = { ...submissions[key], status: "Needs resubmission" };
  }
  return {
    ...state,
    scores,
    submissions,
    history: [
      ...state.history,
      {
        testId,
        studentKey,
        actorId,
        before: old?.cents ?? null,
        after: mark.cents,
        at: now,
      },
    ],
  };
}

export function submitBatch(state, testId, actorId) {
  const test = state.tests.find((item) => item.key === testId);
  if (!test || test.status !== "Open" || !test.participants.includes(actorId))
    throw new Error("Only participating markers can submit an open test.");
  return {
    ...state,
    submissions: {
      ...state.submissions,
      [submissionKey(testId, actorId)]: {
        status: "Submitted",
        at: new Date().toISOString(),
      },
    },
  };
}

export function addStudent(state, values) {
  const name = values.name.trim();
  const school = values.school.trim();
  const year = Number(values.year);
  if (!name || !school || !["Maths", "Bio"].includes(values.stream))
    throw new Error("Name, school, and stream are required.");
  let id;
  if (values.id.trim()) {
    id = normaliseOfficialId(values.id, year);
    if (!id)
      throw new Error(
        `Use SC/${year}/number, or just the number. Leave blank for a temporary ID.`,
      );
    if (
      state.students.some(
        (student) =>
          student.year === year && normaliseOfficialId(student.id, year) === id,
      )
    )
      throw new Error(
        "This official ID already exists. Search for the existing student.",
      );
  } else {
    const temporaryNumbers = state.students
      .filter(
        (student) => student.year === year && student.id.startsWith("TEMP/"),
      )
      .map((student) => Number(student.id.split("/").at(-1)));
    id = `TEMP/SC/${year}/${String(Math.max(0, ...temporaryNumbers) + 1).padStart(6, "0")}`;
  }
  // randomUUID requires HTTPS. Local HTTP learning previews need a local-only
  // fallback; the production database will generate its own UUIDs.
  const key =
    globalThis.crypto?.randomUUID?.() ??
    `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const student = {
    key,
    id,
    year,
    name,
    school,
    stream: values.stream,
    active: true,
  };
  return { ...state, students: [...state.students, student] };
}

export function buildRanking(state, testIds, stream) {
  const tests = state.tests.filter(
    (test) => testIds.includes(test.key) && test.status !== "Cancelled",
  );
  if (!tests.length || new Set(tests.map((test) => test.year)).size !== 1)
    return [];
  const ids = new Set(tests.map((test) => test.key));
  const rows = state.students
    .filter(
      (student) => student.year === tests[0].year && student.stream === stream,
    )
    .flatMap((student) => {
      const scores = state.scores.filter(
        (score) => score.studentKey === student.key && ids.has(score.testId),
      );
      return scores.length
        ? [
            {
              ...student,
              total: scores.reduce((sum, score) => sum + score.cents, 0),
              attended: scores.length,
            },
          ]
        : [];
    });
  rows.sort(
    (a, b) =>
      b.total - a.total ||
      a.name.localeCompare(b.name) ||
      a.key.localeCompare(b.key),
  );
  return rows.map((row, index) => ({
    ...row,
    rank:
      index === 0 || row.total !== rows[index - 1].total
        ? index + 1
        : rows.findIndex((item) => item.total === row.total) + 1,
  }));
}

