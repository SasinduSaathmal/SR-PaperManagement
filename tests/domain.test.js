import test from "node:test";
import assert from "node:assert/strict";
import {
  addStudent,
  buildRanking,
  formatMark,
  normaliseOfficialId,
  parseMark,
  saveScore,
  searchStudents,
  submissionKey,
  submitBatch,
} from "../src/domain.js";
import { makeSampleData } from "../src/sampleData.js";

test("official IDs ignore leading zeros and resolve only inside the selected year", () => {
  assert.equal(normaliseOfficialId("006900", 2027), "SC/2027/6900");
  assert.equal(normaliseOfficialId(" sc/2027/006900 ", 2027), "SC/2027/6900");
  assert.equal(normaliseOfficialId("SC/2028/6900", 2027), null);
});
test("number-only lookup never falls back to a temporary ID", () => {
  const students = [
    {
      key: "temp",
      year: 2027,
      active: true,
      id: "TEMP/SC/2027/000001",
      name: "Temporary Student",
      school: "Test School",
    },
  ];
  assert.deepEqual(searchStudents(students, "1", 2027), []);
  assert.equal(
    searchStudents(students, "TEMP/SC/2027/000001", 2027)[0].key,
    "temp",
  );
  assert.equal(searchStudents(students, "temporary", 2027)[0].key, "temp");
});
test("student search handles missing schools without changing the records", () => {
  for (const school of [undefined, null, ""]) {
    const student = { key: "temp", year: 2027, active: true,
      id: "TEMP/SC/2027/000001", name: "Temporary Student", school };
    assert.deepEqual(searchStudents([student], student.id, 2027), [student]);
    assert.deepEqual(searchStudents([student], "temporary", 2027), [student]);
    assert.deepEqual(searchStudents([student], "unmatched school", 2027), []);
    assert.deepEqual(searchStudents([student], "1", 2027), []);
    assert.equal(student.school, school);
  }
  const student = { key: "official", year: 2027, active: true,
    id: "SC/2027/123", name: "Student", school: "Test College" };
  assert.deepEqual(searchStudents([student], "COLLEGE", 2027), [student]);
});
test("marks distinguish blank and zero, allow two decimals, and reject invalid precision/range", () => {
  assert.equal(parseMark("0", 150).cents, 0);
  assert.equal(parseMark("37.25", 150).cents, 3725);
  assert.equal(parseMark("150.00", 150).cents, 15000);
  for (const value of ["", "-1", "151", "37.251", "Infinity", "1e2", "0x10"])
    assert.ok(parseMark(value, 150).error);
  assert.equal(formatMark(10000), "100");
  assert.equal(formatMark(0), "0");
  assert.equal(formatMark(3725), "37.25");
});
test("saving updates the existing score instead of adding a second row", () => {
  const state = makeSampleData();
  const next = saveScore(state, {
    testId: "2027-p6",
    studentKey: "student-0",
    actorId: "sasindu",
    text: "113.25",
  });
  assert.equal(next.scores.length, state.scores.length);
  assert.equal(next.history.at(-1).before, 11400);
  assert.equal(next.history.at(-1).after, 11325);
  assert.equal(state.scores[0].cents, 11400);
});
test("a marker cannot overwrite another marker or enter a closed test", () => {
  const state = makeSampleData();
  assert.throws(
    () =>
      saveScore(state, {
        testId: "2027-p6",
        studentKey: "student-0",
        actorId: "marker-three",
        text: "100",
      }),
    /another marker/,
  );
  assert.throws(
    () =>
      saveScore(state, {
        testId: "2027-p5",
        studentKey: "student-0",
        actorId: "sasindu",
        text: "30",
      }),
    /closed/,
  );
});
test("an unselected marker cannot enter a new paper score", () => {
  const state = makeSampleData();
  state.tests[0].participants = ["sasindu"];
  assert.throws(
    () =>
      saveScore(state, {
        testId: "2027-p6",
        studentKey: "student-9",
        actorId: "marker-five",
        text: "50",
      }),
    /not a participating/,
  );
  assert.throws(
    () =>
      saveScore(state, {
        testId: "2027-p6",
        studentKey: "student-4",
        actorId: "marker-three",
        text: "50",
      }),
    /not a participating/,
  );
});
test("editing own submitted score requires resubmission", () => {
  let state = submitBatch(makeSampleData(), "2027-p6", "sasindu");
  state = saveScore(state, {
    testId: "2027-p6",
    studentKey: "student-0",
    actorId: "sasindu",
    text: "115",
  });
  assert.equal(
    state.submissions[submissionKey("2027-p6", "sasindu")].status,
    "Needs resubmission",
  );
});
test("admin correction keeps another marker submitted and preserves original ownership", () => {
  let state = submitBatch(makeSampleData(), "2027-p6", "marker-three");
  state = saveScore(state, {
    testId: "2027-p6",
    studentKey: "student-4",
    actorId: "sasindu",
    text: "79",
  });
  assert.equal(
    state.submissions[submissionKey("2027-p6", "marker-three")].status,
    "Submitted",
  );
  assert.equal(
    state.scores.find(
      (score) => score.studentKey === "student-4" && score.testId === "2027-p6",
    ).markerId,
    "marker-three",
  );
});
test("a new student receives a unique temporary ID; duplicate canonical IDs are rejected", () => {
  const state = makeSampleData();
  const next = addStudent(state, {
    year: 2027,
    name: "New Student",
    school: "New School",
    stream: "Bio",
    id: "",
  });
  assert.equal(next.students.at(-1).id, "TEMP/SC/2027/000002");
  assert.throws(
    () =>
      addStudent(state, {
        year: 2027,
        name: "Other Student",
        school: "School",
        stream: "Maths",
        id: "006900",
      }),
    /already exists/,
  );
});
test("ranking adds raw marks, includes a recorded zero, excludes absences, and uses competition ties", () => {
  const state = makeSampleData();
  state.scores = [
    { testId: "2027-p6", studentKey: "student-0", cents: 100 },
    { testId: "2027-p5", studentKey: "student-0", cents: 20 },
    { testId: "2027-p6", studentKey: "student-1", cents: 120 },
    { testId: "2027-p5", studentKey: "student-2", cents: 0 },
  ];
  const rows = buildRanking(state, ["2027-p6", "2027-p5"], "Maths");
  assert.deepEqual(
    rows.map((row) => row.total),
    [120, 120, 0],
  );
  assert.deepEqual(
    rows.map((row) => row.rank),
    [1, 1, 3],
  );
  assert.equal(rows.length, 3);
  assert.deepEqual(buildRanking(state, ["2027-p6", "2028-p5"], "Maths"), []);
});

