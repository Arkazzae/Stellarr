# Upgrading

An upgrade replaces the image and keeps the data volume. The new server brings
the database up to date when it starts.

> [!CAUTION]
> `docker compose down -v` deletes the data volume with every message, upload,
> account and secret. Never use `-v` on an installation you want to keep.

## Back up

Back up before every upgrade. The copy has to be taken while the container is
stopped, because the database is a SQLite file that the server writes to.

1. Note the version that runs now, to know what to go back to:

   ```bash
   docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' stellarr-v2
   ```

2. Stop the container and archive the data volume. Compose names the volume
   `<project>_<volume>`, which is `stellarr-v2_stellarr_data` with the compose file
   as shipped. `docker volume ls` shows it.

   ```bash
   docker compose stop
   docker run --rm -v stellarr-v2_stellarr_data:/data -v "$PWD":/backup alpine \
     tar czf /backup/stellarr-data-$(date +%F).tar.gz -C /data .
   ```

Start the container again with `docker compose start` if you do not upgrade
straight away.

The archive holds the database, the uploaded files, the session keys, the
secrets and the private key of the certificate. Keep it as safe as the server.
The operator panel can also copy the database, but those copies stay in the same
volume and leave out the uploaded files, so they do not replace the archive.

## Upgrade

The notes of each release are at <https://github.com/Arkazzae/Stellarr/releases>.

1. Choose the release in `.env`. A pinned version changes only when you change
   it, while `latest` moves with every stable release.

   ```bash
   STELLARR_VERSION=1.2.3
   ```

2. Download the image and recreate the container. The tag has to exist: for a
   missing one, Compose falls back to building the image and, in a folder
   without the `Dockerfile`, fails with `failed to read dockerfile: open
   Dockerfile: no such file or directory`.

   ```bash
   docker compose pull
   docker compose up -d
   ```

3. Check the container and the page, then the version:

   ```bash
   docker compose ps
   curl -sk -o /dev/null -w '%{http_code}\n' https://localhost:8443/
   docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' stellarr-v2
   ```

   `docker compose ps` lists the service as `healthy` after about 15 seconds,
   and `curl` prints `200`.

> [!WARNING]
> The health check calls only the API. If the web server fails to start, the
> container still reports `healthy` and Nginx answers 502 for every page. Request
> the page, as in step 3, and read `docker compose logs` if it does not answer 200.

## What the server does to the database

Before the server accepts requests, it creates the database if there is none,
switches it to write-ahead logging and runs a fixed list of steps. Each step
creates a missing table or index, adds a missing column or backfills a value. One
step drops four columns of the old mail settings. The steps run on every start and
do nothing on a database that is up to date. There is no version table and no
migration command.

The steps change the database in place. Do not start an older image on a volume
that a newer one has already opened. To go back, restore the archive.

A volume written by an earlier build starts on the new image with its accounts
intact.

## Go back

Restoring replaces everything in the volume with the archive. Messages, uploads
and accounts written since the backup are lost.

1. Stop the container and restore the archive. Replace the file name with your
   archive:

   ```bash
   docker compose down
   docker run --rm -v stellarr-v2_stellarr_data:/data -v "$PWD":/backup alpine \
     sh -c "find /data -mindepth 1 -delete && tar xzf /backup/stellarr-data-2026-11-11.tar.gz -C /data"
   ```

2. Set `STELLARR_VERSION` in `.env` to the version you noted, and start:

   ```bash
   docker compose up -d
   ```

People who were signed in stay signed in, because the session keys are part of
the archive.

## Upgrade from the Polish-only builds

Builds that predate the language setting spoke Polish everywhere. `STELLARR_LANGUAGE`
now sets the language of the instance, and it is `en` unless you set it.

- To keep server messages, mail and the default interface language in Polish, add
  `STELLARR_LANGUAGE=pl` to `.env` before you start the new image. Anyone who
  chose a language in the settings keeps that choice.
- Text saved earlier keeps its language, whichever value you set. Channel names,
  role names and messages are not translated.
- The single sign-on button was labelled `Konto główne` by default. It now reads
  `Main account`. To keep the old label, set `STELLARR_OIDC_DISPLAY_NAME=Konto główne`.

[Configuration](configuration.md#language) describes the language setting.
