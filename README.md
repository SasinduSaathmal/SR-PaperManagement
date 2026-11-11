# Physics - Samitha Rathnayake

Online imports and immutable PDF/Excel report versions: see [setup and usage](docs/ONLINE_IMPORT_REPORTS.md). Apply `supabase/006_online_import_reports.sql` before deploying that update.

Current shared-database feature update: see [student import, empty-test removal and marker Excel downloads](docs/IMPORT_REMOVE_EXPORT.md). Apply `supabase/005_import_remove_export.sql` before deploying this update. The Stage 1 notes below describe the earlier teaching prototype.

Stage 1 of the student marks system: React with JavaScript and Vite.

This is a learning build with fictional records. It is not ready for real student marks. Accounts in the profile selector are sample views, not authentication. Saving uses this browser's local storage; it does not share work between users or devices. Supabase authentication, PostgreSQL permissions and shared saving are the next stage.

## Run on your computer

Install a current supported Node.js LTS release, then open this folder in VS Code. In its terminal:

```sh
npm ci
npm run dev
```

Open the local URL printed in the terminal. To check the rules and build the deployment files:

```sh
npm test
npm run build
```

Vite writes the website into `dist/`. For eventual Cloudflare Pages hosting the build command is `npm run build` and output directory is `dist`. `.openai/hosting.json` identifies the private development preview; it is not a Supabase or Cloudflare account credential.

## Try this stage

1. Open Test workspace. Use the 2027 group and Phase 3 / Paper 6.
2. Search `006900`. It finds fictional student Amal Perera with official ID `SC/2027/6900`.
3. Change the score to `112.25`, wait for saving, and refresh. The score should remain.
4. Enter `151` for this test, which is out of 150. The draft survives but validation blocks saving/submission. Correct it or choose Discard draft.
5. Press Finish & Submit. Change one of your scores. Your batch changes to Needs resubmission.
6. Switch sample profile to Marker 3. Other people's scores are read-only. Switch back to Sasindu to try an admin correction.
7. Use Add student, leave the ID blank, and create a fictional student. A temporary ID is assigned. Find them by name or full temporary ID; number-only search does not select temporary IDs.
8. Switch between Individual and Table layouts. Both edit the same scores.
9. Open Rankings to see raw totals, competition ranks, and Maths/Bio separation. The sample ranking is a live teaching calculation, not an exported report snapshot.

Reset sample data removes this demo's records and drafts on this browser after confirmation. Clearing browser storage also removes them. Do not rely on browser storage as a production backup. The demo does not coordinate concurrent browser tabs; server revisions and conflict handling arrive with Supabase.

## Where the code lives

| File                   | Responsibility                                          |
| ---------------------- | ------------------------------------------------------- |
| `src/main.jsx`         | Mounts React into the HTML root                         |
| `src/App.jsx`          | Screens, components, events, draft state, and autosave  |
| `src/domain.js`        | Pure JavaScript business rules                          |
| `src/sampleData.js`    | Fictional sample records                                |
| `src/storage.js`       | Browser storage with explicit error handling            |
| `src/styles.css`       | Responsive interface and styling                        |
| `tests/domain.test.js` | Meaningful rule tests using Node's built-in test runner |

Start reading `LEARNING_NOTES.md`, then inspect the matching functions. Learning notes are also available from the sidebar in the app.

## Not included yet

Real email/password login, invitations, account disablement, database security policies, shared autosave, test administration, closing/archive workflows, repeater linking, bulk/online imports, conflict resolution, saved report snapshots, and PDF/Excel exports. The design document remains the specification for those stages. Prototype checks in browser JavaScript are useful for feedback but do not replace server-side permission enforcement.

