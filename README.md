# Physics - Samitha Rathnayake

A shared React website for student records, paper marking, online marks imports and ranked PDF/Excel reports. Supabase handles email/password accounts and PostgreSQL permissions. Cloudflare Workers serves the website and the private account-invitation endpoint.

## Current features

- Exam-year groups, archive/restore, shared schools, student entry/editing, deactivation and bulk Excel/CSV import.
- Temporary-ID replacement with searchable aliases and admin-confirmed repeater links across years.
- Shared marks entry, account-specific local drafts, submissions/resubmissions, test closure/reopening/cancellation, participant changes and batch reassignment with original attribution.
- Online HTML-table .xls, XLSX and CSV imports, confirmed Excel date recovery, pending-row review and conflict protection.
- Raw-total rankings separated into Maths/Bio, Top N with ties, immutable provisional/final report versions, PDF/Excel export and closed-test marker downloads.
- Admin account invitation, display names, roles, disable/reactivate controls and reviewed trial-data cleanup by exam year.

All permissions are checked in the database/server. Passwords stay with Supabase Auth, and privileged API keys stay in the Worker. Public sign-up is not offered.

## Update the existing installation

The latest update requires migrations 010–012 after the previously installed 001–009. Follow [identity, accounts and participant setup](docs/IDENTITY_ACCOUNTS_PARTICIPANTS.md) for the scripts, invitation runtime settings, email callback configuration and website controls. Installing these scripts does not clear data or send invitations.

For a new project, configure Supabase email/password authentication, create the owner account, edit the owner email in 001, then apply migrations 001–012 in order. Keep public sign-up disabled. Do not rerun the old 001 template over a current deployment: later migrations harden its profile trigger.

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
- [Identity, accounts and participant administration](docs/IDENTITY_ACCOUNTS_PARTICIPANTS.md)

Some older guides describe the test status at the time of their individual updates. The current full suite has 33 passing tests. Production client and Worker builds pass. Actual invitation-email delivery and the complete multi-account browser workflow require final checks on the configured deployment.

The earlier local-only teaching prototype remains in source history and sample-data helpers; the signed-in website uses the shared database.
