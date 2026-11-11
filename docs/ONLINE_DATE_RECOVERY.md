# Online import: Excel dates and deployment loading

Apply `supabase/008_online_date_recovery.sql` in Supabase SQL Editor after migration 007, before deploying this update. The migration adds an admin import function and private file receipts; running it alone does not change student marks.

## Importing converted marks

Excel can store a score such as `12/40` as a date displayed as `Dec-40`. The online workbook reader now preserves the stored date and number format instead of replacing it with an unsupported-cell placeholder.

1. Open the relevant test and choose the source file again.
2. Check the original and interpreted score columns. For an out-of-40 test, the supported month/year interpretation is `Dec-40 → 12 / 40`, `Nov-40 → 11 / 40`, and `Oct-40 → 10 / 40`.
3. Select the recovery checkbox only after checking that interpretation against the original results. Then confirm the target test and import.
4. Review any remaining issues. Existing database students keep their details and stream. New students still need a stream selected manually because online exports do not provide one.

Recovery is deliberately limited to month/year formats, the first day of the month at midnight, and a matching whole-number test maximum from 32 to 99. Plain English month/year text from HTML or CSV exports is also supported. Other dates, formulas, mismatched denominators, and ambiguous formats remain for review. Ordinary score text continues through the existing validation rules.

Re-uploading the source file repairs matching earlier pending rows whose original scores were unsupported or date-converted. A valid unconverted source export can repair these rows too. Original/recovered values and the source filename are retained for audit. Saved conflicting scores require the existing explicit replacement review. Re-uploading the same parsed file does not create duplicate pending students or batches.

The old placeholder contains no date information. Recovery therefore requires the source file again; the app cannot reconstruct a score from that placeholder alone.

## Loading older .xls exports

HTML-table `.xls` exports use the browser's built-in HTML parser. There is no separate `onlineHTML-*.js` download. Genuine binary `.xls` workbooks still need to be saved as `.xlsx`; Excel HTML index files need their companion sheet or the complete workbook, as explained in the import message.

An already-open tab can still refer to assets from an older deployment. Refresh once after deployment and select the import file again. New builds revalidate cached assets and show a manual reload notice when a module cannot load. The app does not reload automatically while someone is entering marks.

## Validation

Fourteen feature tests pass, covering generated XLSX files in both Excel date systems, 1940/2040 month/year values, explicit confirmation, HTML tables, admin permissions, old pending-row repair, duplicate file submissions, missing-student review, and protection of existing marks. Production build succeeds and includes `_headers`; it produces no separate `onlineHTML` chunk. The current screenshots were used to identify the pattern; the user's actual `online.xlsx` file was not available for this change.

The legacy search fixture now includes a school, and search tolerates missing school fields without changing stored records. The full suite passes, including a regression covering missing schools and temporary-ID lookup. Browser interaction was not exercised in this environment.
