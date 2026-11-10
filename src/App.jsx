import React, { useEffect, useRef, useState } from "react";
import SharedStudents from "./SharedStudents.jsx";
import SharedMarks from "./SharedMarks.jsx";
import { testCompletion, fillMissingWithZeroes, closeCompletedTest } from "./testCompletion.js";
import {
  addStudent,
  buildRanking,
  formatMark,
  parseMark,
  saveScore,
  searchStudents,
  submissionKey,
  submitBatch,
} from "./domain.js";
import {
  accountActor, accountWorkspaceKey, createAccountSample, readAccountWorkspace,
} from "./accountWorkspace.js";

const draftKey = (testId, actorId, studentKey) =>
  `${testId}:${actorId}:${studentKey}`;
function initialDrafts(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}

function Icon({ name, size = 20, ...props }) {
  const shapes = {
    home: (
      <>
        <path d="m3 10 9-7 9 7v10H3Z" />
        <path d="M9 20v-7h6v7" />
      </>
    ),
    test: (
      <>
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path d="M9 4V2h6v2M9 10h6M9 14h6M9 18h3" />
      </>
    ),
    people: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5" />
      </>
    ),
    chart: (
      <>
        <path d="M4 3v18h17M9 17v-5m5 5V7m5 10V4" />
      </>
    ),
    book: (
      <>
        <path d="M12 5C8 2 4 3 2 4v16c3-2 7-2 10 0 3-2 7-2 10 0V4c-3-1-7-2-10 1Zm0 0v15" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    check: <path d="m5 12 4 4L19 6" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    table: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 10h18M9 4v16" />
      </>
    ),
    card: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 8h8M8 12h8M8 16h4" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7v1" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V6a4 4 0 0 1 8 0v4" />
      </>
    ),
    reset: (
      <>
        <path d="M3 10a9 9 0 1 1 1 8M3 4v6h6" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {shapes[name] || shapes.test}
    </svg>
  );
}
function AtomLogo() {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <circle cx="20" cy="20" r="3" fill="currentColor" />
      <ellipse
        cx="20"
        cy="20"
        rx="17"
        ry="6.5"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <ellipse
        cx="20"
        cy="20"
        rx="17"
        ry="6.5"
        stroke="currentColor"
        strokeWidth="1.4"
        transform="rotate(60 20 20)"
      />
      <ellipse
        cx="20"
        cy="20"
        rx="17"
        ry="6.5"
        stroke="currentColor"
        strokeWidth="1.4"
        transform="rotate(120 20 20)"
      />
    </svg>
  );
}
function Badge({ children, tone = "" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

// A recorded zero is still a mark. Unsaved drafts also count as work.
export function removeEmptyTest(state, testKey, actorKey, drafts) {
  if (!state.users.find((user) => user.key === actorKey)?.admin)
    throw new Error("Only admins can remove tests.");
  if (!state.tests.some((item) => item.key === testKey))
    throw new Error("This test no longer exists.");
  if (state.scores.some((score) => score.testId === testKey))
    throw new Error("This test contains marks and cannot be removed.");
  if (Object.values(drafts).some((draft) => draft.testId === testKey))
    throw new Error("This test has unfinished drafts. Save or discard them before removing it.");
  if (state.history.some((entry) => entry.testId === testKey))
    throw new Error("This test has a marks history and cannot be removed.");
  return {
    ...state,
    tests: state.tests.filter((item) => item.key !== testKey),
    submissions: Object.fromEntries(
      Object.entries(state.submissions).filter(([key]) => !key.startsWith(`${testKey}:`)),
    ),
  };
}

export function removeTestEntry(state, testKey, studentKey, actorKey, drafts) {
  const actor = state.users.find((user) => user.key === actorKey);
  const test = state.tests.find((item) => item.key === testKey);
  const score = state.scores.find((item) => item.testId === testKey && item.studentKey === studentKey);
  if (!actor || test?.status !== "Open")
    throw new Error("Entries can only be removed while the test is open.");
  if (!actor.admin && (!test.participants.includes(actorKey) || (score && score.markerId !== actorKey)))
    throw new Error("You can only remove your own entries.");
  const removedDrafts = Object.entries(drafts).filter(([, draft]) =>
    draft.testId === testKey && draft.studentKey === studentKey &&
    (actor.admin || draft.actorId === actorKey),
  );
  if (!score && !removedDrafts.length) throw new Error("There is no entry to remove.");
  const removedKeys = new Set(removedDrafts.map(([key]) => key));
  const submissions = { ...state.submissions };
  const key = submissionKey(testKey, actorKey);
  // An admin changing another marker's entry does not require their resubmission.
  const ownEntry = score ? score.markerId === actorKey : removedDrafts.some(([, d]) => d.actorId === actorKey);
  if (ownEntry && submissions[key]?.status === "Submitted")
    submissions[key] = { ...submissions[key], status: "Needs resubmission" };
  return {
    data: {
      ...state,
      scores: state.scores.filter((item) => item !== score),
      submissions,
      history: [...state.history, {
        testId: testKey, studentKey, actorId: actorKey,
        before: score?.cents ?? null, after: null,
        action: "Removed entry", at: new Date().toISOString(),
      }],
    },
    drafts: Object.fromEntries(Object.entries(drafts).filter(([key]) => !removedKeys.has(key))),
  };
}

export default function App({ profile }) {
  if (!profile?.id || !profile.is_active) {
    return <p className="auth-loading">An active signed-in profile is required.</p>;
  }
  return <SharedMarks key={`${profile.id}:${profile.role}`} profile={profile} />;
}

function Workspace({ profile }) {
  const workspaceKey = accountWorkspaceKey(profile.id);
  const DRAFT_KEY = `${workspaceKey}:drafts`;
  const [initialWorkspace] = useState(() => readAccountWorkspace(profile));
  const writeWorkspace = (next) => localStorage.setItem(workspaceKey, JSON.stringify(next));
  const [data, setData] = useState(initialWorkspace.data);
  const dataRef = useRef(data);
  const [storageError, setStorageError] = useState(initialWorkspace.error);
  const [drafts, setDrafts] = useState(() => initialDrafts(DRAFT_KEY));
  const [draftErrors, setDraftErrors] = useState({});
  const actorId = profile.id;
  const [testId, setTestId] = useState(() =>
    data.tests.find((item) => item.key === "2027-p6")?.key || data.tests[0]?.key || "",
  );
  const [emptyYear, setEmptyYear] = useState(2027);
  const [page, setPage] = useState("marks");
  const [mode, setMode] = useState("form");
  const [query, setQuery] = useState("");
  const [studentKey, setStudentKey] = useState("");
  const [entryScope, setEntryScope] = useState("mine");
  const [stream, setStream] = useState("Maths");
  const [combined, setCombined] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [notice, setNotice] = useState("");
  const actor = accountActor(profile);
  const test = data.tests.find((item) => item.key === testId) || {
    key: "", year: emptyYear, status: "None", participants: [], max: 0,
  };
  const selected = data.students.find((student) => student.key === studentKey);
  const groupStudents = data.students.filter(
    (student) => student.year === test.year && student.active,
  );
  const groupTests = data.tests.filter((item) => item.year === test.year);
  const myScores = data.scores.filter(
    (score) => score.testId === testId && score.markerId === actorId,
  );
  const testScores = data.scores.filter((score) => score.testId === testId);
  const currentDrafts = Object.entries(drafts).filter(
    ([, draft]) => draft.actorId === actorId && draft.testId === testId,
  );
  const submitted =
    data.submissions[submissionKey(testId, actorId)]?.status || "In progress";
  const canParticipate =
    test.status === "Open" && test.participants.includes(actorId);
  const completion = test.key ? testCompletion(data, testId, drafts) : null;

  // Commit browser storage BEFORE showing success or updating React's state.
  function commit(next) {
    if (initialWorkspace.error)
      throw new Error("Reset the demo before saving over unreadable data.");
    writeWorkspace(next);
    dataRef.current = next;
    setData(next);
    setStorageError("");
  }

  function updateDraft(student, text) {
    const key = draftKey(testId, actorId, student.key);
    const next = {
      ...drafts,
      [key]: { testId, actorId, studentKey: student.key, text },
    };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
      setStorageError("");
    } catch {
      setStorageError(
        "Browser storage is unavailable. Keep this page open; your edits have not been saved.",
      );
    }
    setDrafts(next);
    setDraftErrors((previous) => {
      const nextErrors = { ...previous };
      delete nextErrors[key];
      return nextErrors;
    });
    setNotice("");
  }

  // A debounce groups typing into one meaningful score save, rather than saving
  // each digit (typing 37.25 should not create four separate history entries).
  useEffect(() => {
    const timer = setTimeout(() => {
      const completed = [];
      const errors = {};
      Object.entries(drafts)
        .filter(([, draft]) => draft.actorId === actorId)
        .forEach(([key, draft]) => {
          try {
            const next = saveScore(dataRef.current, draft);
            commit(next);
            completed.push(key);
          } catch (error) {
            errors[key] = error.message;
          }
        });
      setDraftErrors(errors);
      if (completed.length) {
        const remaining = Object.fromEntries(
          Object.entries(drafts).filter(([key]) => !completed.includes(key)),
        );
        try {
          localStorage.setItem(DRAFT_KEY, JSON.stringify(remaining));
        } catch {
          setStorageError(
            "Scores were saved, but draft cleanup failed. They will be checked again on your next visit.",
          );
        }
        setDrafts(remaining);
      }
    }, 650);
    return () => clearTimeout(timer);
  }, [drafts, actorId]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  function switchTest(key) {
    setTestId(key);
    setStudentKey("");
    setQuery("");
    setNotice("");
  }
  function removeCurrentTest() {
    try {
      // Validate before confirmation, then recheck the latest state before saving.
      removeEmptyTest(dataRef.current, testId, actorId, drafts);
      if (!window.confirm(
        `Remove ${test.year} · ${test.phase} · ${test.paper}? This cannot be undone.`,
      )) return;
      const next = removeEmptyTest(dataRef.current, testId, actorId, drafts);
      const nextTest = next.tests.find((item) => item.year === test.year);
      commit(next);
      setEmptyYear(test.year);
      switchTest(nextTest?.key || "");
      setNotice("Empty test removed.");
    } catch (error) {
      setNotice(error.message);
    }
  }

  function finish() {
    try {
      if (currentDrafts.length)
        throw new Error(
          "Wait for valid scores to save and fix or discard any incomplete drafts first.",
        );
      commit(submitBatch(dataRef.current, testId, actorId));
      setNotice(
        "Your batch is submitted. You can still correct your own scores while this test is open.",
      );
    } catch (error) {
      setNotice(error.message);
    }
  }
  // Recheck persistent state around confirmation. Another tab may have saved
  // a score since this tab rendered; ask for review rather than overwriting it.
  function completionSnapshot() {
    if (initialWorkspace.error) throw new Error("Reset the demo before changing unreadable data.");
    const latest = readAccountWorkspace(profile);
    if (latest.error) throw new Error(latest.error);
    if (JSON.stringify(latest.data) !== JSON.stringify(dataRef.current)) {
      dataRef.current = latest.data;
      setData(latest.data);
      const latestDrafts = initialDrafts(DRAFT_KEY);
      setDrafts(latestDrafts);
      throw new Error("This workspace changed in another tab. Review the updated scores and try again.");
    }
    // Parse strictly: corrupt drafts must block bulk completion.
    let storedDrafts;
    try { storedDrafts = JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}"); }
    catch { throw new Error("Saved drafts could not be read. Review them before completing this test."); }
    if (!storedDrafts || typeof storedDrafts !== "object" || Array.isArray(storedDrafts))
      throw new Error("Saved drafts could not be read. Review them before completing this test.");
    return { state: dataRef.current, drafts: { ...storedDrafts, ...drafts } };
  }
  function addMissingZeroes() {
    try {
      let snapshot = completionSnapshot();
      const preview = fillMissingWithZeroes(snapshot.state, testId, actorId, snapshot.drafts);
      const count = preview.scores.length - snapshot.state.scores.length;
      if (!count) { setNotice("Every active student already has a score."); return; }
      if (!window.confirm(
        `Add zeroes for ${count} student(s) with no score in ${test.year} · ${test.phase} · ${test.paper}? ` +
        "Check that every marker has finished entering marks. Existing scores will stay unchanged. " +
        "This does not submit any batches or close the test.",
      )) return;
      snapshot = completionSnapshot();
      const next = fillMissingWithZeroes(snapshot.state, testId, actorId, snapshot.drafts);
      const added = next.scores.length - snapshot.state.scores.length;
      commit(next);
      setNotice(`Added zeroes for ${added} student(s). Existing scores and batch submissions were preserved.`);
    } catch (error) { setNotice(error.message); }
  }
  function closeCurrentTest() {
    try {
      let snapshot = completionSnapshot();
      closeCompletedTest(snapshot.state, testId, actorId, snapshot.drafts);
      if (!window.confirm(`Close ${test.year} · ${test.phase} · ${test.paper}? Scores will become read-only.`)) return;
      snapshot = completionSnapshot();
      commit(closeCompletedTest(snapshot.state, testId, actorId, snapshot.drafts));
      setNotice("Test closed. Scores are now read-only.");
    } catch (error) { setNotice(error.message); }
  }
  function reset() {
    if (
      !window.confirm(
        "Reset this learning demo? This removes sample edits and drafts in this browser.",
      )
    )
      return;
    try {
      const fresh = createAccountSample(profile);
      writeWorkspace(fresh);
      localStorage.removeItem(DRAFT_KEY);
      initialWorkspace.error = "";
      dataRef.current = fresh;
      setData(fresh);
      setTestId(fresh.tests[0]?.key || "");
      setEmptyYear(2027);
      setDrafts({});
      setDraftErrors({});
      setStorageError("");
      setStudentKey("");
      setQuery("");
      setNotice("Sample workspace reset.");
    } catch {
      setStorageError("Could not reset browser storage.");
    }
  }
  function discardDraft(key) {
    const remaining = { ...drafts };
    delete remaining[key];
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(remaining));
      setDrafts(remaining);
    } catch {
      setStorageError("Could not discard this draft from browser storage.");
    }
  }
  function removeEntry(student) {
    try {
      removeTestEntry(dataRef.current, testId, student.key, actorId, drafts);
      if (!window.confirm(`Remove ${student.name}'s mark and draft from this test? The student stays in the database.`)) return;
      const next = removeTestEntry(dataRef.current, testId, student.key, actorId, drafts);
      // Clear drafts before saving the removal so autosave cannot restore the entry.
      localStorage.setItem(DRAFT_KEY, JSON.stringify(next.drafts));
      try {
        commit(next.data);
      } catch (error) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
        throw error;
      }
      setDrafts(next.drafts);
      setDraftErrors({});
      setStudentKey("");
      setQuery("");
      setNotice("Entry removed from this test. The student remains in the database.");
    } catch (error) {
      setNotice(error.message);
    }
  }

  function scoreInput(student, compact = false) {
    const score = testScores.find((item) => item.studentKey === student.key);
    const key = draftKey(testId, actorId, student.key);
    const value = drafts[key]?.text ?? (score ? formatMark(score.cents) : "");
    const error = drafts[key]
      ? parseMark(value, test.max).error || draftErrors[key]
      : "";
    const editable =
      test.status === "Open" &&
      (score
        ? score.markerId === actorId
          ? canParticipate
          : actor.admin
        : canParticipate);
    return (
      <div className={compact ? "cell-score" : "score-field"}>
        {!compact && (
          <label htmlFor={`score-${student.key}`}>
            Final score <span>out of {test.max}</span>
          </label>
        )}
        <div className="score-input-wrap">
          <input
            id={`score-${student.key}`}
            aria-label={`Score for ${student.name}`}
            inputMode="decimal"
            autoComplete="off"
            placeholder={compact ? "—" : "0.00"}
            value={value}
            disabled={!editable}
            aria-invalid={!!error}
            onChange={(event) => updateDraft(student, event.target.value)}
          />
          {!compact && <span>/ {test.max}</span>}
        </div>
        {!compact && (
          <p className={error ? "field-error" : "field-help"}>
            {error ||
              (score && score.markerId !== actorId
                ? `Entered by ${data.users.find((user) => user.key === score.markerId)?.name}. Admin corrections are recorded.`
                : "Up to two decimal places. Zero is a valid score.")}
          </p>
        )}
        {compact && error && <small className="field-error">{error}</small>}
        {test.status === "Open" &&
          (actor.admin || (test.participants.includes(actorId) && (!score || score.markerId === actorId))) &&
          (score || Object.values(drafts).some((draft) =>
            draft.testId === testId && draft.studentKey === student.key &&
            (actor.admin || draft.actorId === actorId),
          )) && (
            <button className="remove-test-button" onClick={() => removeEntry(student)}>
              Remove entry
            </button>
          )}
      </div>
    );
  }
  const navigation = [
    { key: "home", icon: "home", label: "Overview" },
    { key: "marks", icon: "test", label: "Test workspace" },
    { key: "students", icon: "people", label: "Students" },
    { key: "rankings", icon: "chart", label: "Rankings" },
    { key: "learn", icon: "book", label: "Learning notes" },
  ];
  const rankedTests = combined
    ? groupTests
        .filter((item) => item.status !== "Cancelled")
        .map((item) => item.key)
    : [testId];
  const canViewRanking =
    actor.admin ||
    rankedTests.every(
      (key) => data.tests.find((item) => item.key === key)?.status === "Closed",
    );
  const ranking = canViewRanking ? buildRanking(data, rankedTests, stream) : [];
  const rows = (entryScope === "mine" ? myScores : testScores)
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setPage("home");
          }}
        >
          <span className="brand-mark">
            <AtomLogo />
          </span>
          <span>
            <strong>Physics</strong>
            <small>Samitha Rathnayake</small>
          </span>
        </a>
        <div className="workspace-label">MARKS MANAGEMENT</div>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              key={item.key}
              className={page === item.key ? "nav-item active" : "nav-item"}
              onClick={() => setPage(item.key)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {page === item.key && <i />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="lesson-card">
            <span className="tiny-label">BUILDING TOGETHER</span>
            <strong>One step at a time.</strong>
            <p>Explore the first working stage of your marks system.</p>
            <button onClick={() => setPage("learn")}>
              See how it works <Icon name="arrow" size={15} />
            </button>
          </div>
          <button className="reset-button" onClick={reset}>
            <Icon name="reset" size={15} />
            Reset sample data
          </button>
          <div className="sidebar-foot">
            STAGE 02 <span>Account profiles</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span>{" "}
            <strong>
              {navigation.find((item) => item.key === page)?.label}
            </strong>
          </div>
          <div className="topbar-actions">
            <Badge tone="neutral">{page === "students" ? "Shared database" : "Practice workspace"}</Badge>
            <span className="profile-avatar">{actor.initials}</span>
            <span className="account-label" aria-label="Signed-in account" title={`${actor.name} · ${actor.admin ? "Admin & marker" : "Marker"}`}>
              {actor.name} · {actor.admin ? "Admin & marker" : "Marker"}
            </span>
          </div>
        </header>
        <main>
          <div className="demo-note">
            <Icon name="info" size={17} />
            <span>
              <strong>Learning build · Stage 2</strong>
              <span className="note-divider">—</span>{page === "students"
                ? "Student records on this page are shared through Supabase."
                : "Practice tests and marks use fictional students and save in this browser only. Use Students for the shared database."}
            </span>
          </div>
          {storageError && (
            <div className="alert" role="alert">
              {storageError}
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              <Icon name="info" size={18} />
              {notice}
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          )}

          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === "learn"
                  ? "LEARN AS WE BUILD"
                  : page === "students" ? "SHARED DATABASE" : `${test.year} EXAM GROUP`}
              </div>
              <h1>
                {page === "marks"
                  ? "Test workspace"
                  : page === "home"
                    ? `Welcome back, ${actor.name}.`
                    : page === "students"
                      ? "Student directory"
                      : page === "rankings"
                        ? "Rankings"
                        : "Learning notes"}
              </h1>
              <p>
                {page === "marks"
                  ? "Find a student, enter their score, and we’ll take care of the saving."
                  : page === "students"
                    ? "Search the shared list by name, school, or official student number."
                    : page === "rankings"
                      ? "Explore live sample rankings, calculated from the scores you enter."
                      : page === "home"
                        ? "A clear view of your tests, students, and marking progress."
                        : "A small React app, with the rules kept easy to follow."}
              </p>
            </div>
            {page !== "learn" && page !== "students" && (
              <label className="group-picker">
                <span>Exam-year group</span>
                <select
                  value={test.year}
                  onChange={(event) => {
                    const year = Number(event.target.value);
                    setEmptyYear(year);
                    switchTest(data.tests.find((item) => item.year === year)?.key || "");
                  }}
                >
                  <option value="2027">2027 students</option>
                  <option value="2028">2028 students</option>
                </select>
              </label>
            )}
          </div>

          {page === "home" && (
            <>
              <div className="stats-grid">
                <Stat
                  label="Students in this group"
                  value={groupStudents.length}
                  icon="people"
                  caption="Maths and Bio"
                />
                <Stat
                  label="Tests"
                  value={groupTests.length}
                  icon="test"
                  caption="Across all phases"
                />
                <Stat
                  label="Scores in current test"
                  value={testScores.length}
                  icon="chart"
                  caption="One score per student"
                />
                <Stat
                  label="Your scores"
                  value={myScores.length}
                  icon="check"
                  caption={submitted}
                />
              </div>
              <div className="section-head">
                <div>
                  <h2>Your tests</h2>
                  <p>Open a test to view entries and continue marking.</p>
                </div>
              </div>
              <div className="test-grid">
                {groupTests.map((item) => (
                  <button
                    className="test-card panel"
                    key={item.key}
                    onClick={() => {
                      switchTest(item.key);
                      setPage("marks");
                    }}
                  >
                    <div className="test-card-top">
                      <span className="icon-tile">
                        <Icon name="test" />
                      </span>
                      <Badge tone={item.status === "Open" ? "" : "neutral"}>
                        {item.status}
                      </Badge>
                    </div>
                    <p>{item.phase}</p>
                    <h2>{item.paper}</h2>
                    <span>
                      {item.max} marks · {item.participants.length} markers
                    </span>
                    <div className="test-card-foot">
                      Open workspace <Icon name="arrow" size={18} />
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {(page === "marks" || page === "home" || page === "rankings") && !test.key && (
            <section className="panel empty-tests">
              <h2>No tests in {test.year}</h2>
              <p>You can still view students or choose another exam-year group.</p>
              <p>This learning version does not yet include test creation. Reset demo restores the sample tests.</p>
            </section>
          )}
          {page === "marks" && test.key && (
            <>
              <section className="test-strip">
                <span className="icon-tile">
                  <Icon name="test" />
                </span>
                <div>
                  <strong>
                    {test.phase} <span>·</span> {test.paper}
                  </strong>
                  <small>
                    {new Date(`${test.date}T12:00:00`).toLocaleDateString(
                      "en-GB",
                      { day: "numeric", month: "short", year: "numeric" },
                    )}{" "}
                    <span>·</span> {test.max} maximum marks
                  </small>
                </div>
                <Badge tone={test.status === "Open" ? "" : "neutral"}>
                  {test.status === "Open" && <span className="status-dot" />}
                  {test.status}
                </Badge>
                <label className="test-picker">
                  <span className="sr-only">Choose test</span>
                  <select
                    value={testId}
                    onChange={(event) => switchTest(event.target.value)}
                  >
                    {groupTests.map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.phase} · {item.paper}
                      </option>
                    ))}
                  </select>
                </label>
                {actor.admin && (
                  <button className="remove-test-button" onClick={removeCurrentTest}>
                    Remove test
                  </button>
                )}
              </section>
              <div className="stats-grid">
                <Stat
                  label="Your entries"
                  value={myScores.length}
                  icon="card"
                  caption="Final scores entered"
                />
                <Stat
                  label="All entries"
                  value={testScores.length}
                  icon="people"
                  caption={`of ${groupStudents.length} sample students`}
                />
                <Stat
                  label="Your batch"
                  value={
                    submitted === "Submitted"
                      ? "Submitted"
                      : submitted === "Needs resubmission"
                        ? "Review needed"
                        : "In progress"
                  }
                  icon="clock"
                  caption={
                    submitted === "Needs resubmission"
                      ? "A score changed after submission"
                      : "You can edit while the test is open"
                  }
                />
                <Stat
                  label="Browser saving"
                  value={currentDrafts.length ? "Pending" : "Up to date"}
                  icon="check"
                  caption={
                    currentDrafts.length
                      ? `${currentDrafts.length} draft(s) to save or review`
                      : "Saved locally on this device"
                  }
                />
              </div>
              <div className="section-head entry-heading">
                <div>
                  <h2>Enter marks</h2>
                  <p>Enter each paper’s final score.</p>
                </div>
                <div className="segmented" aria-label="Marks entry layout">
                  <button
                    className={mode === "form" ? "selected" : ""}
                    onClick={() => setMode("form")}
                  >
                    <Icon name="card" size={16} />
                    Individual
                  </button>
                  <button
                    className={mode === "table" ? "selected" : ""}
                    onClick={() => setMode("table")}
                  >
                    <Icon name="table" size={16} />
                    Table
                  </button>
                </div>
              </div>
              {test.status !== "Open" && (
                <div className="readonly-note">
                  <Icon name="lock" size={17} />
                  This test is closed. You can review its entries and rankings.
                </div>
              )}
              {mode === "form" ? (
                <div className="entry-grid">
                  <section className="panel entry-panel">
                    <div className="panel-heading">
                      <span className="step-number">01</span>
                      <div>
                        <h3>Search for a student</h3>
                        <p>Search by name, school, or student ID.</p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => setShowAdd(true)}
                      >
                        <Icon name="plus" size={16} />
                        Add student
                      </button>
                    </div>
                    <div className="search-box">
                      <Icon name="search" />
                      <input
                        aria-label="Find a student"
                        placeholder="e.g. Amal, Rahula, or 6900"
                        value={query}
                        onChange={(event) => {
                          setQuery(event.target.value);
                          setStudentKey("");
                        }}
                      />
                      <kbd>/</kbd>
                    </div>
                    {selected ? (
                      <>
                        <div className="selected-student">
                          <span
                            className={`student-avatar ${selected.stream === "Bio" ? "bio-avatar" : ""}`}
                          >
                            {selected.name
                              .split(" ")
                              .map((word) => word[0])
                              .slice(0, 2)
                              .join("")}
                          </span>
                          <div>
                            <strong>{selected.name}</strong>
                            <small>{selected.id}</small>
                            <p>{selected.school}</p>
                          </div>
                          <Badge tone={selected.stream === "Bio" ? "bio" : ""}>
                            {selected.stream}
                          </Badge>
                        </div>
                        <div className="score-area">
                          <div className="mini-step">
                            <span className="step-number">02</span>
                            <h3>Enter the final score</h3>
                          </div>
                          {scoreInput(selected)}
                          <div className="save-foot">
                            <span>
                              <span
                                className={`status-dot ${drafts[draftKey(testId, actorId, selected.key)] ? "pending-dot" : ""}`}
                              />
                              {drafts[draftKey(testId, actorId, selected.key)]
                                ? "Draft saved locally · checking score"
                                : testScores.some(
                                      (score) =>
                                        score.studentKey === selected.key,
                                    )
                                  ? "Saved on this browser"
                                  : "Autosaves when you enter a valid score"}
                            </span>
                            <button
                              className="text-button"
                              onClick={() => {
                                setStudentKey("");
                                setQuery("");
                              }}
                            >
                              Next student <Icon name="arrow" size={16} />
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="search-results">
                        {searchStudents(data.students, query, test.year)
                          .slice(0, query ? 8 : 4)
                          .map((student) => (
                            <button
                              className="student-result"
                              key={student.key}
                              onClick={() => setStudentKey(student.key)}
                            >
                              <span className="student-avatar">
                                {student.name
                                  .split(" ")
                                  .map((word) => word[0])
                                  .slice(0, 2)
                                  .join("")}
                              </span>
                              <span className="student-result-text">
                                <strong>{student.name}</strong>
                                <small>{student.id}</small>
                              </span>
                              <Badge
                                tone={student.stream === "Bio" ? "bio" : ""}
                              >
                                {student.stream}
                              </Badge>
                              <Icon name="arrow" size={16} />
                            </button>
                          ))}
                        {!searchStudents(data.students, query, test.year)
                          .length && (
                          <div className="empty-state">
                            No matching student.
                            <button
                              className="text-button"
                              onClick={() => setShowAdd(true)}
                            >
                              Add a new student <Icon name="plus" size={15} />
                            </button>
                          </div>
                        )}
                        <p className="search-hint">
                          {query
                            ? "Check the student’s name before entering marks."
                            : "A few students to get you started. Search to find anyone."}
                        </p>
                      </div>
                    )}
                  </section>
                  <aside className="panel progress-panel">
                    <div className="section-kicker">YOUR MARKING DESK</div>
                    <h3>Your batch</h3>
                    <p>
                      Scores save as you go. Submit your batch when you’ve
                      checked your papers.
                    </p>
                    <div className="progress-number">
                      {myScores.length}
                      <span>papers entered</span>
                    </div>
                    <div className="progress-track">
                      <span
                        style={{
                          width: `${Math.min(100, (myScores.length / Math.max(1, groupStudents.length)) * 100)}%`,
                        }}
                      />
                    </div>
                    <div className="progress-detail">
                      <span>Across this test</span>
                      <strong>{testScores.length} entries</strong>
                    </div>
                    <div className="submission-box">
                      <Icon
                        name={submitted === "Submitted" ? "check" : "clock"}
                        size={18}
                      />
                      <span>{submitted}</span>
                    </div>
                    <button
                      className="primary-button"
                      onClick={finish}
                      disabled={!canParticipate || currentDrafts.length > 0}
                    >
                      <Icon name="check" size={18} />
                      {submitted === "Submitted"
                        ? "Batch submitted"
                        : "Finish & Submit"}
                    </button>
                    <small>
                      Submitting won’t lock your scores. Only an admin closes
                      the test.
                    </small>
                  </aside>
                </div>
              ) : (
                <section className="panel">
                  <div className="panel-title-row">
                    <h3>Student score sheet</h3>
                    <span className="muted">
                      Changes autosave in this browser
                    </span>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Student</th>
                          <th>Student ID</th>
                          <th>Stream</th>
                          <th>Score / {test.max}</th>
                          <th>Entered by</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupStudents.map((student) => {
                          const score = testScores.find(
                            (item) => item.studentKey === student.key,
                          );
                          return (
                            <tr key={student.key}>
                              <td>
                                <strong>{student.name}</strong>
                                <small>{student.school}</small>
                              </td>
                              <td className="mono">{student.id}</td>
                              <td>
                                <Badge
                                  tone={student.stream === "Bio" ? "bio" : ""}
                                >
                                  {student.stream}
                                </Badge>
                              </td>
                              <td>{scoreInput(student, true)}</td>
                              <td>
                                {score
                                  ? data.users.find(
                                      (user) => user.key === score.markerId,
                                    )?.name
                                  : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="table-footer">
                    <span>
                      {currentDrafts.length
                        ? `${currentDrafts.length} pending draft(s)`
                        : "Your scores are up to date on this browser."}
                    </span>
                    <button
                      className="primary-button"
                      disabled={!canParticipate || currentDrafts.length > 0}
                      onClick={finish}
                    >
                      Finish & Submit <Icon name="check" size={16} />
                    </button>
                  </div>
                </section>
              )}
              {currentDrafts.length > 0 && (
                <div className="draft-review">
                  <strong>Drafts waiting to save</strong>
                  {currentDrafts.map(([key, draft]) => (
                    <div key={key}>
                      <span>
                        {
                          data.students.find(
                            (student) => student.key === draft.studentKey,
                          )?.name
                        }
                        :{" "}
                        {draftErrors[key] ||
                          parseMark(draft.text, test.max).error ||
                          "Saving…"}
                      </span>
                      <button
                        className="text-button"
                        onClick={() => {
                          setStudentKey(draft.studentKey);
                          setMode("form");
                        }}
                      >
                        Review
                      </button>
                      <button
                        className="text-button"
                        onClick={() => discardDraft(key)}
                      >
                        Discard draft
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {actor.admin && test.status === "Open" && (
                <section className="panel completion-panel" aria-labelledby="completion-heading">
                  <div>
                    <h3 id="completion-heading">Complete this test</h3>
                    <p>After every marker has finished entering marks, add zeroes for students who did not take this test.</p>
                    <p className="completion-summary" role="status">
                      {completion.missing.length} of {completion.total} active students have no score.
                      {" "}{test.participants.length - completion.unsubmitted.length} of {test.participants.length} marker batches submitted.
                    </p>
                  </div>
                  {completion.missing.length > 0 && (
                    <details className="completion-review">
                      <summary>Review students with no score ({completion.missing.length})</summary>
                      <ul>{completion.missing.map((student) => (
                        <li key={student.key}><strong>{student.name}</strong><span>{student.id} · {student.stream}</span></li>
                      ))}</ul>
                    </details>
                  )}
                  {completion.unsubmitted.length > 0 && (
                    <details className="completion-review">
                      <summary>Waiting for {completion.unsubmitted.length} marker batch(es)</summary>
                      <ul>{completion.unsubmitted.map((id) => (
                        <li key={id}>{data.users.find((user) => user.key === id)?.name || id}
                          <span>{data.submissions[submissionKey(testId, id)]?.status || "In progress"}</span>
                        </li>
                      ))}</ul>
                    </details>
                  )}
                  <div className="completion-actions">
                    <button className="secondary-button" onClick={addMissingZeroes}
                      disabled={!completion.missing.length || completion.pendingDrafts > 0}
                      aria-describedby="completion-help">
                      Add zeroes to remaining students ({completion.missing.length})
                    </button>
                    <button className="primary-button" onClick={closeCurrentTest}
                      disabled={completion.missing.length > 0 || completion.pendingDrafts > 0 || completion.unsubmitted.length > 0}
                      aria-describedby="completion-help">Close test</button>
                  </div>
                  <p id="completion-help">
                    {completion.pendingDrafts > 0
                      ? "Save or discard all drafts for this test first."
                      : "Zeroes fill empty scores only. Each marker must still use Finish & Submit. Closing requires every batch submitted and every active student scored."}
                  </p>
                  <p className="completion-local-note">These controls use this account’s local practice test and roster. Shared database marks and cross-account submissions are not connected yet.</p>
                </section>
              )}
              <section className="panel recent-panel">
                <div className="panel-title-row">
                  <div>
                    <h3>
                      Entries at a glance{" "}
                      <span className="count-pill">{rows.length}</span>
                    </h3>
                    <p>
                      A shared view. Every score stays linked to its marker.
                    </p>
                  </div>
                  <div className="segmented small">
                    <button
                      className={entryScope === "mine" ? "selected" : ""}
                      onClick={() => setEntryScope("mine")}
                    >
                      My entries
                    </button>
                    <button
                      className={entryScope === "all" ? "selected" : ""}
                      onClick={() => setEntryScope("all")}
                    >
                      All markers
                    </button>
                  </div>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Student</th>
                        <th>Stream</th>
                        <th>Score</th>
                        <th>Marker</th>
                        <th>Source</th>
                        <th>
                          <span className="sr-only">Action</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((score) => {
                        const student = data.students.find(
                          (item) => item.key === score.studentKey,
                        );
                        return (
                          <tr key={student.key}>
                            <td>
                              <strong>{student.name}</strong>
                              <small className="mono">{student.id}</small>
                            </td>
                            <td>
                              <Badge
                                tone={student.stream === "Bio" ? "bio" : ""}
                              >
                                {student.stream}
                              </Badge>
                            </td>
                            <td className="mark-value">
                              {formatMark(score.cents)}
                              <span> / {test.max}</span>
                            </td>
                            <td>
                              {
                                data.users.find(
                                  (user) => user.key === score.markerId,
                                )?.name
                              }
                            </td>
                            <td>
                              <span className="source-label">
                                {score.source}
                              </span>
                            </td>
                            <td>
                              <button
                                className="text-button"
                                onClick={() => {
                                  setStudentKey(student.key);
                                  setMode("form");
                                  setQuery("");
                                  window.scrollTo({
                                    top: 300,
                                    behavior: "smooth",
                                  });
                                }}
                              >
                                {test.status === "Open" &&
                                (score.markerId === actorId || actor.admin)
                                  ? "Edit"
                                  : "View"}
                                <Icon name="arrow" size={14} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {!rows.length && (
                        <tr>
                          <td colSpan="6" className="empty-cell">
                            No scores here yet. Find a student above to begin.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {page === "students" && <SharedStudents profile={profile} />}

          {page === "rankings" && test.key && (
            <>
              <div className="ranking-controls">
                <div className="segmented">
                  <button
                    className={stream === "Maths" ? "selected" : ""}
                    onClick={() => setStream("Maths")}
                  >
                    Maths
                  </button>
                  <button
                    className={stream === "Bio" ? "selected" : ""}
                    onClick={() => setStream("Bio")}
                  >
                    Bio
                  </button>
                </div>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={combined}
                    onChange={(event) => setCombined(event.target.checked)}
                  />
                  Combine all sample tests in {test.year}
                </label>
                <Badge>
                  {rankedTests.some(
                    (key) =>
                      data.tests.find((item) => item.key === key)?.status ===
                      "Open",
                  )
                    ? actor.admin
                      ? "Provisional sample"
                      : "Admin-only preview"
                    : "Closed-test sample"}
                </Badge>
              </div>
              <section className="panel">
                <div className="report-heading">
                  <span className="section-kicker">{test.year} EXAM GROUP</span>
                  <h2>Physics - Samitha Rathnayake</h2>
                  <p>
                    {combined
                      ? groupTests
                          .map((item) => `${item.phase} ${item.paper}`)
                          .join(" + ")
                      : `${test.phase} ${test.paper}`}
                  </p>
                  <strong>
                    {stream === "Maths" ? "Mathematics" : "Biology"} · Full
                    ranking
                  </strong>
                  <small>
                    Raw marks added together · missing tests contribute zero
                  </small>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Rank</th>
                        <th>Student</th>
                        <th>School</th>
                        <th>Tests recorded</th>
                        <th>{combined ? "Total marks" : "Marks"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ranking.map((row) => (
                        <tr key={row.key}>
                          <td>
                            <span
                              className={`rank-number ${row.rank <= 3 ? "top-rank" : ""}`}
                            >
                              {row.rank}
                            </span>
                          </td>
                          <td>
                            <strong>{row.name}</strong>
                          </td>
                          <td>{row.school}</td>
                          <td>
                            {row.attended} / {rankedTests.length}
                          </td>
                          <td className="mark-value">
                            {formatMark(row.total)}
                          </td>
                        </tr>
                      ))}
                      {!ranking.length && (
                        <tr>
                          <td colSpan="5" className="empty-cell">
                            {canViewRanking
                              ? `No ${stream} scores in this selection yet.`
                              : "Provisional rankings are visible to admins only. Select a closed test to review its sample ranking."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="report-note">
                  This live calculation is part of Stage 1. Saved report
                  versions, final-report access rules, PDF and Excel exports
                  will be added with the reporting stage.
                </div>
              </section>
            </>
          )}

          {page === "learn" && <LearningNotes />}
          <footer className="page-footer">
            <span>Physics - Samitha Rathnayake</span>
            <span>Built with care. Learned one step at a time.</span>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navigation.map((item) => (
          <button
            key={item.key}
            className={page === item.key ? "active" : ""}
            onClick={() => setPage(item.key)}
          >
            <Icon name={item.icon} size={20} />
            <span>
              {item.key === "marks"
                ? "Enter marks"
                : item.key === "learn"
                  ? "Learn"
                  : item.label}
            </span>
          </button>
        ))}
      </nav>
      {showAdd && (
        <AddStudentDialog
          year={test.year}
          data={data}
          onClose={() => setShowAdd(false)}
          onSave={(values) => {
            const next = addStudent(dataRef.current, values);
            commit(next);
            setStudentKey(next.students.at(-1).key);
            setQuery("");
            setShowAdd(false);
            setNotice("Practice student added locally. Use Students to add a shared database record.");
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, icon, caption }) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <Icon name={icon} size={17} />
      </div>
      <strong className={String(value).length > 7 ? "text-stat" : ""}>
        {value}
      </strong>
      <small>{caption}</small>
    </div>
  );
}

function AddStudentDialog({ year, data, onClose, onSave }) {
  const [values, setValues] = useState({
    year,
    name: "",
    school: "",
    stream: "Maths",
    id: "",
  });
  const [error, setError] = useState("");
  const firstInput = useRef(null);
  const dialogRef = useRef(null);
  useEffect(() => {
    firstInput.current?.focus();
    const handler = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const items = [
          ...dialogRef.current.querySelectorAll("button,input,select"),
        ];
        const first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
  const set = (key, value) => setValues({ ...values, [key]: value });
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-student-title"
        ref={dialogRef}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">{year} EXAM GROUP</span>
            <h2 id="add-student-title">Add a student</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close add student"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        <p>Leave the official ID blank if it isn’t known yet.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            try {
              onSave(values);
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          <label>
            Student name
            <input
              ref={firstInput}
              required
              value={values.name}
              onChange={(event) => set("name", event.target.value)}
              placeholder="Full name"
            />
          </label>
          <label>
            Official student ID <span className="muted">optional</span>
            <input
              value={values.id}
              onChange={(event) => set("id", event.target.value)}
              placeholder={`SC/${year}/number or number only`}
            />
          </label>
          <label>
            School
            <input
              required
              list="school-list"
              value={values.school}
              onChange={(event) => set("school", event.target.value)}
              placeholder="Search or type a new school"
            />
            <datalist id="school-list">
              {[...new Set(data.students.map((student) => student.school))]
                .sort()
                .map((school) => (
                  <option key={school} value={school} />
                ))}
            </datalist>
          </label>
          <label>
            Stream
            <select
              value={values.stream}
              onChange={(event) => set("stream", event.target.value)}
            >
              <option>Maths</option>
              <option>Bio</option>
            </select>
          </label>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button type="submit" className="primary-button">
              <Icon name="plus" size={17} />
              Add student
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function LearningNotes() {
  return (
    <div className="learning-grid">
      <section className="panel lesson-main">
        <span className="lesson-label">LESSON 01 · THE REACT FOUNDATION</span>
        <h2>
          From typing a score
          <br />
          to seeing it on screen.
        </h2>
        <p>
          React describes the interface using components. Each component is a
          JavaScript function that returns JSX: markup with JavaScript
          expressions inside braces.
        </p>
        <div className="code-example">
          <code>
            <span>const</span> [query, setQuery] = useState('');
            <br />
            <br />
            &lt;input
            <br />
            &nbsp; value=&#123;query&#125;
            <br />
            &nbsp; onChange=&#123;event =&gt;
            <br />
            &nbsp;&nbsp; setQuery(event.target.value)&#125;
            <br />
            /&gt;
          </code>
        </div>
        <p>
          <strong>State is the screen’s memory.</strong> Typing calls{" "}
          <code>setQuery</code>. React remembers the new value and renders
          matching students. The list is calculated from that value, rather than
          edited by hand.
        </p>
        <h3>The save journey</h3>
        <ol className="lesson-steps">
          <li>
            <strong>You type a score.</strong>
            <span>
              An input event updates a draft and keeps it in this browser.
            </span>
          </li>
          <li>
            <strong>We wait 650 milliseconds.</strong>
            <span>
              This debounce avoids saving each digit while you are still typing.
            </span>
          </li>
          <li>
            <strong>The rules check it.</strong>
            <span>
              Is it a valid decimal? Is it within the maximum? May this marker
              edit it?
            </span>
          </li>
          <li>
            <strong>A valid score is saved locally.</strong>
            <span>
              React updates the entries and recalculates the sample ranking.
            </span>
          </li>
        </ol>
      </section>
      <aside className="panel lesson-files">
        <span className="section-kicker">A SMALL, READABLE PROJECT</span>
        <h3>Where to look</h3>
        {[
          ["src/App.jsx", "Components, screen state, forms, and autosave."],
          [
            "src/domain.js",
            "Plain JavaScript rules for IDs, marks, submissions, and rankings.",
          ],
          ["src/sampleData.js", "Fictional records used in this stage."],
          ["src/storage.js", "Reads and writes the browser workspace."],
          ["src/styles.css", "Responsive layout, typography, and colours."],
          [
            "tests/domain.test.js",
            "Checks the rules independently of the interface.",
          ],
        ].map(([file, description]) => (
          <div className="file-note" key={file}>
            <code>{file}</code>
            <p>{description}</p>
          </div>
        ))}
        <div className="next-lesson">
          <strong>Next: a shared database</strong>
          <p>
            Supabase will replace local saving with authenticated server
            requests. Browser-only sample profiles are not real sign-in or
            secure permissions.
          </p>
        </div>
      </aside>
    </div>
  );
}
