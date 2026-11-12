# Student removal, ID correction and standard school names

## Install the update

1. Take a fresh database backup using your existing native Windows procedure. Have markers finish and close their editing workspaces.
2. Pull the updated `main` branch in the project folder (`git pull`).
3. In the **production** Supabase project, open SQL Editor, paste all of [013_student_records_schools.sql](../supabase/013_student_records_schools.sql), and Run. This requires the previously installed migrations 001–012. `Success. No rows returned` is expected.
4. Refresh the deployed website. Sign in as an active administrator and open **Students**.

Installing 013 adds controls and guards. It does not delete student data, change existing IDs, rename schools or send emails. The existing directory remains available before 013; the new actions show a setup message until it is installed.

## Correct an ID

In the student row choose **Edit ID**. Enter the corrected official number or full `SC/year/number`, give a reason, verify it is the same student, and save. Works for both temporary and official IDs. The ID must match the selected exam year.

The enrolment UUID and marks remain unchanged. The previous ID becomes a searchable alias and cannot be assigned to a different student in that year. Full-ID searches and student/online imports recognize the earlier ID. A number-only search uses the current official ID in the selected year. An ID correction cannot combine two students or combine their marks; resolve a collision by reviewing the two records.

Saved report snapshots retain their original values. Reports using affected tests show a source-change notice; generate a new version when updated IDs are needed.

## Standardize schools

Choose **Manage schools** above the student directory.

1. Choose the school record to keep.
2. Set its standard display name.
3. Select other existing school spellings that describe **that same school**. Search the list or review possible variants. No fuzzy match merges automatically.
4. Choose **Review school change**. Check the selected names, student counts and sample students.
5. Give a reason, type `MERGE SCHOOLS`, confirm the records represent the same school and save.

A single selected record can also be renamed. The change applies to all enrolments using those schools, including inactive students and other exam years. Restore any archived year using a selected school before making the change. Names belonging to an unselected school must be included explicitly before they can be used.

Marks, IDs and person links stay attached to the same students. Earlier spellings become aliases: future manual entries, edits, returning-student entries and imports resolve the reviewed variants to the standard school. Capitalization and repeated spaces are ignored when matching; words omitted or punctuation changed require a reviewed alias. Choose a school from the existing options when entering new students. Old saved/downloaded reports keep their original labels; generate a new report version for standardized names.

## Permanently remove a student and marks

Choose **Remove permanently** in the student row, then **Review student removal**.

- Default scope: that student's enrolment in the selected exam year and all its score records, including soft-deleted scores, plus associated student and mark history.
- Optional scope: every exam year explicitly linked to that same person. A matching name does not select other students automatically. Archived years must be restored first.
- The review lists enrolments, score/history counts, online rows to anonymize and affected saved report versions.
- Saved reports containing the student are immutable and are removed **in full**, including their other rows. Generate replacement reports afterward. Reports that do not contain the student remain stored; affected sources show a change notice.
- Matching online import rows become anonymous dismissed records. File hashes remain deduplicated so retrying a previous file cannot silently restore deleted marks. Shared import batches and other students' rows/marks remain.
- Relevant write receipts are replaced by minimal retry tombstones; stale saves cannot replay the removed data. Shared receipts may be invalidated as a whole; their other saved data is preserved.
- Markers whose **open** paper batches lose scores must resubmit. Closed tests keep their status and remaining submitted batches/downloads.

Stop all editing for the student and discard unsynced drafts on **every device** first. The website checks the current browser's drafts; it cannot remotely erase another browser's storage. Give a reason, type the displayed `DELETE <student ID>` exactly, confirm the review, and choose **Permanently remove student and marks**. A changed record invalidates the review and requires a fresh preview.

This action is permanent. Use **Deactivate** to retain a student's marks and history instead. Existing private backups and downloaded files are separate copies; website removal does not erase them. A fresh deliberate new import can create the official ID again; earlier individual creation retries are blocked.

## Verification and backup compatibility

Automated disposable-database tests cover role/disabled/anonymous restrictions, ID collisions and aliases, imports, immutable reports, school merge scope and reviewed alias reuse, stale previews, archive guards, removal scope, receipt/draft retry protection, other-student preservation and transactional rollback. UI review uses mock data, with no production deletion or merge.

The inventory now tracks 22 application tables plus `auth.users` and `auth.identities` (24 total), including `school_name_aliases`. The native restore preparer still accepts older archives without 013, selecting the legacy inventory for them. Use the inventory generated inside the prepared restore folder for that archive. The earlier verified PostgreSQL 17.11 backup remains valid; take a new backup after installing this update and after any real school cleanup.
