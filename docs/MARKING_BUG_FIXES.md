# Zero-fill attribution and empty marker batches

Run `supabase/007_zero_fill_empty_batches.sql` in Supabase SQL Editor after scripts 001–006, then merge the corresponding change to deploy the UI. Existing numeric scores, report snapshots, test status and submission revisions are retained by the repair.

## Edited zero fills

Entering a manual score over a zero-fill placeholder now changes its source to Paper and credits the editing admin. If that admin participates in the test, their batch revision advances and they must submit again. A non-participating admin may still correct a placeholder without creating a new participant. Corrections to another marker's existing paper score continue to preserve its ownership and submission state. Normal markers cannot claim a zero-fill or change another marker's score.

An online import replacing a zero-fill placeholder becomes Online, with its admin/import provenance in history, instead of retaining the Zero fill label. Online zero rows are still skipped and cannot clear a positive saved mark.

The migration also repairs existing non-deleted positive scores incorrectly labelled Zero fill. Manual corrections are credited to the last editor; rows whose latest score event was an online import become Online. Scores and existing saved report contents do not change. Score/test revisions advance to prevent stale writes, and history records that attribution was repaired by migration. Existing marker submissions are preserved. The repair is safe to rerun.

## Markers with no papers

A selected marker can already submit an empty batch without editing anyone else's marks. The submission button now explicitly reads Submit empty batch (no papers), and the batch list shows entry counts.

Admins can use Confirm no papers for an unused participant. The server permits this only in an open, non-archived test, with the expected batch revision, zero paper revisions and no saved or deleted entries credited to that marker. Confirmation records the admin and target marker in history and is retry-safe. A marker who has entered or removed work must review and submit their own batch instead. No paper ownership or scores change.

Before confirming, check that the marker has no unsynced drafts on another device. Local drafts for that marker on the current device block confirmation; other devices' drafts cannot be inspected centrally. A later attempted edit still follows the normal test status, ownership and resubmission checks.

## Excel HTML index files

The supplied failing .xls is an Excel Workbook Frameset that references a sibling `..._files/sheet001.htm` file. The index contains no student marks. The importer now identifies this case and explains the available options: upload the original download, upload the companion sheet001.htm directly, or open the complete file and companion folder in Excel and save as .xlsx. Renaming the index to .xlsx does not restore missing rows. Actual student tables in either HTML export or companion sheet form remain supported.

## Validation

`node --test tests/marking-bugs.test.js` reproduces the prior zero-fill issue before applying the migration, checks the repair and unchanged report snapshots, verifies manual/online attribution after reopening, and checks empty self-submission, admin confirmation, idempotent retries, stale revisions and rejection of real/deleted paper work. It also tests frameset detection and reading a companion table. The exact attached file was checked locally; no student data or source export is included in the repository.
