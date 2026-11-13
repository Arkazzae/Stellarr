# Cloudflare R2 offsite backups

R2 is an optional destination for completed backup archives. It is configured
as an integration, under **Cockpit → Integrations → Cloudflare R2**, not on the
Backups page. The backup schedule and local retention stay under **Backups →
Backup settings**; see [Automatic backups](backups.md).

R2 is suitable because it exposes an S3-compatible API, including multipart
upload. Stellarr uses its existing AWS SDK dependency with a separate client and
credentials; changing the live `Storage` settings is unnecessary. No Worker,
Cloudflare Tunnel, public domain, CORS rule or public bucket is needed for
server-to-server backup uploads.

## Configure R2

1. Create a **private, dedicated backup bucket**. Keep public access disabled.
2. Create R2 S3 credentials scoped to that bucket with object read/write access
   (upload and metadata verification). Use separate credentials from live storage.
   Keep bucket-configuration administration outside the application.
3. In Cockpit, open **Integrations → Cloudflare R2** and save both credentials
   first. Then fill in the endpoint, region, bucket and prefix, turn on **Send
   backup copies to Cloudflare R2**, and save the connection.
4. Credentials set in the panel are encrypted with the instance's data-protection
   keys and are never returned to the browser. Set them in `.env` instead if the
   deployment owns the secrets:

```dotenv
STELLARR_CLOUDFLARE_R2_ENABLED=true
STELLARR_CLOUDFLARE_R2_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
STELLARR_CLOUDFLARE_R2_REGION=auto
STELLARR_CLOUDFLARE_R2_BUCKET=stellarr-backups
STELLARR_CLOUDFLARE_R2_ACCESS_KEY=YOUR_R2_ACCESS_KEY_ID
STELLARR_CLOUDFLARE_R2_SECRET_KEY=YOUR_R2_SECRET_ACCESS_KEY
STELLARR_CLOUDFLARE_R2_PREFIX=stellarr
```

Use the S3 endpoint shown for your bucket, including any jurisdiction-specific
hostname. Never use an `r2.dev` public URL. For a direct .NET deployment the
names are `Cloudflare__R2__Enabled`, `Endpoint`, `Region`, `Bucket`, `AccessKey`,
`SecretKey` and `Prefix`, each with the `Cloudflare__R2__` prefix.

The panel connection and its credentials are included in database/key backups;
environment-supplied secrets are intentionally absent from the ZIP. Restoring
panel credentials needs the recovered data-protection keys.

## Upload behavior

Object names are `PREFIX/SERVER_UUID/backup-TIMESTAMP-UUID.zip`. Uploads stream
from disk with multipart support (64 MiB parts), avoiding loading a full archive
into RAM. R2 requires disabling AWS streaming payload signing/default checksum
behavior; HTTPS is mandatory. A SHA-256 digest is stored in object metadata and
checked alongside length with a metadata request after upload. This metadata
check confirms the remote object's declared attributes, **not an independent
read-back checksum of remote bytes**. Download and hash a sample regularly.

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

The archive includes recoverable secrets and private user content. R2 transport
and provider-side encryption do not provide client-side encryption. This version
uploads the existing ZIP format without client-side encryption. If your threat
model requires a key held outside Cloudflare, use an encrypted backup system
(such as restic) as an additional layer before enabling this destination. Keep
`.env` and the deployment configuration in a separate secure recovery store.

Full copies duplicate all media every cycle. Estimate storage as daily archive
size × retention days, plus local snapshot/verification working space and
multipart overhead. For large stores, an incremental encrypted repository is a
better next step than increasing full-backup frequency.

## Deploy to Cloudflare button

The [Deploy to Cloudflare button](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
deploys a **Workers** application from a public GitHub or GitLab repository. It
cannot deploy Stellarr itself: Stellarr runs as a Docker container with
ASP.NET Core, SQLite, RustFS, coturn and a Rust media server, and no part of it
runs on Workers. Adding the standard button to the README would therefore be
misleading.

A button could only deploy an optional companion Worker. That is a separate
integration project, not the current S3 upload path:

1. Put the Worker in an isolated subdirectory, such as
   `deploy/cloudflare/backup-relay/`, with its own `package.json`,
   `wrangler.jsonc`, `.env.example` and README. Deploy buttons do not support a
   monorepo that shares dependencies outside that subdirectory.
2. Declare an R2 binding in `wrangler.jsonc` so Cloudflare provisions the bucket
   during deployment. The Worker would receive uploads with a bearer token and
   write them through the binding, because a Worker cannot hand out R2 S3
   credentials.
3. Add a second `IBackupDestination` implementation to Stellarr that speaks that
   HTTP protocol. The existing S3 implementation would remain the default.
4. Point the button at the subdirectory:

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Arkazzae/Stellarr/tree/main/deploy/cloudflare/backup-relay)
```

That work is intentionally not part of the current integration. Direct S3 access
is simpler, keeps credentials under the operator's control, and avoids putting a
second upload protocol in the backup core. The button becomes worthwhile only
when a companion Worker provides something Stellarr cannot get from the S3 API.

## References

Cloudflare documentation reviewed on 2026-11-13:

- [S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [.NET SDK settings and signing compatibility](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-net/)
- [Object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
- [Bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)
- [Upload methods and multipart behavior](https://developers.cloudflare.com/r2/objects/upload-objects/)
- [Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
