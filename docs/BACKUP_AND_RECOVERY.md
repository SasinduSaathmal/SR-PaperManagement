# Database backup and recovery

**Windows with limited RAM:** use [Windows native backup and restore](WINDOWS_NATIVE_BACKUP.md). That procedure uses PostgreSQL 17 client tools and a custom-format `.dump` archive, with no Docker or WSL. The CLI procedure below is optional and uses a different backup format; its restore commands do not apply to the native archive.

The website's Excel/PDF downloads are reports. A recoverable installation also needs Auth accounts, profiles, enrolments, aliases, scores (including removed entries), submissions, import queues, history, retry receipts, cleanup tombstones, saved report snapshots, database functions and permissions.

This procedure makes a Supabase logical backup and restores it into a **new, isolated Supabase project**. It does not overwrite the running website. There is no database-restore button in the website.

## What has been verified

The automated suite runs all migrations 001–012 in disposable PostgreSQL. Its final workflow uses two marker accounts, two closed papers, exact decimal scores, tied rankings, marker Excel files and final PDF/Excel reports. A PGlite data-directory round trip compares all 23 tracked tables and the application schema, then reads the final report and marker batch under the restored marker role.

Recovery checks also deliberately remove history, leak a write permission, and omit the custom Auth trigger. Each is detected. Reinstalling the Auth trigger retains the hardened invitation-only profile behavior.

The automated rehearsal is an embedded database test and does not access production. The owner subsequently completed the [native Windows hosted recovery checks](WINDOWS_NATIVE_BACKUP.md#verified-run-11-november-2026) on 11 November 2026, including restored admin sign-in and the workspace API. That native route uses a custom-format archive. The optional CLI route below uses separate SQL files and has not been exercised by that run.

## Before the first backup

On your Windows computer, have Node.js (already used by this project), the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) running, and PostgreSQL's `psql` command installed and on PATH. Prefer matching source/destination PostgreSQL major versions.

Open **PowerShell** in the project folder. These are PowerShell commands, not the VS Code `cmd` shell and not Supabase SQL Editor commands.

In Supabase, open **Connect** and copy the database connection URI. Use a direct connection or the **Session pooler** (port 5432) when direct IPv6 is unavailable. Do not use the transaction pooler (port 6543). Replace the password placeholder with the URL-encoded database password. This is the database connection URI, not the website URL, publishable key or server API key.

Pause all marking, imports, account invitations, logins and administrative changes until the backup and both inventories finish. The schema/data dumps use separate snapshots; this pause is needed for a consistent set. Save server-side work first; browser-only drafts are not part of a database backup.

## Create a backup

1. Set up the destination and connection in PowerShell. The hidden prompt keeps the URI out of command history. Do not paste it into a chat or save it in the repository.

```powershell
$project = (Get-Location).Path
$backup = Join-Path ([Environment]::GetFolderPath('MyDocuments')) ('Physics Backups\' + (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'))
New-Item -ItemType Directory -Path $backup -ErrorAction Stop | Out-Null
function Confirm-LastCommand {
  if ($LASTEXITCODE -ne 0) { throw 'Command failed. Stop here; the backup/restore is incomplete.' }
}
$connection = Read-Host 'SOURCE database URI (hidden)' -AsSecureString
$env:PGDATABASE = [System.Net.NetworkCredential]::new('', $connection).Password
$env:PGCLIENTENCODING = 'UTF8'
```

2. Check the source and save the starting inventory. These SQL files are read-only checks, not migrations. A failed check stops the process and must be resolved first.

```powershell
psql -X --set ON_ERROR_STOP=1 --file supabase/checks/restore_readiness.sql
Confirm-LastCommand
psql -X -q -t -A --set ON_ERROR_STOP=1 --file supabase/checks/backup_inventory.sql --output "$backup\inventory-before.json"
Confirm-LastCommand
```

3. Dump roles, schema and data. The command below detects the CLI's supported target flag: newer versions use `--remote`, older versions use `--db-url`. Keep the CLI version with the backup.

```powershell
$cliVersion = npx supabase --version
Confirm-LastCommand
$cliVersion | Set-Content "$backup\supabase-version.txt" -Encoding UTF8
$helpText = (npx supabase db dump --help) -join "`n"
Confirm-LastCommand
if ($helpText -match '(?m)^\s+--remote') {
  $target = "--remote=$env:PGDATABASE"
} elseif ($helpText -match '--db-url') {
  $target = "--db-url=$env:PGDATABASE"
} else { throw 'Unsupported CLI: check the current Supabase backup guide.' }
npx supabase db dump $target --file "$backup\roles.sql" --role-only
Confirm-LastCommand
npx supabase db dump $target --file "$backup\schema.sql"
Confirm-LastCommand
npx supabase db dump $target --file "$backup\data.sql" --use-copy --data-only -x storage.buckets_vectors -x storage.vector_indexes
Confirm-LastCommand
```

4. Check that the data includes Auth users/identities and the schema includes the private application schema. Do not accept a partial export that omits account data. The standard CLI data dump includes it; these checks stop an incompatible CLI/export from being mistaken for a complete backup.

```powershell
foreach ($table in @('users','identities')) {
  if (-not (Select-String -Path "$backup\data.sql" -Pattern ('^COPY "?auth"?\."?' + $table + '"?\s*\(') -Quiet)) {
    throw "Auth $table data is missing. Stop and inspect the export."
  }
}
if (-not (Select-String -Path "$backup\schema.sql" -Pattern 'app_private' -Quiet)) {
  throw 'The private application schema is missing.'
}
psql -X -q -t -A --set ON_ERROR_STOP=1 --file supabase/checks/backup_inventory.sql --output "$backup\inventory-after.json"
Confirm-LastCommand
node scripts/compare-backups.mjs "$backup\inventory-before.json" "$backup\inventory-after.json"
Confirm-LastCommand
```

If inventories differ, keep writes paused and repeat the backup into a new folder. Do not mark the differing set as verified.

5. Keep the matching code revision and recovery scripts with the backup, then make file checksums.

```powershell
git rev-parse HEAD | Set-Content "$backup\application-commit.txt" -Encoding UTF8
Confirm-LastCommand
Copy-Item supabase/checks/backup_inventory.sql,supabase/checks/restore_readiness.sql,supabase/restore/auth_profile_trigger.sql,scripts/compare-backups.mjs,docs/BACKUP_AND_RECOVERY.md -Destination $backup
Get-ChildItem $backup -File | Get-FileHash -Algorithm SHA256 |
  Select-Object @{Name='File';Expression={Split-Path $_.Path -Leaf}},Hash |
  ConvertTo-Json | Set-Content "$backup\SHA256SUMS.json" -Encoding UTF8
Remove-Item Env:PGDATABASE
Remove-Variable connection,target -ErrorAction SilentlyContinue
Write-Host "Backup saved: $backup"
```

If any command fails, clear `PGDATABASE`, `connection` and `target` before leaving the shell. Keep the backup in encrypted storage with a second private copy; Auth exports include account credential hashes and student data. Do not upload backups to GitHub. Resume normal marking once the source backup matches; a later restore rehearsal uses this frozen copy.

Take a backup before clearing trial data, before database migrations, and at a regular frequency appropriate to how much marking you can afford to redo. This guide does not schedule automatic backups.

## Restore rehearsal: a separate project

1. Create a new Supabase project. Keep public signup disabled. Do not connect the live website to it. Enable any source extensions required by the schema. Use the matching application Git revision recorded in the backup.
2. Open PowerShell in the backup folder and verify file integrity:

```powershell
Get-Content SHA256SUMS.json -Raw | ConvertFrom-Json | ForEach-Object {
  if ((Get-FileHash $_.File -Algorithm SHA256).Hash -ne $_.Hash) {
    throw "Backup file changed: $($_.File)"
  }
}
```

3. Set `PGDATABASE` to the **new destination** URI using the hidden prompt from the backup steps. Confirm the project ref/host against the destination dashboard. Use a new empty project; this procedure deliberately has no drop/truncate commands for an existing installation.
4. Restore in one error-stopping transaction, and restore the app's custom Auth trigger. The trigger's hardened function is already in the schema dump. **Do not rerun 001** or create a replacement owner account: the original account IDs and profiles are restored from the backup.

```powershell
psql -X --single-transaction --set ON_ERROR_STOP=1 --command 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated' --file roles.sql --file schema.sql --command 'SET session_replication_role = replica' --file data.sql --command 'SET session_replication_role = origin' --file auth_profile_trigger.sql
if ($LASTEXITCODE -ne 0) { throw 'Restore failed. Do not connect a website to this destination.' }
psql -X --set ON_ERROR_STOP=1 --file restore_readiness.sql
if ($LASTEXITCODE -ne 0) { throw 'Restore readiness checks failed. Keep this destination isolated.' }
```

If the Supabase platform reports a managed-role/ownership error, stop and follow its [documented restore troubleshooting](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore#troubleshooting-notes) for that exact error. Keep the original backup unchanged; make any reviewed edits on a copy. Do not switch off error stopping or run only the remaining statements after a failure.

5. Before logging in or allowing writes on the destination, compare it against the backup:

```powershell
psql -X -q -t -A --set ON_ERROR_STOP=1 --file backup_inventory.sql --output restored-inventory.json
if ($LASTEXITCODE -ne 0) { throw 'Inventory failed.' }
node compare-backups.mjs inventory-before.json restored-inventory.json
if ($LASTEXITCODE -ne 0) { throw 'Restored database differs; investigate before proceeding.' }
Remove-Item Env:PGDATABASE
Remove-Variable connection,target -ErrorAction SilentlyContinue
```

The inventory covers all 21 app tables plus `auth.users` and `auth.identities`; digests detect same-count content changes as well as missing rows. Schema digests cover app columns, constraints, RLS policies, functions, triggers and client/service permissions. They are comparison aids, not an independent cryptographic proof of a backup's authenticity. The readiness script checks known security and structural requirements; it cannot validate every possible platform customization.

## Settings outside the database

Record these separately in your private operational notes. SQL dumps do not recreate Cloudflare settings, email delivery settings or browser drafts.

| Setting | Restore action |
| --- | --- |
| Supabase Site URL and allowed redirects | Use the isolated review site's URL for a rehearsal; production must allow `/?auth=setup` and `/?auth=recovery`. |
| Email/password, public-signup restriction, SMTP/templates | Configure the destination to match the intended environment. Verify email delivery only with an explicitly chosen test recipient. |
| Cloudflare build variables | For an isolated review Worker, use the destination `VITE_SUPABASE_URL` and publishable key. |
| Cloudflare runtime variables | Set the destination `SUPABASE_URL` and secret `SUPABASE_SECRET_KEY` on that isolated Worker. Never use a VITE prefix for secrets. |
| Source code, assets and Worker configuration | Deploy the recorded Git revision. Do not expose the database backup as a static asset. |
| Storage files/Edge Functions/custom Auth or Storage objects | This app currently stores no files in Supabase Storage and uses the Cloudflare Worker for invitations. If these services are added later, extend the procedure; database backups do not contain Storage file bytes or deployed function code. |
| Vault/column encryption, custom login roles, CLI migration history | If introduced, follow the extra Supabase restore steps for encryption keys, role passwords and migration history. The current app migrations were applied manually in SQL Editor. |

## Final review before production use

On the isolated review deployment, sign in as an admin and an existing marker. Check student lookup (including old aliases), marker ownership, closed-test downloads, an existing saved report and its exact totals. For a fresh trial test, enter marks on both accounts, submit, close and generate a final report. Check that reopening/changing a source test leaves the older saved report intact and marks it as changed. Confirm disabled accounts cannot mark and that a marker cannot manage accounts or read another marker's private batch download.

Record the backup time, Git revision, CLI/Postgres versions, inventory match, readiness result and browser result. A rehearsal is complete only when the hosted destination passes these checks. Keep production on the original database throughout this rehearsal. A real recovery/cutover changes both build and runtime variables and needs a separate, deliberate deployment.

After a verified backup, clear trial records only when the owner is ready, using the website's reviewed [trial cleanup](TRIAL_DATA_CLEANUP.md), then import the approved student list. Cleanup is not part of running these backup scripts.

## References

- [Supabase backup and restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase CLI db dump](https://supabase.com/docs/reference/cli/supabase-db-dump)
- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
