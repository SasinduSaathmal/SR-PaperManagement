# Online marks imports and saved reports

## Enable the update

Run `supabase/006_online_import_reports.sql` in Supabase SQL Editor after the previously applied 001–005 scripts. This adds import review tables and immutable report snapshots, allows the Online score source, and updates completion/removal checks. Existing students, test scores and previous history are preserved.

After the SQL succeeds, merge this pull request into main. Cloudflare's connected build deploys the website. Pull locally and run `npm ci` to install the added parser/PDF dependencies.

## Online marks import

In Test workspace, an admin selects an open test and uploads the original online export. The supplied .xls format is HTML, and is detected from its contents. The reader uses the original Student Mark text (for example `34 / 40`) and reads Student Code, Student Name and Student School. District, external rank, grade and percentage are not used to select or calculate results. Genuine binary .xls workbooks must be saved as .xlsx first. Single-sheet .xlsx and UTF-8 CSV are also accepted; converted date/formula cells require review rather than guessing a score.

The preview checks the available heading's year, phase and paper, and checks score denominators against the selected test. The admin confirms the target before saving. Import supports up to 1000 rows and 5 MB per file. Valid positive rows are saved immediately; unresolved rows remain in a persistent review queue. Zero-valued online rows are skipped, including when an earlier positive score exists. Paper zeroes are unaffected.

Existing students are matched by canonical official ID within the selected exam group and use their database name, school and stream. Unknown students remain pending until an admin supplies usable details and chooses Maths/Bio. Numeric schools, Other, School not updated and blank schools need correction. Existing scores, including paper scores, are never silently overwritten. Review offers an explicit replacement checkbox and requires a reason; a stale score version is rejected. Replacing another marker's score preserves attribution and their submission state. Changing the admin's own paper batch requires resubmission. Admins can dismiss a row with a recorded reason.

The same parsed file rows uploaded again return the existing batch instead of duplicating its scores or review queue. A changed export is a new batch: identical online scores are skipped, changed scores need review. Invalid/unknown/conflicting rows block Add zeroes and Close test until imported or dismissed. Cancelled/closed tests and archived groups cannot be imported into. Files with import history and tests referenced by reports cannot be permanently removed.

## Rankings and reports

Open Rankings & reports. Admins select 1–30 tests from one exam group in the desired column order. Choose Top N (default 10) or the full list, detailed/summary/both layouts, optional student IDs, and a report name for the saved list and filenames (default Physics - Samitha Rathnayake).

Generation stores a new immutable report version. If any selected test is open, the report is provisional and admin-only. All selected tests must be closed for a final report. Markers may view/download final reports, including after a source test reopens. A source revision change shows the notice Test reopened - results may have changed beside the saved version. New corrections require generating a new version; old names, schools, stream assignments, marks, ranks, report names, selected test order and creation details remain unchanged.

Raw marks are added without percentage normalisation. Tests out of 40 and 150 have a combined maximum of 190. Rank separately within Maths and Bio, using competition ranks (1, 2, 2, 4). Include every student with any recorded score in the selected tests, including recorded zeroes and inactive students with historical entries. Missing scores contribute zero and appear as a dash. Students with no recorded entry in any selected test are excluded. Cancelled tests are excluded and cannot be selected. Top N includes all tied students whose rank is N or better.

Excel downloads contain separate sheets for Maths/Bio and the chosen layout(s). Marks and totals are numeric; IDs remain text. Use the separate **Maths PDF** and **Bio PDF** buttons for one PDF per stream. Each includes the chosen layout(s) for only that stream, with its stream in the filename. PDF and Excel headings begin with **Physics - Samitha Rathnayaka**, followed by two lines: `<Exam year> Phase <phase number> Paper <paper number>` and `Top <N> <Stream>` (or `Full list <Stream>`). Combined-test headings list the selected papers in order and wrap as needed. The redundant metadata, generated/by/maximum-total line, separate test-summary line and dash explanation above the table are removed. Scores, rankings, table columns and PDF page footers are preserved. PDFs repeat table headings and page numbers; wide detailed tables continue horizontally with student identity columns repeated. Both formats use saved snapshot values, not fresh live calculations. Downloads fetch the snapshot through authenticated RPCs and follow the same final/provisional access rules as the report list. No public report URLs or browser-side privileged keys are introduced.

## Validation

`node --test tests/online-reports.test.js tests/import-export.test.js tests/database.test.js` exercises imports, duplicate/retry handling, unknown-student completion, conflict review, partial import closure blocking, raw totals, cutoff ties, stream separation, immutable snapshots, reopened report access, disabled accounts and read/write permissions through embedded PostgreSQL. XLSX round trips and PDF exports are also checked. The original 60-row HTML export was read locally and 35 positive score rows were identified. Real student exports are not included in this repository.

PDF pages are rendered and checked with separate Maths/Bio sample exports. Automated checks cover stream separation, exact headings, retained metadata, both layouts, numeric Excel values and the current marking/report/recovery workflow. The production Vite build also passes. No database migration is needed for the heading or separate PDF downloads.
