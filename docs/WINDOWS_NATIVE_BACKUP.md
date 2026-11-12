# Windows backup and restore without Docker

Use PostgreSQL 17 Windows **Command Line Tools** (`pg_dump`, `pg_restore`, `psql`) and the project's existing Node.js installation. No Docker, WSL or local database server is needed. These steps target the current PostgreSQL 17 installation and manually applied app migrations 001–012.

## Source backup

In Supabase's **Connect → Direct → PSQL → Session pooler** panel, copy the host and username. Use port 5432 and the database password. Run in PowerShell:

```powershell
$paperPgBin = 'C:\Program Files\PostgreSQL\17\bin'
$paperConnection = 'host=YOUR_SOURCE_HOST port=5432 dbname=postgres user=YOUR_SOURCE_USER sslmode=require connect_timeout=15'
$paperBackupDir = Join-Path ([Environment]::GetFolderPath('MyDocuments')) ('Physics Backups\' + (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'))
New-Item -ItemType Directory -Path $paperBackupDir -ErrorAction Stop | Out-Null
& "$paperPgBin\pg_dump.exe" --dbname="$paperConnection" --password --format=custom --strict-names --schema=public --schema=app_private --schema=auth --file="$paperBackupDir\physics-marks.dump"
if ($LASTEXITCODE -ne 0) { throw 'Backup failed; do not use this incomplete file.' }
Get-Item "$paperBackupDir\physics-marks.dump" | Select-Object FullName,Length
```

The password is entered at the utility's hidden prompt, rather than put in the command or repository. `pg_dump` reads these three schemas in one consistent snapshot. It includes app data, permissions, functions and all Auth data. Supabase's managed roles are provided by a new Supabase destination; custom database roles, other schemas, platform settings, Storage file bytes and browser-only drafts are outside this archive. Extend this procedure if the installation starts using those features.

Check that the archive can be decoded without executing anything against a database:

```powershell
& "$paperPgBin\pg_restore.exe" --file=NUL "$paperBackupDir\physics-marks.dump"
if ($LASTEXITCODE -ne 0) { throw 'Archive readability check failed.' }
Get-FileHash "$paperBackupDir\physics-marks.dump" -Algorithm SHA256
```

Keep the archive privately, with a second encrypted copy and its application Git revision. It contains student records and Auth credential hashes. The prepared restore folder described below also contains private SQL exports. Neither belongs in GitHub or a public website.

## Prepare a restore from the archive

Create a **new, empty Supabase project** named, for example, `physics-restore-check`, and confirm PostgreSQL 17 with `SHOW server_version;`. Leave it empty: the original profiles, student records and saved reports will come from the archive. Keep Cloudflare connected to the original project.

Open PowerShell in the up-to-date project checkout (the folder containing `package.json`). Set the archive path to the file already created; do not make another backup just to prepare a restore.

```powershell
$paperPgBin = 'C:\Program Files\PostgreSQL\17\bin'
$paperDump = 'C:\path\to\your\physics-marks.dump'
$paperPreparedJson = node scripts/prepare-native-restore.mjs "$paperDump" "$paperPgBin" --json
if ($LASTEXITCODE -ne 0) { throw 'Preparation failed. Stop and review the error.' }
$paperPrepared = $paperPreparedJson | ConvertFrom-Json
Write-Host "Prepared: $($paperPrepared.directory)"
```

Preparation only reads the local archive. It creates a new `restore-prepared-*` folder beside it and makes **no database connection**. The output contains:

- Archive selection lists: app schema/data/permissions, and Auth data with its sequence values. Supabase's managed Auth definitions and `auth.schema_migrations` rows are excluded from execution; the new project keeps its own platform schema and migration history.
- App pre-data, Auth data, app data and app post-data SQL files. Source object grants, policies and RLS remain included. Public-schema creation/comments/grants and role-specific default ACL entries are omitted because that schema already exists on Supabase.
- A destination guard, an atomic custom Auth profile trigger step, exact row-count checks extracted from every selected COPY section, and the application's permission/trigger readiness checks.
- `archive-manifest.json` with the archive SHA-256 and expected table counts. It contains no row contents, password or database connection URI.

The guard refuses a non-17 destination, any existing app schema or public tables, any missing required Auth tables, and any pre-existing data in the Auth tables to be loaded. It runs before permission changes or data loads. It deliberately stops rather than clearing an existing installation.

Global and public-schema defaults for browser access to new tables/functions are cleared in the destination; explicit grants from the archive are then restored. This prevents the destination's defaults from granting access absent from the source, including access to server-only invitation RPCs. Future migrations must continue to declare their own permissions explicitly.

## Execute against the NEW test project

In **the new project's Connect panel**, select Session pooler and use its host and username below. A shared pooler host may be identical between projects; the username's project-ref suffix must belong to the new project. Enter the **new project's database password** when prompted.

```powershell
$paperTestConnection = 'host=NEW_TEST_HOST port=5432 dbname=postgres user=NEW_TEST_USER sslmode=require connect_timeout=15'
& "$paperPgBin\psql.exe" --dbname="$paperTestConnection" --password -X --single-transaction --set ON_ERROR_STOP=1 --file="$($paperPrepared.restoreSQL)"
if ($LASTEXITCODE -ne 0) { throw 'Restore failed and was rolled back. Keep the test project isolated and review the error.' }
```

The generated driver loads the app's table/function definitions, disables row triggers for the Auth/app data copies, restores normal trigger operation, then loads app constraints/indexes/RLS/grants and the hardened Auth profile trigger. Finally it compares every selected table's row count with the archive and runs readiness checks, all inside the same error-stopping transaction. No application migrations are rerun. The native procedure uses this custom-format archive, not the separate `roles.sql/schema.sql/data.sql` files in the optional CLI guide.

Success ends with:

```text
PASS: restored archive row counts and application readiness checks
```

If preparation or execution fails, stop at the first error. Keep the original archive unchanged. Do not ignore errors, remove the empty-project guard, or retry a partial selection of the restore statements. The live installation stays on its original database throughout the rehearsal.

## Finish verification

The preparer's selection, COPY counting, permission normalization, destination refusal, row-count mismatch and rollback behavior are covered by automated tests using disposable PostgreSQL. The actual native archive extraction and hosted restore are operator steps using the Windows tools; automated tests do not access the real backup or production database.

After a successful restore, inspect the restored accounts, students, paper scores and saved reports in the test project's Table Editor. For a complete rehearsal, use an isolated review website with this test project's build/runtime variables and perform the browser checks in [the recovery review](BACKUP_AND_RECOVERY.md#final-review-before-production-use). Auth Site URL, redirects and email configuration must be set separately for that review environment. Keep production variables pointing to the original project.

The preparer supports both pre-013 and current archives, choosing the matching inventory automatically. Current archives include `school_name_aliases`; pre-013 backups remain restorable. Use the inventory in the prepared folder for that archive.

The optional `backup_inventory.sql` in the prepared folder produces a read-only inventory of application data/schema and users/identities. Compare it with a matching source checkpoint only if the source has not changed since the archive was created; later source edits or logins are not evidence of an archive failure.

Record the archive hash, code revision, restore result and browser review result. Take a fresh archive before any real cleanup or database migration. Trial cleanup remains a separate, owner-directed operation after recovery verification.

## Verified run: 11 November 2026

The owner performed the native procedure on Windows using PostgreSQL client tools 17.11 and an isolated Supabase destination running PostgreSQL 17.11 (`physics-restore-check`). Reported results:

- The custom archive was created successfully (397,862 bytes), decoded successfully, and contained all 21 application tables plus `auth.users` and `auth.identities`.
- The hosted restore passed exact row-count checks for every selected data table, plus the application account-link, RLS, RPC-permission and required-trigger assertions.
- The owner inspected familiar restored records in the test project's Table Editor.
- Password sign-in against the restored project's Auth API succeeded with the existing admin account, and `app_get_test_workspace` loaded successfully using that signed-in account's JWT and the test project's publishable key.

This verifies database/backend recovery for that archive. It does not record a full browser marking/report-download rehearsal on an isolated restored website; production marker workflows had been checked separately. The native update's 38 automated tests also passed. No production data cleanup or production database cutover was performed as part of this verification.

Keep the archive's generated SHA-256/row-count manifest with the private backup. Take a fresh archive before a later cleanup or migration; this run does not verify future backups automatically.

References: [PostgreSQL 17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [PostgreSQL 17 pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html), [Supabase connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres), [Supabase restore considerations](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
