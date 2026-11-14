# Upgrading

Upgrading replaces the container image while preserving the `stellarr_stellarr_data` volume. The API applies schema updates automatically on startup.

> [!CAUTION]
> Never run `docker compose down -v` on a production instance. The `-v` flag deletes the data volume, including all messages, uploads, accounts, and secrets.

## 1. Back up the data volume

Always take a full volume backup while the container is stopped so SQLite (`stellarr.db`) and its WAL files are consistent.

1. Record the currently running image version:

   ```bash
   docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' stellarr
   ```

2. Stop the container and archive `stellarr_stellarr_data`:

   ```bash
   docker compose stop
   docker run --rm -v stellarr_stellarr_data:/data -v "$PWD":/backup alpine \
     tar czf /backup/stellarr-data-$(date +%F).tar.gz -C /data .
   ```

The archive contains the SQLite database, uploaded objects, session keys, shared secrets, and TLS private key. Store it securely off-host.

> [!TIP]
> You can also create backups from Cockpit (**Backups**) while the instance is running. A database-only backup produces a single SQLite file; a full backup creates a `.zip` archive containing the database, uploaded objects, data-protection keys, and instance files (`secrets/`, `tls/`, desktop releases) with a `manifest.json`. Because Cockpit stores backups in `/data/stellarr/backups` on the same volume, download copies off-host and keep a copy of your `.env` file alongside them. To restore a Cockpit full backup, stage it with `stellarr backup restore` and restart the container; see [Restoring a backup](../admin/backups.md#restoring-a-backup).

## 2. Pull and start the new version

Release notes are published at <https://github.com/Arkazzae/Stellarr/releases>.

1. Update `STELLARR_VERSION` in `.env` (or keep `latest` to track the newest stable release):

   ```bash
   STELLARR_VERSION=1.2.3
   ```

2. Pull the image and recreate the container:

   ```bash
   docker compose pull
   docker compose up -d
   ```

   If `STELLARR_VERSION` references a tag that does not exist in GHCR, `docker compose` attempts a local build and fails if no `Dockerfile` is present.

3. Verify the upgrade:

   ```bash
   docker compose ps
   curl -sk -o /dev/null -w '%{http_code}\n' https://localhost:8443/login
   docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' stellarr
   ```

   Confirm that `docker compose ps` reports `healthy` (which checks both `/health` and `/login`) and `curl` returns `200`.

## Database schema updates

On startup, the API enables SQLite WAL mode and runs idempotent schema initialization steps (creating missing tables/indexes, adding columns, and backfilling values).

> [!WARNING]
> Schema changes modify the SQLite database in place and are not backward-compatible. Do not start an older container image against a data volume that has already been opened by a newer version; restore your volume backup to roll back.

## Rollback

Rolling back restores the entire data volume to the backup snapshot; any messages, uploads, or accounts created since the backup are lost.

1. Stop the stack and restore the archive:

   ```bash
   docker compose down
   docker run --rm -v stellarr_stellarr_data:/data -v "$PWD":/backup alpine \
     sh -c "find /data -mindepth 1 -delete && tar xzf /backup/stellarr-data-YYYY-MM-DD.tar.gz -C /data"
   ```

2. Set `STELLARR_VERSION` in `.env` to the previous version tag and start the container:

   ```bash
   docker compose up -d
   ```

Existing user sessions remain valid because the data-protection keys are restored with the archive.

## Migration notes

### Cockpit and `STELLARR_DOMAIN`

- The operator panel has been renamed from `ops` to **Stellarr Cockpit** and is served at `/cockpit/` (`/ops/` redirects with `308`).
- `STELLARR_DOMAIN` replaces `PUBLIC_HOST` as the primary hostname variable (`PUBLIC_HOST` is still read as a fallback when `STELLARR_DOMAIN` is unset).
- The public origin used in password-reset links and `/.well-known/stellarr/client` is now derived from environment variables (`https://<STELLARR_DOMAIN>:<STELLARR_PUBLIC_PORT>`, or `STELLARR_PUBLIC_URL` when set) and is read-only in Cockpit. Behind a reverse proxy on port `443`, set `STELLARR_PUBLIC_PORT=443` or `STELLARR_PUBLIC_URL`.
- In `docker-compose.dev.yml`, `STELLARR_DEV_OPS_PORT` has been renamed to `STELLARR_DEV_COCKPIT_PORT`.

### Language default (`STELLARR_LANGUAGE`)

- Instances now default to English (`STELLARR_LANGUAGE=en`).
- When upgrading an older Polish-only deployment, set `STELLARR_LANGUAGE=pl` in `.env` to keep server-generated messages, emails, and the default interface language in Polish. Users who explicitly selected a language in their browser keep their preference, and existing database records retain the language in which they were written.
- The default OIDC sign-in button label changed from `Konto główne` to `Main account`. Set `STELLARR_OIDC_DISPLAY_NAME=Konto główne` to keep the Polish label.
