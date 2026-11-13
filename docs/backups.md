# Automatic backups and Cloudflare R2

Production Docker Compose enables a full backup every 24 hours, starting five
minutes after startup. Open **Cockpit → Backups → Backup settings** to configure
the schedule, retries, startup delay, local retention and remote destination.
Save the two R2 credentials using their individual fields before enabling remote
uploads and saving the policy. The panel stores credentials encrypted using the
instance's data-protection keys and never returns their values.

Panel policy changes take effect without a restart, by the next scheduler check
(within one minute once the startup delay has elapsed). A running archive creation
finishes. Destination changes apply to the next upload, including an upload pending
from a previous failure. Successful-cycle and retry dates are recalculated using
the saved interval and retry settings. Configuration changes require a fresh
second step when the owner's account has MFA enabled.

The saved panel policy overrides deployment defaults. **Restore deployment defaults**
removes that policy override; local retention remains in the existing instance
settings, and each credential has its own remove action to fall back to the
environment. Policy and credentials are included in database/key backups.
Cloudflare lifecycle retention and bucket locks are managed in Cloudflare's own
panel, independently of local retention; Stellarr does not modify bucket policies.

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
pending upload and failure state. An enabled remote destination must succeed
before a cycle is recorded as successful. Local success alone is not offsite
success. Details of failures are in the API logs. Configure external monitoring
to alert when there has been no success for longer than the interval plus the
expected backup duration; this implementation does not send email alerts.

The checkpoint is `${DataRoot}/automatic-backup.json`, outside the pruned backups
folder. It contains no credentials. Writes replace the checkpoint atomically.
A failed upload retries the same local archive after the retry interval, including
after restart. If local retention has already removed that pending archive, the
next attempt makes a fresh full backup. A crash before the pending checkpoint is
written may leave an extra verified local archive. Run one API process per data
volume, as with the existing SQLite deployment; the job lock is process-local.

## Cloudflare R2 configuration

R2 is a suitable offsite destination because it exposes an S3-compatible API,
including multipart upload. Stellarr uses its existing AWS SDK dependency with a
separate client and credentials; changing the live `Storage` settings is unnecessary.
No Worker, Cloudflare Tunnel, public domain, CORS rule or public bucket is needed
for server-to-server backup uploads.

1. Create a **private, dedicated backup bucket**. Keep public access disabled.
2. Create R2 S3 credentials scoped to that bucket with object read/write access
   (upload and metadata verification). Use separate credentials from live storage.
   Keep bucket-configuration administration outside the application.
3. Set the following variables in the deployment's `.env`:

```dotenv
STELLARR_BACKUP_REMOTE_ENABLED=true
STELLARR_BACKUP_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
STELLARR_BACKUP_REGION=auto
STELLARR_BACKUP_BUCKET=stellarr-backups
STELLARR_BACKUP_ACCESS_KEY=YOUR_R2_ACCESS_KEY_ID
STELLARR_BACKUP_SECRET_KEY=YOUR_R2_SECRET_ACCESS_KEY
STELLARR_BACKUP_PREFIX=stellarr
```

Use the S3 endpoint shown for your bucket, including any jurisdiction-specific
hostname. Never use an `r2.dev` public URL. For a direct .NET deployment the names
are `Backups__Destination__Enabled`, `Endpoint`, `Region`, `Bucket`, `AccessKey`,
`SecretKey`, `Prefix`, each with the `Backups__Destination__` prefix.
Invalid enabled destination fields fail startup. Missing credentials fail the
backup cycle and can be supplied through Cockpit. Environment credentials are not
returned through the Cockpit API or included in the backup; encrypted panel
credentials are included with the database, and need the recovered keys to read.

Object names are `PREFIX/SERVER_UUID/backup-TIMESTAMP-UUID.zip`. Uploads stream
from disk with multipart support (64 MiB parts), avoiding loading a full archive
into RAM. R2 requires disabling AWS streaming payload signing/default checksum
behavior; HTTPS is mandatory. A SHA-256 digest is stored in object metadata and
checked alongside length with a metadata request after upload. This metadata
check confirms the remote object's declared attributes, **not an independent
read-back checksum of remote bytes**. Download and hash a sample regularly.

Configure bucket policies independently of local retention:

- Local copies: the existing Cockpit backup retention (14 days by default),
  enforced by the maintenance worker when cleanup is enabled.
- Remote copies: for example, an R2 lifecycle rule expiring the instance prefix
  after 90 days. Stellarr does not delete remote objects or manage bucket policies.
- Deletion protection: optionally lock the prefix for 30 days using R2 bucket
  locks, with expiration later than the lock. Identical upload retries recognize
  an existing object by its length and SHA-256 metadata and avoid overwriting it.
  An object with conflicting metadata fails the cycle for operator investigation.
- Incomplete multipart uploads: retain R2's cleanup rule or configure one explicitly.

The archive includes recoverable secrets and private user content. R2 transport
and provider-side encryption do not provide client-side encryption. This version
uploads the existing ZIP format without client-side encryption. If your threat
model requires a key held outside Cloudflare, use an encrypted backup system
(such as restic) as an additional layer before enabling this destination.
Keep `.env` and the deployment configuration in a separate secure recovery store:
environment-supplied secrets are intentionally absent from the ZIP.

Full copies duplicate all media every cycle. Estimate storage as daily archive
size × retention days, plus local snapshot/verification working space and
multipart overhead. For large stores, an incremental encrypted repository is a
better next step than increasing full-backup frequency.

## Recovery drill

There is currently no automatic restore command. Test recovery on an isolated
instance before relying on the copies:

1. Download a completed archive from Cockpit or the private R2 bucket. Compare
   its SHA-256 with the remote `sha256` metadata if downloaded from R2.
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

## References

Cloudflare documentation reviewed on 2026-11-13:

- [S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [.NET SDK settings and signing compatibility](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-net/)
- [Object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
- [Bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)
- [Upload methods and multipart behavior](https://developers.cloudflare.com/r2/objects/upload-objects/)
