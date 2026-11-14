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

## Restoring a backup

The operator CLI restores a full backup: an archive with all four parts. Test
the copies by restoring one on an isolated instance before relying on them.

1. Put the archive in the instance's backups folder if Cockpit does not already
   list it. If you downloaded it from R2, first compare its SHA-256 with the
   remote `sha256` metadata.

   ```sh
   docker compose cp ./backup-20261114-030000-<id>.zip stellarr:/data/stellarr/backups/
   ```

2. Stage it. The CLI checks the manifest, every entry name, the database's
   integrity and every entry's bytes, then copies the archive to
   `restore/staged.zip` on the data volume. Nothing is replaced yet.

   ```sh
   docker compose exec stellarr stellarr backup restore backup-20261114-030000-<id>.zip --yes
   ```

3. Restart the container. Before any service starts, the entrypoint replaces
   `db/`, `files/`, `keys/`, `secrets/`, `tls/` and `releases/` with the
   archive's and moves the folders it replaces to `restore/previous-<time>/`.
   `logs/`, `backups/` and the automatic backup checkpoint stay as they are.

   ```sh
   docker compose restart stellarr
   ```

4. Verify owner login, historical messages, downloads, avatars, integrations
   and a newly created backup. Record the recovery time and the last recovered
   data. Then delete `restore/previous-<time>/`; until then, moving its folders
   back undoes the restore.

`restore/last-restore.json` records what the last start did. An archive the
start refuses, for example one damaged since it was staged, leaves the data as
it was and is kept as `restore/refused-<time>.zip`; the instance then starts on
its previous data. If putting the archive in place fails part-way and the
previous folders cannot be moved back, the start leaves `restore/broken`, and
the container refuses to start until the volume is repaired and that file is
removed. `stellarr backup cancel` drops a staged archive before the restart.

The volume needs room for the instance's data, the staged archive and the
unpacked copy at once. `restore/previous-<time>/` and `restore/refused-<time>.zip`
are never removed automatically. A restore moves whole folders, so it refuses
when one of them is a mount of its own, such as `files/` on a separate disk;
restore such an instance by hand, as below.

Restore with the release that made the backup or a newer one: a newer release
upgrades the restored database at start, but an older one cannot read a
database a newer release has changed. Secrets read from the environment are not
in the archive, so keep a copy of `.env` with the backups.

### Restoring a partial backup

A database-only backup (a single `.db` file) and an archive without all four
parts are restored by hand, into a stopped instance:

1. Stop the instance and keep a separate copy of its data volume.
2. Put the database at `db/stellarr.db`, with no `stellarr.db-wal` or
   `stellarr.db-shm` left beside it.
3. Put the contents of `keys/` into `keys/`. A database without the keys it was
   written with cannot read the secrets stored in it.
4. Copy every file under `objects/` into `files/`, keeping its relative path:
   the archive's `objects/` folder has the same layout as `files/`.
5. Put the contents of `instance/` into the data root, keeping relative paths,
   and make the files under `secrets/` and `tls/` readable by their owner only.
6. Start the instance and verify it as above.

SQLite is a consistent online snapshot; the object store and instance files are
read over time. This is not a transaction spanning SQLite and the object store.
For a strict point-in-time recovery drill, pause writes while making the backup.
Daily intervals imply roughly a 24-hour data-loss window plus backup duration;
failed cycles extend it. Measure recovery time from the drill rather than assuming it.
