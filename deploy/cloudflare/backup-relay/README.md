# Stellarr backup relay

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Arkazzae/Stellarr/tree/main/deploy/cloudflare/backup-relay)

An optional Worker that receives completed Stellarr backups over HTTPS and
writes them to a private R2 bucket through a binding. Use it when you want
Cloudflare to provision the bucket and you would rather not create R2 S3
credentials.

Stellarr itself still runs in its Docker container. This Worker is only the
offsite destination; it is not a Stellarr deployment.

## Deploy with the button

1. Click **Deploy to Cloudflare**. Cloudflare clones this subdirectory into your
   GitHub or GitLab account, reads `wrangler.jsonc`, provisions the R2 bucket
   bound as `BACKUPS`, and asks for `BACKUP_TOKEN`.
2. Set `BACKUP_TOKEN` to a long random value, for example `openssl rand -hex 32`.
   The same value goes into Stellarr later.
3. After deployment, copy the Worker URL, such as
   `https://stellarr-backup-relay.ACCOUNT.workers.dev`.
4. In Stellarr open **Cockpit → Integrations → Cloudflare R2**. Choose
   **Backup relay Worker**, paste the Worker URL and token, keep the object
   prefix, then enable offsite copies and save.

The bucket name defaults to `stellarr-backups`. Change `r2_buckets[0].bucket_name`
before deploying if you want another name; the button uses that value when it
provisions the bucket.

## Deploy manually

```sh
npm install
npx wrangler r2 bucket create stellarr-backups
npx wrangler secret put BACKUP_TOKEN
npm run deploy
```

`npm run deploy` runs `wrangler deploy`. For local work, copy
`.dev.vars.example` to `.dev.vars`, set a token, and run `npm run dev`.

## Protocol

All object routes require `Authorization: Bearer <BACKUP_TOKEN>`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness check; no authentication. |
| `PUT` | `/object` | Uploads one archive. `X-Stellarr-Key` names the object and `X-Stellarr-Sha256` carries its lowercase hex digest. |
| `HEAD` | `/object` | Reports `X-Stellarr-Size` and `X-Stellarr-Sha256`, which Stellarr checks after upload. |
| `GET` | `/object` | Downloads an object for a manual restore. |

An upload for a key that already exists with the same digest returns `200` and
leaves the object untouched. A different digest returns `409`; the Worker never
overwrites an object whose metadata conflicts. There is no list or delete route:
manage retention, lifecycle rules and bucket locks in Cloudflare.

Object keys are `<prefix>/<server-uuid>/<backup-file>.zip`, the same layout as
direct S3 uploads. A Worker token grants read and write access to the objects in
this bucket. Keep the bucket private, rotate the token if it leaks, and keep a
copy of it in your recovery store.

## Checks

```sh
npm run check   # TypeScript, no emit
npm run deploy  # wrangler deploy
```

The directory is self-contained on purpose: the Deploy to Cloudflare button does
not support a monorepo whose subdirectory depends on files outside it.
