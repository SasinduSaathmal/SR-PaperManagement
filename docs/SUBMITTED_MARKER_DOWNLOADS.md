# Download marker entries immediately after submission

## Enable

1. Pull the updated `main` branch in the project folder.
2. After migrations 001–013, run all of [014_submitted_marker_downloads.sql](../supabase/014_submitted_marker_downloads.sql) in the production Supabase SQL Editor. `Success. No rows returned` is expected. The script only replaces the read-only download function and its grants; it creates no tables, files or report snapshots and changes no scores.
3. Refresh the website and open **Test workspace** (or **Rankings & reports** for its selected test).

If 013 from the previous update has not been installed, run it first. Do not rerun older migration 005 over the updated download function.

## Marker flow

- Enter and save the paper marks, then choose **Finish & Submit**.
- In **Download submitted entries**, choose **Download <marker name> .xlsx**. The test may remain **Open** and other markers need not have submitted yet.
- After editing, save and submit again. The next download contains the updated batch. Until resubmission, the download is disabled and the server also rejects it. Pending local drafts are not included.
- The same permission checks continue to apply: active markers download only their own batch; active admins can download each participant's latest submitted batch. Cancelled tests cannot be exported. Empty submitted batches produce a workbook with headings.

The existing filename remains `Phase <phase number> Paper <paper number> <marker's name>.xlsx`. The workbook includes the submission time in Sri Lanka time and batch revision, alongside the existing test details. Numeric marks, entered zeroes and saved admin corrections are included. Deleted entries, online-only marks and automatic absent-student zero fills are excluded from marker paper batches. Closed and archived tests remain downloadable if the batch is submitted.

## Storage and freshness

Every click reads the currently submitted saved entries and generates the XLSX in the browser. The download request performs no database writes. No XLSX, export history, new submission snapshot or stored file version is added to the database; the existing scores and submission status remain its source. Admin corrections keep the existing attribution/submission rules and appear in the next download.

A download is a copy at that moment. A previously downloaded file on a marker's device cannot be changed remotely. After resubmitting, download again to get the updated contents; the browser handles any local filename collision. No automatic download is triggered by submission.

## Validation

The disposable-database tests exercise submission/download/resubmission while another marker has not submitted, exact updated XLSX values and the unchanged filename, a read-only export transaction with no receipt/report/history writes, admin corrections, manual zeroes, removed/online/zero-fill exclusion, closed/reopened/archived behavior, empty batches, role/disabled/anonymous/nonparticipant restrictions and cancelled tests. The full marking-to-report recovery rehearsal also runs the current download function. Production data is not accessed by the tests.
