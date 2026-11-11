# Student import, test removal and marker downloads

## Enable this update

1. In Supabase SQL Editor, run `supabase/005_import_remove_export.sql` once. It requires the previously applied 001–004 scripts and adds three permission-checked functions. It does not reset existing records.
2. Merge this change into the production branch to trigger the connected Cloudflare build. Apply the SQL before merging so the new controls are ready when the site updates.
3. On your computer, pull the changes and run `npm ci` before continuing local development.

## Import students

As an admin, open Students, choose the exam year and select Import students. Download the template or use an existing .xlsx/UTF-8 CSV with headings in row 1. Choose the worksheet and map the columns. Name, school and stream are required. IDs accept a number or SC/year/number; blank IDs get temporary IDs. Stream accepts Maths/Bio and the aliases Mathematics/Biology.

The preview labels new, invalid, existing and duplicate rows. Only valid new rows are imported. Existing IDs and matching name/school/stream records are skipped; existing records are never overwritten. For two different students with identical details, use the individual form after reviewing the match. Correct excluded rows in the source and upload again. Limits: 1000 students, 100 columns and 5 MB per file. Excel formulas/dates must be replaced with plain text. Older .xls files must be saved as .xlsx first.

Imports are transactional. If a row fails server validation, none of that request's rows are added. Retrying the same request after a timeout returns its saved result. Re-uploading the same students also checks for existing records, including those created with temporary IDs. Archived groups are read-only.

## Remove an empty test

In Test workspace, admins have Remove empty test in Complete this test. Removal is blocked by scores (including deleted scores), submitted batches, any test history other than initial creation, and the current account's unsynced local drafts. Database checks and revision locks protect against concurrent saved changes. Drafts on other devices are local and cannot be inspected centrally: confirm that other markers have discarded drafts before removal. A stale draft for a removed test cannot save a score or recreate the test. Use Cancel test to preserve any test with recorded work.

## Download a marker's submitted students

After closing the test, Download submitted student data appears in the workspace and rankings screens. Each marker can download their own batch; admins can download each participant's batch. Files contain No., Student ID, Student name, School, Stream and numeric Marks. Manually entered zeroes and the final values after admin corrections are included. Deleted entries and automatic absent-student zero fills are excluded. Empty submitted batches produce a workbook with headings and no student rows.

Filename: `Phase <phase number> Paper <paper number> <marker's name>.xlsx` (for example, `Phase 1 Paper 5 Sasindu.xlsx`). Characters invalid in Windows filenames are replaced with underscores. Reopened/cancelled tests cannot be downloaded until closed again. Archived closed tests remain downloadable. Downloads use the current saved student details and final saved marks, rather than a permanent historical report snapshot.

## Validation

`node --test tests/import-export.test.js tests/database.test.js` tests CSV quoting, canonical IDs and duplicate detection, typed XLSX round trips, permissions, atomic rollback, idempotent retries, empty-test removal and closed-test exports against embedded PostgreSQL (PGlite). `npm run build` checks the production bundle. Neither command changes the live Supabase database.

The existing `number-only lookup never falls back to a temporary ID` test in `tests/domain.test.js` fails on the unchanged baseline: its fixture omits `school`, while the legacy search function accesses `student.school.toLowerCase()`. This update does not alter that legacy function or fixture.
