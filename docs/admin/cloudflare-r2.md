# Cloudflare R2 offsite backups

R2 is an optional destination for completed backup archives. It is configured
as an integration, under **Cockpit → Integrations → Cloudflare R2**, not on the
Backups page. The backup schedule and local retention stay under **Backups →
Backup settings**; see [Automatic backups](backups.md).

R2 is suitable because it exposes an S3-compatible API, including multipart
upload. Stellarr supports two connection modes:

- **S3 API credentials** — uploads go directly from the container to R2.
  Recommended for large archives.
- **Backup relay Worker** — uploads go to the Worker in
  [`deploy/cloudflare/backup-relay`](../../deploy/cloudflare/backup-relay/README.md),
  which writes them to R2 through a binding. Cloudflare provisions the bucket
  and no R2 S3 credentials are needed.

No Cloudflare Tunnel, public domain, CORS rule or public bucket is needed for
either mode.

## Direct S3 mode

1. Create a **private, dedicated backup bucket**. Keep public access disabled.
2. Create R2 S3 credentials scoped to that bucket with object read/write access
   (upload and metadata verification). Use separate credentials from live storage.
   Keep bucket-configuration administration outside the application.
3. In Cockpit, open **Integrations → Cloudflare R2**, choose **R2 S3 API
   credentials**, save both credentials first, then fill in the endpoint,
   region, bucket and prefix. Turn on **Send backup copies to Cloudflare R2**
   and save.
4. Credentials set in the panel are encrypted with the instance's data-protection
   keys and are never returned to the browser. Set them in `.env` instead if the
   deployment owns the secrets:

```dotenv
STELLARR_CLOUDFLARE_R2_ENABLED=true
STELLARR_CLOUDFLARE_R2_MODE=s3
STELLARR_CLOUDFLARE_R2_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
STELLARR_CLOUDFLARE_R2_REGION=auto
STELLARR_CLOUDFLARE_R2_BUCKET=stellarr-backups
STELLARR_CLOUDFLARE_R2_ACCESS_KEY=YOUR_R2_ACCESS_KEY_ID
STELLARR_CLOUDFLARE_R2_SECRET_KEY=YOUR_R2_SECRET_ACCESS_KEY
STELLARR_CLOUDFLARE_R2_PREFIX=stellarr
```

Use the S3 endpoint shown for your bucket, including any jurisdiction-specific
hostname. Never use an `r2.dev` public URL. For a direct .NET deployment the
names are `Cloudflare__R2__Enabled`, `Mode`, `Endpoint`, `Region`, `Bucket`,
`AccessKey`, `SecretKey` and `Prefix`, each with the `Cloudflare__R2__` prefix.

## Backup relay Worker

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Arkazzae/Stellarr/tree/main/deploy/cloudflare/backup-relay)

The [Deploy to Cloudflare button](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
deploys a **Workers** application, so it cannot deploy Stellarr itself. It
deploys the optional relay instead. The container still runs Stellarr; the Worker
is only the offsite destination.

1. Click the button. Cloudflare clones the self-contained
   `deploy/cloudflare/backup-relay` subdirectory, reads `wrangler.jsonc`,
   provisions the R2 bucket bound as `BACKUPS`, and asks for `BACKUP_TOKEN`.
2. Set `BACKUP_TOKEN` to a long random value, for example `openssl rand -hex 32`.
3. In Cockpit choose **Backup relay Worker**, paste the Worker URL and the same
   token, keep the object prefix, then enable offsite copies and save.
4. The token is stored like every other instance secret: encrypted in the panel
   or supplied as `STELLARR_CLOUDFLARE_R2_WORKER_TOKEN`. The Worker URL goes in
   `STELLARR_CLOUDFLARE_R2_ENDPOINT`.

```dotenv
STELLARR_CLOUDFLARE_R2_ENABLED=true
STELLARR_CLOUDFLARE_R2_MODE=worker
STELLARR_CLOUDFLARE_R2_ENDPOINT=https://stellarr-backup-relay.ACCOUNT.workers.dev
STELLARR_CLOUDFLARE_R2_WORKER_TOKEN=YOUR_LONG_RANDOM_TOKEN
STELLARR_CLOUDFLARE_R2_PREFIX=stellarr
```

The Worker exposes `PUT`, `HEAD` and `GET` on `/object`, authenticated with a
bearer token. Stellarr streams the archive to `PUT`, then checks the size and
SHA-256 metadata through `HEAD`. An existing object with the same digest is left
untouched; a different digest returns `409` instead of overwriting it.

### Worker limits

The Worker receives the whole archive as one HTTP request. Cloudflare applies a
Worker request-body limit (currently about 100 MB on the Free plan and 500 MB on
paid plans; check the current limit before relying on it). Full Stellarr archives
with media can exceed that. Prefer direct S3 mode for large stores, or keep the
Worker for small instances without many attachments. The Worker itself has no
list or delete route; manage lifecycle rules, bucket locks and retention in
Cloudflare.

The Worker directory is self-contained on purpose: Deploy to Cloudflare buttons
do not support a monorepo whose subdirectory depends on files outside it. It has
its own `package.json`, `wrangler.jsonc`, TypeScript config and README.

## Upload behavior

Object names are `PREFIX/SERVER_UUID/backup-TIMESTAMP-UUID.zip` in both modes.
Uploads stream from disk, avoiding loading a full archive into RAM. Direct S3
uploads use multipart support (64 MiB parts); the Worker streams the request body
to its R2 binding.

Direct S3 mode stores a SHA-256 digest in object metadata and checks it alongside
length with a metadata request after upload. Worker mode stores the digest in R2
custom metadata and returns it from `HEAD` for the same check. These checks
confirm the remote object's declared attributes, **not an independent read-back
checksum of remote bytes**. Download and hash a sample regularly.

Configure bucket policies independently of local retention:

- Local copies: Cockpit backup retention (14 days by default), enforced by the
  maintenance worker when cleanup is enabled.
- Remote copies: for example, an R2 lifecycle rule expiring the instance prefix
  after 90 days. Stellarr does not delete remote objects or manage bucket policies.
- Deletion protection: optionally lock the prefix for 30 days using R2 bucket
  locks, with expiration later than the lock. Identical upload retries recognize
  an existing object by its length and SHA-256 metadata and avoid overwriting it.
  An object with conflicting metadata fails the cycle for operator investigation.
- Incomplete multipart uploads: retain R2's cleanup rule or configure one explicitly.
  Worker uploads are single `PUT` requests through the binding, but R2 lifecycle
  rules still apply.

The archive includes recoverable secrets and private user content. R2 transport
and provider-side encryption do not provide client-side encryption. This version
uploads the existing ZIP format without client-side encryption. If your threat
model requires a key held outside Cloudflare, use an encrypted backup system
(such as restic) as an additional layer before enabling this destination. Keep
`.env`, the Worker token and the deployment configuration in a separate secure
recovery store.

Full copies duplicate all media every cycle. Estimate storage as daily archive
size × retention days, plus local snapshot/verification working space and
multipart overhead. For large stores, an incremental encrypted repository is a
better next step than increasing full-backup frequency.

The panel connection and its credentials are included in database/key backups;
environment-supplied secrets are intentionally absent from the ZIP. Restoring
panel credentials needs the recovered data-protection keys.

## References

Cloudflare documentation reviewed on 2026-11-13:

- [S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [.NET SDK settings and signing compatibility](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-net/)
- [Object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
- [Bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)
- [Upload methods and multipart behavior](https://developers.cloudflare.com/r2/objects/upload-objects/)
- [Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
