# Physics - Samitha Rathnayake

A shared React website for student records, paper marking, online marks imports and ranked PDF/Excel reports. Supabase handles email/password accounts and PostgreSQL permissions. Cloudflare Workers serves the website and the private account-invitation endpoint.

## Current features

- Exam-year groups, archive/restore, shared schools, student entry/editing, deactivation and bulk Excel/CSV import.
- Official/temporary ID correction with searchable aliases, reviewed permanent student-and-marks removal, and admin-confirmed repeater links across years.
- Reviewed school-name merges and renaming, with aliases recognized by future entries and imports.
- Shared marks entry, account-specific local drafts, submissions/resubmissions, test closure/reopening/cancellation, participant changes and batch reassignment with original attribution.
- Online HTML-table .xls, XLSX and CSV imports, confirmed Excel date recovery, pending-row review and conflict protection.
- Raw-total rankings separated into Maths/Bio, Top N with ties, immutable provisional/final report versions, PDF/Excel export and closed-test marker downloads.
- Admin account invitation, display names, roles, disable/reactivate controls and reviewed trial-data cleanup by exam year.

All permissions are checked in the database/server. Passwords stay with Supabase Auth, and privileged API keys stay in the Worker. Public sign-up is not offered.

## Update the existing installation

The latest update requires migration 013 after the previously installed 001–012. Follow [student removal, ID correction and school names](docs/STUDENT_RECORDS_SCHOOLS.md). Installing it does not delete students, edit IDs or merge schools. Earlier identity/account/participant setup is described [here](docs/IDENTITY_ACCOUNTS_PARTICIPANTS.md).
For a new project, configure Supabase email/password authentication, create the owner account, edit the owner email in 001, then apply migrations 001–013 in order. Keep public sign-up disabled. Do not rerun the old 001 template over a current deployment: later migrations harden its profile trigger.

## Development and deployment

```sh
npm ci
npm run dev
npm test
npm run build
```

Configure the browser build with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The server invitation endpoint separately requires runtime `SUPABASE_URL` and a secret `SUPABASE_SECRET_KEY` in Cloudflare. Never prefix a secret key with `VITE_`.

The connected Cloudflare build runs `npm run build` and Wrangler deploy/preview commands. The Vite plugin generates the Worker configuration and binds the client asset directory automatically. Runtime dashboard variables are preserved on deployment. No server secret belongs in this repository.

## Feature guides

- [Student import, empty-test removal and marker Excel downloads](docs/IMPORT_REMOVE_EXPORT.md)
- [Online imports, rankings and saved report versions](docs/ONLINE_IMPORT_REPORTS.md)
- [Zero-fill attribution and empty marker batches](docs/MARKING_BUG_FIXES.md)
- [Excel date recovery and deployment loading](docs/ONLINE_DATE_RECOVERY.md)
- [Admin cleanup of trial data](docs/TRIAL_DATA_CLEANUP.md)
- [Student removal, ID correction and school names](docs/STUDENT_RECORDS_SCHOOLS.md)
- [Identity, accounts and participant administration](docs/IDENTITY_ACCOUNTS_PARTICIPANTS.md)
- [Database backup, restore checks and final release review](docs/BACKUP_AND_RECOVERY.md)
- [Windows native backup and restore without Docker/WSL](docs/WINDOWS_NATIVE_BACKUP.md)

Some older guides describe the test status at the time of their individual updates. Run `npm test` for the current complete suite (44 tests passed with the student records update). The owner has verified invitation delivery and marker-side workflows on the configured deployment. On 11 November 2026, the owner also completed a native PostgreSQL 17.11 backup/restore into an isolated Supabase 17.11 project: archive readability, required tables, restored row counts, permissions/triggers, Table Editor review, restored admin sign-in and the test-workspace API all passed. See the [verified recovery run](docs/WINDOWS_NATIVE_BACKUP.md#verified-run-11-november-2026).

The isolated restored website's full browser marking/report-download workflow has not been repeated; the production marker checks and automated two-marker workflow are separate evidence. No production cleanup or restore is run by the automated tests.

The earlier local-only teaching prototype remains in source history and sample-data helpers; the signed-in website uses the shared database.
