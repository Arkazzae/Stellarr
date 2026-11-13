# Automatic backups

Production Docker Compose enables a full backup every 24 hours, starting five
minutes after startup. Open **Cockpit → Backups → Backup settings** to configure
the schedule, retries, startup delay and local retention. Offsite copies are a
separate integration, configured under **Integrations**; [Cloudflare R2](cloudflare-r2.md)
is the supported destination.

Panel policy changes take effect without a restart, by the next scheduler check
(within one minute once the startup delay has elapsed). A running archive creation
finishes. Successful-cycle and retry dates are recalculated using the saved
interval and retry settings. Configuration changes require a fresh second step
when the owner's account has MFA enabled.

The saved panel policy overrides deployment defaults. **Restore deployment
defaults** removes that policy override; local retention remains in the existing
instance settings. The schedule policy is included in database and key backups.

Alternatively, configure defaults in `.env` and recreate the container with
`docker compose up -d`. Direct API deployments opt in with `Backups__Enabled=true`.
The first run happens after the startup delay; later runs are measured from the
last successful completion in UTC. This is an interval, not a wall-clock cron job.
A missed interval runs once after restart, without replaying every missed run.

```dotenv
STELLARR_BACKUP_ENABLED=true
STELLARR_BACKUP_INTERVAL_HOURS=24
STELLARR_BACKUP_RETRY_MINUTES=15
STELLARR_BACKUP_INITIAL_DELAY_MINUTES=5
```

A cycle contains SQLite's online snapshot, every readable object, data-protection
keys, and the instance's `secrets`, `tls` and `releases` folders. It verifies the
archive before publishing it and rejects automatic copies with missing objects.
An archive backup already running in Cockpit defers the scheduled job. Scheduled
and manual archive jobs share the same concurrency gate and progress display.
The audit associates scheduled creation with the current instance owner and
marks it `[automatic]`; the owner did not initiate that request.

Cockpit's Backups page shows the policy, last successful cycle, next attempt,
whether an offsite destination is active, any pending upload and the failure
state. When an offsite destination is enabled it must succeed before a cycle is
recorded as successful. Local success alone is not offsite success. Details of
failures are in the API logs. Configure external monitoring to alert when there
has been no success for longer than the interval plus the expected backup
duration; this implementation does not send email alerts.

The checkpoint is `${DataRoot}/automatic-backup.json`, outside the pruned backups
folder. It contains no credentials. Writes replace the checkpoint atomically.
A failed upload retries the same local archive after the retry interval, including
after restart. If local retention has already removed that pending archive, the
next attempt makes a fresh full backup. A crash before the pending checkpoint is
written may leave an extra verified local archive. Run one API process per data
volume, as with the existing SQLite deployment; the job lock is process-local.

The backup domain knows only an `IBackupDestination` contract. Concrete
destinations live under `Integrations`; enabling Cloudflare R2 does not change
the backup schedule or the local retention policy.

## Recovery drill

There is currently no automatic restore command. Test recovery on an isolated
instance before relying on the copies:

1. Download a completed archive from Cockpit or the private offsite bucket.
   Compare its SHA-256 with the remote `sha256` metadata if downloaded from R2.
2. Inspect `manifest.json`: format `stellarr-backup`, version 1, all four parts,
   no `missingObjects`. Verify the ZIP and the extracted database using
   `sqlite3 database/stellarr.db 'PRAGMA integrity_check;'`.
3. Stop the destination instance and keep a separate copy of its original data
   volume. Use the same Stellarr release initially. Restore the database to the
   path configured in `ConnectionStrings:Database`; do not retain old SQLite
   `-wal`/`-shm` files from the destination database.
4. Restore `keys/` into the API's data-protection key directory. Restore the
   contents of `instance/` into `DataRoot`, preserving relative paths and limiting
   file access to the service account. Restore deployment environment secrets
   separately. Missing keys prevent decrypting stored secrets.
5. Start the object store with the recovered storage credentials. Upload every
   file under `objects/` to the configured live bucket using the relative path
   as its key. The ZIP holds logical objects, not the object store's raw disk layout.
   Complete this while the API remains stopped; then start the API.
6. Verify owner login, historical messages, downloads, avatars, integrations,
   and a newly created backup. Record recovery time and the last recovered data.

SQLite is a consistent online snapshot; the object store and instance files are
read over time. This is not a transaction spanning SQLite and the object store.
For a strict point-in-time recovery drill, pause writes while making the backup.
Daily intervals imply roughly a 24-hour data-loss window plus backup duration;
failed cycles extend it. Measure recovery time from the drill rather than assuming it.
