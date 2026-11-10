// Test completion rules for the current browser-local marks workspace.
// These guards must also run on the server when shared test scoring is added.
import { submissionKey } from "./domain.js";

export function testCompletion(state, testId, drafts = {}) {
  const test = state.tests.find((item) => item.key === testId);
  if (!test) throw new Error("This test no longer exists.");
  const recorded = new Set(state.scores.filter((score) => score.testId === testId)
    .map((score) => score.studentKey));
  const students = state.students.filter((student) => student.active && student.year === test.year);
  return {
    missing: students.filter((student) => !recorded.has(student.key)),
    pendingDrafts: Object.values(drafts).filter((draft) => draft.testId === testId).length,
    unsubmitted: test.participants.filter((id) =>
      state.submissions[submissionKey(testId, id)]?.status !== "Submitted"),
    total: students.length,
  };
}

function checkAdminOpenTest(state, testId, actorId, drafts) {
  if (!state.users.find((user) => user.key === actorId)?.admin)
    throw new Error("Only admins can complete a test.");
  const test = state.tests.find((item) => item.key === testId);
  if (!test) throw new Error("This test no longer exists.");
  if (test.status !== "Open") throw new Error("Only open tests can be completed.");
  const completion = testCompletion(state, testId, drafts);
  if (completion.pendingDrafts)
    throw new Error("Save or discard all drafts for this test before completing it.");
  return completion;
}

export function fillMissingWithZeroes(state, testId, actorId, drafts = {}, now = new Date().toISOString()) {
  const { missing } = checkAdminOpenTest(state, testId, actorId, drafts);
  if (!missing.length) return state;
  // Set membership detects every existing score, including an actual zero.
  // Add the batch in one state update; never loop through individual commits.
  return {
    ...state,
    scores: [...state.scores, ...missing.map((student) => ({
      testId, studentKey: student.key, markerId: actorId,
      cents: 0, source: "Zero fill", updatedAt: now,
    }))],
    history: [...state.history, ...missing.map((student) => ({
      testId, studentKey: student.key, actorId,
      before: null, after: 0, action: "Filled missing score with zero", at: now,
    }))],
    // This admin completion action does not submit or invalidate paper batches.
    submissions: state.submissions,
  };
}

export function closeCompletedTest(state, testId, actorId, drafts = {}, now = new Date().toISOString()) {
  const completion = checkAdminOpenTest(state, testId, actorId, drafts);
  if (completion.missing.length)
    throw new Error("Some students still have no score. Enter their marks or add zeroes first.");
  if (completion.unsubmitted.length)
    throw new Error("Every participating marker must submit their batch before the test can close.");
  return {
    ...state,
    tests: state.tests.map((test) => test.key === testId
      ? { ...test, status: "Closed", closedAt: now, closedBy: actorId } : test),
    history: [...state.history, { testId, actorId, action: "Closed test", at: now }],
  };
}
