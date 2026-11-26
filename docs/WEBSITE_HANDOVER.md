# Physics – Samitha Rathnayaka website handover

This is a private workspace for a physics class. It keeps student records, collects paper and online marks from multiple markers, and creates ranked reports for the Maths and Bio streams. Each person signs in with a separate account. Supabase holds the shared data, and Cloudflare serves the website.

- Live website: [Physics marks workspace](https://sr-papermanagement.sasindusathmal.workers.dev/)
- Source code and change history: [SR-PaperManagement](https://github.com/SasinduSaathmal/SR-PaperManagement)

## 1. Find your way around

Sign in with an invited account. The account bar has the light/dark theme control, password settings and sign-out. The desktop sidebar and mobile navigation open the following pages.

| Page | What you can do |
| --- | --- |
| **Overview** | Choose an exam year and open a test card. Cards show phase, paper, status, date and maximum marks. Admins can create tests and review trial-data cleanup. |
| **Test workspace** (mobile: **Enter marks**) | Select a test. Search for students, enter individual or bulk paper marks, check drafts and saved entries, submit your batch and download it. Admin controls cover participants, online imports, test completion and score history. |
| **Students** | Choose an exam year and search by name, school, full ID or current official number. Add students when permitted and open **Marks history** from a student’s row. Admins manage exam groups, import students, edit student records and IDs, link repeat students, deactivate or permanently remove students, and standardize school names. |
| **Rankings & reports** | Open or download accessible saved reports. Admins select tests, generate ranked snapshots and delete individual saved report versions. |
| **Accounts** | Admins invite markers, check invitations, search accounts and manage display names, roles and access. |

**Markers** enter and submit their own paper marks for assigned open tests. Active accounts can read shared saved scores and student marks history. Markers can download their own submitted batches and access final reports. **Admins** can also manage tests, accounts, students and imports, download participant batches, see audit details and work with provisional reports. Supabase checks these permissions on the server. New accounts receive an email invitation to set a password.

## 2. Run a test from start to finish

1. **Prepare Students.** Select or create the exam year. Add students individually or import an Excel/CSV roster with name, school, stream and an optional official ID. Review import results. Students without an official ID can receive a temporary ID. Changing an ID preserves the earlier ID as a searchable alias. Explicitly link a returning student’s enrolments if their records should be connected across years.
2. **Create the test.** An admin chooses the phase, paper, date, maximum mark and participating markers. The test starts **Open**. Use participant management if staffing changes.
3. **Enter and submit paper marks.** A marker finds a student, enters the mark and checks that it has synced. A browser draft is local to that account and browser until saved to the server. **Finish & Submit** records the marker’s current batch revision. After changing their entries, the marker saves and submits again. A marker without papers can submit an empty batch. Admin confirmation is available for a participant with no recorded work, after checking with the marker about drafts on other devices.
4. **Import online marks if needed.** An admin uploads the original HTML-table export (often named `.xls`), a single-sheet `.xlsx`, or CSV. The importer matches student codes and presents questionable rows for review. Excel-converted scores may require explicit recovery confirmation. Online zeroes are skipped. An HTML index file pointing to a companion sheet needs the actual sheet or original export. Existing student details are preserved.
5. **Download submitted paper entries.** A marker can download their batch as soon as it is submitted, even while the test is open. Admins can download other participants’ submitted batches. The browser generates a fresh `Phase <phase> Paper <paper> <marker name>.xlsx` from saved entries. After resubmitting, download again for an updated copy.
6. **Close the test.** In **Complete this test**, an admin checks participant submissions and resolves pending online import rows. Review missing active students and, where appropriate, use **Add zeroes to remaining students**. Then close the test. A closed test can be reopened for corrections. Cancellation excludes a test from rankings while retaining its entries. Permanent test removal is limited to an unused test. Archiving an exam year keeps it available for reading and stops normal editing.

To standardize a school name, use **Students → Manage schools** to review a rename or merge. The old spelling can remain an alias for future searches and imports. Use deactivation to retain a student’s existing records when they stop taking tests. Use **Remove permanently** only after reviewing the student and related records the operation will remove. The admin’s **Overview** also has a separate cleanup flow for trial data in a selected year.

## 3. Read results and manage reports

- **Student marks history** shows each test in the selected enrolment’s exam year. It distinguishes a recorded zero, **No entry** and **Removed**, and shows the test status and score source. The linked-years option follows enrolments that an admin explicitly linked to the same person. Admins can open **View changes** to see the actor and before/after marks.
- **Generate a saved report** lets an admin select one or more tests in display order, choose a summary or detailed view, include IDs if needed, and set Top N or the full list. Rankings add raw marks and rank Maths and Bio separately. Ties at the cutoff are included. A missing score contributes zero to a total for a student who appears in the ranking.
- A report saved from closed tests is **Final**. A report with an open test is **Provisional** and admin-only. Each version stores its own results, so later corrections require generating a new version. The report list flags when source tests have changed.
- Reports export to Excel or to separate **Maths PDF**, **Bio PDF** and combined **All PDF** downloads. The combined PDF has separate headed sections. A single-paper Top N PDF uses the filename `<Year> Phase <number> Paper <number> Top <N> <Maths|Bio|All> Matara.pdf`. The header includes **Physics - Samitha Rathnayaka**, the selected paper(s) and stream.
- **Delete report** lets an admin review and permanently delete the selected saved snapshot from the database. Source marks and other report versions stay available. File downloads are copies on the device. The browser generates the files from the snapshot, while Supabase stores the snapshot itself.

## 4. Understand the code

React renders the interface in the browser. The Supabase client reads permitted records and calls PostgreSQL functions through Supabase RPC (remote procedure calls). Those functions enforce permissions and business rules. Cloudflare serves the compiled React site and handles the server-side invitation endpoint.

| To change or investigate | Start here |
| --- | --- |
| Boot, sign-in, account sessions and recovery | [main.jsx](../src/main.jsx), [AuthGate.jsx](../src/AuthGate.jsx), [PasswordAccess.jsx](../src/PasswordAccess.jsx), [supabaseClient.js](../src/lib/supabaseClient.js) |
| Navigation, Overview, paper entry, submissions and completion controls | [SharedMarks.jsx](../src/SharedMarks.jsx), [sharedMarksApi.js](../src/sharedMarksApi.js), [testCompletion.js](../src/testCompletion.js), [ParticipantManagement.jsx](../src/ParticipantManagement.jsx), [MarkerDownloads.jsx](../src/MarkerDownloads.jsx) |
| Student directory, history, identity, school management and imports | [SharedStudents.jsx](../src/SharedStudents.jsx), [StudentMarksHistory.jsx](../src/StudentMarksHistory.jsx), [studentsApi.js](../src/studentsApi.js), [BulkStudentImport.jsx](../src/BulkStudentImport.jsx), [studentImport.js](../src/studentImport.js) |
| Online file parsing and review | [OnlineMarksImport.jsx](../src/OnlineMarksImport.jsx), [onlineImport.js](../src/onlineImport.js), [onlineHTML.js](../src/onlineHTML.js), [dateMarkRecovery.js](../src/dateMarkRecovery.js) |
| Rankings screens, deletion and exports | [SharedReports.jsx](../src/SharedReports.jsx), [SavedReportDeletion.jsx](../src/SavedReportDeletion.jsx), [reportExport.js](../src/reportExport.js), [workbooks.js](../src/workbooks.js) |
| Accounts and email invitations | [AccountAdministration.jsx](../src/AccountAdministration.jsx), [accountAdminApi.js](../src/accountAdminApi.js), [worker/index.js](../worker/index.js) |
| Shared visuals, responsive layout, theme and branding | [styles.css](../src/styles.css), [ThemeToggle.jsx](../src/ThemeToggle.jsx), [BrandMark.jsx](../src/BrandMark.jsx), [public](../public/) |
| Database schema, permissions and business rules | [supabase](../supabase/) (migrations 001–015), [featureApi.js](../src/featureApi.js) (shared browser RPC wrapper) |
| Tests and recovery utilities | [tests](../tests/), [scripts](../scripts/), [supabase/checks](../supabase/checks/) |

Follow `main.jsx → AuthGate.jsx → App.jsx → SharedMarks.jsx` for the signed-in application. `App.jsx` also contains the earlier local practice application. Start with `SharedMarks.jsx` for changes to the live workspace.

### How the database fits together

| Records | Relationship |
| --- | --- |
| `auth.users` and `profiles` | Supabase Auth manages credentials. The app profile holds the display name, role and active state used for access checks. |
| `students`, `enrolments`, `exam_groups`, `schools` | A student is a person. An enrolment links that person to a particular exam year with an ID, school and stream. Alias tables retain earlier IDs and school spellings. |
| `marks_tests`, `test_participants`, `test_scores` | A test belongs to an exam year. Participants track assignment and batch revisions. The current score links a test to an enrolment and records source and attribution. Marks are stored as hundredths, so 18.25 is stored as 1825. |
| `test_mark_history`, `marks_write_requests` | The history records score changes. Request receipts let a retry return the original result for supported writes. Revision checks guard against saving over a newer edit. |
| `online_import_batches`, `online_import_rows` | These track imported files and row review. Accepted marks enter the shared test scores. |
| `saved_reports`, `saved_report_tests` | A saved report holds a versioned snapshot; its links record which tests and revisions it used. The browser renders downloads from the snapshot. |

For example, a paper mark starts in **Test workspace**. React validates the input and saves a local draft, then calls the score-saving database function. PostgreSQL checks the actor, the test and the expected revision before saving the score and history. Submitting records which batch revision the marker finished. Report generation reads the shared saved scores and records a new snapshot.

When investigating a rule, search by its SQL function name across the migrations. Later migrations can replace a function defined in an earlier file. When changing PDFs or Excel formatting, start in the browser export code. When changing rankings, permissions or what gets persisted, check the database functions as well.

## 5. Set up, deploy and maintain it

1. Clone the repository, open the folder with `package.json`, and run `npm ci`. Configure a local `.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for a development Supabase project. Run `npm run dev`. Local application development can use a hosted development Supabase project without Docker.
2. For a fresh database, configure Supabase email/password authentication, create the owner account, follow the owner email setup in migration 001 and apply migrations 001–015 in order. For an existing database, apply only missing migrations in order. Confirm the production Site URL, exact authentication redirect URLs and email delivery settings using the [account setup guide](IDENTITY_ACCOUNTS_PARTICIPANTS.md). Keep public signup disabled.
3. Run `npm test` and `npm run build` before publishing code changes. The test suite includes disposable database and Worker tests. Use a development or preview installation for workflow checks. Confirm account invitation delivery separately if changing email settings.
4. GitHub supplies the source to Cloudflare Workers Builds. The Vite build packages the frontend and Worker settings. Cloudflare uses separate runtime variables for invitations, `SUPABASE_URL` and the secret `SUPABASE_SECRET_KEY`. Keep the secret out of source control and browser build variables. The Worker configuration is in [wrangler.jsonc](../wrangler.jsonc). Check the Cloudflare build and refresh the website after deploying. Apply any required Supabase migration separately.
5. GitHub holds the code and migration history. Use a private PostgreSQL archive to back up student records, marks, accounts and report snapshots. Keep the backup alongside a record of the code revision and restore into an isolated project to verify it. Authentication URLs and SMTP settings are configured separately, and local browser drafts live on the device. See the [backup and recovery guide](BACKUP_AND_RECOVERY.md) and [Windows backup and restore guide](WINDOWS_NATIVE_BACKUP.md).

For feature-specific setup and troubleshooting, see the [README’s feature guides](../README.md#feature-guides).
