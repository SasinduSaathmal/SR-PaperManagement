# Clear trial data before real marking

Run `supabase/009_trial_data_cleanup.sql` in Supabase SQL Editor after 008, before deploying this update. Installing the migration does not delete any records. Cleanup happens only when an active admin uses the website's confirmed cleanup action.

## Website controls

1. Sign in as an admin and open **Overview**.
2. Select the exam-year group containing the trial records.
3. Expand **Clear trial data**. This feature clears **all tests in the selected group**, including open, closed and cancelled tests, saved and removed score entries, marker submissions, online import queues, report versions and related history. The app has no automatic way to identify which records were only for practice.
4. Leave the student checkbox unchecked to keep the student database. Select it only if all student enrolments in this exam-year group should also be removed.
5. Choose **Review records to remove** and inspect the counts and complete test list. Download reports or exports you need before cleanup.
6. Ask all markers to stop editing and close their test workspaces. Save or discard drafts on this device; discarded trial drafts on other devices must also be removed there. Confirm that editing has stopped.
7. Type the exact displayed phrase, such as `CLEAR TRIAL 2027`, then choose **Permanently clear trial data**.

There is no undo. The existing Cancel test and Deactivate student controls remain the appropriate options for preserving real records. Restore an archived group before using cleanup. Repeat the reviewed cleanup separately for each exam year that contains trial data.

Accounts, schools, exam-year groups and the temporary-ID counter are retained. Other exam years are retained. If student removal is selected, shared person records are removed only when they have no enrolments in another year. Trial student-change history is removed with its enrolments.

## Server checks and retry handling

Both preview and execution require an active admin; browser visibility alone does not grant permission. The server locks the group and its tests in the same order as marking writes. A fingerprint of the reviewed records must still match at execution; changed scores, imports, reports or students require a fresh preview. The typed phrase and student-removal option are checked again on the server.

Cleanup is one transaction. A failed dependency check rolls back deletions and the cleanup receipt together. Retrying the same successful request returns the same result instead of touching newly created records. A minimal cleanup receipt records actor, group, counts, confirmation fingerprint and time. Prior write receipts referencing cleared work are reduced to retry tombstones; removed student request IDs are also retained as tombstones so delayed browser retries cannot recreate those students. Fresh entries and imports with new request IDs remain possible.

Unsynced drafts on other devices cannot be inspected or erased remotely. Their old test IDs cannot save marks or recreate deleted tests. Clear those drafts before entering real data. Browser practice data from the earlier local-only prototype is separate from the shared database and is not changed by this feature.

## Verification

Database regression coverage includes admin/marker/disabled/anonymous permissions, archived groups, changed previews, mismatched student scope and confirmation, rollback after a foreign-key failure, repeated cleanup requests, removal of imports and saved reports, retained students by default, optional student removal, linked students in other years, receipt scrubbing and delayed student-save retries. These tests use a disposable embedded PostgreSQL database; they do not clear the live Supabase database.
