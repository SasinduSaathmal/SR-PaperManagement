# Saved-report deletion and student marks history

## Install on the existing deployment

1. After migrations 001–014, open `supabase/015_report_delete_student_history.sql` and copy the complete file into the Supabase SQL Editor.
2. Run it once. `Success. No rows returned` is the expected SQL Editor result.
3. Deploy the updated website and refresh it. Existing features remain available before this migration; the new actions show a setup message until it is installed.

Installation deletes no reports and changes no marks. It adds three permission-checked functions, a student-history index and a report-version counter. Existing report generation retains its ranking and snapshot behavior. Reapplying 015 preserves records and the highest version counter.

## Delete one saved report

In **Rankings & reports → Saved report versions**, an active admin can choose **Delete report** beside a specific version. Review its name, version, date, final/provisional status, test count and student row count. Tick the acknowledgement and choose **Permanently delete report**.

This removes that report's database snapshot and its report-to-test links. It keeps original tests, student marks and other saved versions. Downloaded PDF/Excel copies remain on the devices that downloaded them. Deleted snapshots disappear from the list and any selected preview; later reports continue with a higher version number, even after every saved version is removed. Deletion is also available for archived exam years.

The server requires an active admin, confirmation and the reviewed version/date. A repeated request safely returns its existing result; an old generation retry cannot recreate a deleted snapshot. A database failure rolls back the whole deletion. Markers have no delete control or permission.

## See a student's marks

In **Students**, select the exam year, find the student and choose **Marks history** in their Actions column. All active accounts can read the same saved score summary they can already access in test workspaces.

The view starts with the selected enrolment's exam year. **Include linked exam years for this same student** includes only enrolments explicitly linked to that student; matching names are never enough. Inactive students and archived years remain readable. Refresh history to reload saved results.

Each test shows its date, phase/paper, maximum, saved mark, source/marker and status. Recorded zeroes appear as `0 / maximum`; **No entry** means no score has been saved, while **Removed** means the entry was removed. Cancelled tests are identified as excluded from rankings. Local unsynced drafts are excluded. Pages contain up to 25 tests.

Active admins also see **View changes** for each test with saved changes. Its separate paginated view shows who changed the score, the time in Sri Lanka, the action and before/after marks. A dash means no score, distinct from zero. This detailed audit is unavailable to markers.

## Checks and backups

`npm test` covers real PostgreSQL function permissions, confirmation/stale-review failures, retry safety, deletion rollback, report versions, history scope, linked identities, missing/zero/removed marks, pagination, admin-only audit and read-only access. `npm run build` checks the production bundle.

No additional application table is created: backup inventory remains 22 application tables plus two Auth tables. Recovery readiness checks validate the new functions when the report-version column is present and still support older archives. Backups should continue on the established schedule; this feature does not create backup copies of deleted snapshots.
