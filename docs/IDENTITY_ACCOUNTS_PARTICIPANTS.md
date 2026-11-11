# Identity, accounts and participant administration

## Update the existing deployment

Run these scripts in Supabase SQL Editor, in order, after the previously installed 001–009:

1. `supabase/010_student_identity.sql`
2. `supabase/011_account_administration.sql`
3. `supabase/012_test_participants.sql`

Existing students, marks, accounts and report snapshots are retained. These scripts do not send invitations or clear trial data. Do not rerun 001 on an existing project: its original profile trigger has been hardened by 011. The original 001 template is included for complete setup of a new project.

Before merging, add the invitation service's runtime settings in Cloudflare: **Workers & Pages → sr-papermanagement → Settings → Variables and Secrets → Add**. These belong to the Worker's runtime settings, separate from build variables.

| Name | Type | Value |
| --- | --- | --- |
| `SUPABASE_URL` | Plaintext variable | The same Supabase project URL used by the website's `VITE_SUPABASE_URL` |
| `SUPABASE_SECRET_KEY` | Secret | A Supabase secret API key beginning `sb_secret_`, from Supabase Project Settings → API Keys |

Never put the secret in GitHub, chat, a screenshot, or a `VITE_` variable. It is used only in the Worker. The existing browser URL and publishable-key build settings stay as they are. `keep_vars: true` preserves runtime dashboard variables on later Wrangler deployments. Secret keys are sent on the `apikey` header; a signed-in user's JWT is verified separately before any administrative action. Legacy service-role JWT keys are also supported for an existing installation.

In Supabase Authentication settings, keep public sign-up disabled. Confirm that URL Configuration uses the current production website as Site URL and allows `https://sr-papermanagement.sasindusathmal.workers.dev/?auth=setup` and the existing password-recovery URL. Add the equivalent exact preview URL only if testing invitation delivery on a preview. An invitation always returns to the origin of the website that sent it; request-body redirect URLs are ignored.

Supabase's email provider must be configured to deliver invitations to the intended marker addresses. If the built-in sender rejects external recipients, configure your SMTP provider in Supabase; this update does not provision email delivery. The exact recipient delivery and callback must be tested with an actual invitation after deployment. No real invitation has been sent during automated validation.

Merge after SQL and runtime configuration are ready. The Vite plugin builds the API Worker into `dist/sr_papermanagement` and browser assets into `dist/client`; Wrangler's generated deployment configuration selects both. Continue using `npm run build` and `npx wrangler deploy` / `npx wrangler preview` through the existing integration. There is no need to configure a separate Pages output directory.

If runtime invitation settings are absent, existing marking/student/report features still work; the invitation endpoint explains that account invitations need hosting setup.

## Students

Admins can choose **Replace temporary ID** on a temporary student. Enter the official ID or number and a reason. The old temporary ID remains a searchable alias. The enrolment's internal ID and its score links stay unchanged. A used official ID is rejected with instructions to review the existing record; marks are never merged automatically.

Use **Add returning student** to create a new-year enrolment linked to an earlier person. Search by a name or full earlier ID, select the actual person, confirm the identity, and enter this year's school, stream and ID (or leave the ID blank for a new temporary ID). Earlier archived enrolments can be selected without modifying their archived records.

If a marker has already added this year's student as a separate record, an admin can use **Link earlier enrolment** on that row. Linking keeps this year's ID, school, stream and all scores, and uses the earlier person's canonical name. Confirm the identity explicitly and provide a reason. This is not an automatic name match. A source person already enrolled in the target year is blocked for manual duplicate review. A target already linked to additional years is also blocked rather than silently merging two established identities.

The source's name and identity and the target's version are checked again when saving. Existing saved report contents remain unchanged; reports generated later use the corrected records. Editing a linked person's name follows the existing archive rules: restore any archived enrolments first.

Both Students and marks-entry search accept earlier linked full IDs and replaced temporary IDs. Number-only lookup still matches an official ID in the selected year, never a temporary ID or an earlier year's number. The directory shows linked IDs so the match can be checked.

## Accounts

The admin-only **Accounts** screen lists account names, emails, roles and active status. Edit a display name, change marker/admin capability, disable an account, or reactivate it. Account changes are version checked and audited. Another admin must change your own admin role or disable your account, and the server protects the last active admin.

**Invite a marker** calls the same-origin Worker endpoint. It verifies the user's current Supabase identity and active admin profile, then reserves an idempotent database invitation before using Supabase Auth's trusted invitation endpoint. New invitees start as markers; changing a role requires a separate admin action. User-editable authentication metadata cannot grant admin or active status. Unapproved new auth users receive disabled profiles. Existing accounts retain their access.

The new marker opens the invitation email and uses the existing password setup screen. Retry an unfinished invitation from **Recent invitations**, including after a page refresh. Duplicate submissions reuse the reservation. Supabase dispatch success does not prove inbox delivery; the marker can request a fresh password link if an earlier invitation is no longer usable. An old invitation retry cannot reactivate an account subsequently disabled by an admin.

Disabling an account preserves all scores, submissions and history. An admin can reassign an unfinished batch using the controls below.

## Test participants

An admin opens **Test workspace → Manage test participants**. Add active accounts to an open test; each added marker must submit their batch, even if empty. Closed/cancelled tests must be reopened, and archived groups restored, before changes.

To remove a marker who has paper records, choose another active participant to receive the entire batch. Counts include deleted entries so their attribution cannot be lost. Current ownership moves to the receiver, original marker identity remains visible in Entries at a glance, and the old submission and ownership changes are stored in test history. No scores are added together or deleted. The receiver's batch needs review and resubmission before closing. Remove an empty participant directly, while retaining at least one participant.

Score versions change during reassignment, so old drafts cannot overwrite the reassigned batch. Ask affected markers to stop editing; this device's pending drafts must be saved/discarded before changing participants. Drafts on other devices remain local and must be discarded there.

## Validation and remaining checks

All 33 automated tests pass, including the original marking/import/report suite. New disposable PostgreSQL tests use the real 001 profile policies and 010–012 migrations, and cover ID conflicts, old-ID lookup, explicit linking, archived sources, unchanged marks/reports, cleanup compatibility, profile roles, disabled accounts, invitation reservations, forged metadata, delayed Auth invitation fields and batch resubmission. Worker tests mock Supabase responses and verify request authorization, key handling, fixed redirects, API errors and retry behavior. Production client and Worker builds pass.

Actual email delivery and a full admin/marker browser trial remain to be verified after runtime configuration. Browser interaction was unavailable in this environment. Run through a dummy student, ID replacement, next-year link, batch transfer, final report and invitation/password setup before clearing trial data and importing approved records.

Official setup references: [Cloudflare runtime secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [Wrangler dashboard-variable preservation](https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth), [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys), [Supabase invitations](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail).
