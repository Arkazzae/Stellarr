# Operator CLI

`stellarr` is the operator command inside the Stellarr container. It checks an
installation, edits the settings Cockpit stores, manages encrypted secrets,
inspects account security and revokes sessions without signing in to Cockpit or
starting a second API.

It runs against the data volume, not through the HTTP API. The permission is
therefore access to the container and its volume: anyone who can run
`docker exec` or mount `/data/stellarr` already controls the instance. The CLI
records its own operator audit entries as `local-cli`; it never pretends an
application account made the change.

```sh
docker compose exec stellarr stellarr doctor
docker compose exec stellarr stellarr config list
docker compose exec stellarr stellarr config set time-zone Europe/Warsaw
docker compose exec stellarr stellarr sessions list --user arkazz
```

`help`, `--help` and `version` do not open the database. Every other command
opens the existing database read-write (or read-only where nothing changes) and
never creates it. There are no migrations or instance initializers in the CLI.
If the schema is older than the CLI, start the API once so its normal startup
upgrade runs, then retry.

## Data root and container paths

The CLI resolves the data root in this order:

1. `--data-root <path>`
2. `STELLARR_DATA_ROOT`
3. the `DataRoot` configuration value
4. `/data/stellarr`

The database is `<data-root>/db/stellarr.db` and the data-protection keys are
`<data-root>/keys`. This is the same database, encryption key ring and
`Stellarr` application name the API uses, including when `docker exec` does not
inherit exports that the entrypoint made while starting the services.

Read-only commands never create the keys directory, write a key file or persist
a new data-protection key. If every stored key has expired, decryption uses an
in-memory XML snapshot so the old payload still opens without modifying the
volume. The API's key ring must exist before `secrets set` can write a value the
running API can read.

## Commands

### Status and diagnostics

```sh
stellarr status
stellarr doctor
```

`status` reports the database path and size, the instance name, account and
active-session counts, and whether the local API answers
`http://127.0.0.1:5000/health/ready`. Set `STELLARR_API_URL` to probe another
address. It is healthy and exits `0` only when the local API answers; an
unreachable API or a non-success health response is `healthy: false` with exit
status `1`. The database report stays in the same document.

`doctor` checks the data root, database and required schema, key directory,
free space on the filesystem that actually holds the data root, and the local
API. It does not modify anything. On a stopped instance the API probe is a
warning and `doctor` still succeeds, which is what makes it useful for offline
recovery. A missing database, an incompatible schema or a missing required
directory is a failure.

### Configuration

```sh
stellarr config list
stellarr config get time-zone
stellarr config set time-zone Europe/Warsaw
stellarr config validate
```

`config list` prints the effective value, where it came from (`database`,
`configuration`, `environment` or `default`), whether it is editable, and
whether a restart is required. `config set` writes the same database row Cockpit
uses, so Cockpit sees the change immediately. Validation is the same code path
as Cockpit: one invalid value is rejected before anything is saved, and saving
one key never drops the others. The first save uses the same initial values as
Cockpit.

Database-backed keys:

| Key | Type |
| --- | --- |
| `instance.name` | text, 1–80 characters |
| `time-zone` | IANA time zone |
| `mail.enabled` | boolean |
| `mail.from-address` | email address |
| `mail.smtp.host` | text, up to 255 characters |
| `mail.smtp.port` | integer, 1–65535 |
| `mail.smtp.username` | text, up to 320 characters |
| `mail.smtp.security` | `starttls`, `tls` or `none` |
| `mail.resend.enabled` | boolean |
| `mail.invites.enabled` | boolean |
| `mail.recovery.enabled` | boolean |
| `mail.alerts.enabled` | boolean |
| `giphy.enabled` | boolean |
| `retention.backups-days` | integer, 1–3650 |
| `retention.logs-days` | integer, 1–3650 |
| `retention.orphans-days` | integer, 1–3650 |
| `cleanup.enabled` | boolean |
| `mfa.requirement` | `optional`, `admins`, `everyone` or `cockpit` |
| `mfa.trusted-device-days` | integer, 1–365 |
| `mfa.challenge-minutes` | integer, 1–60 |
| `mfa.email-code-minutes` | integer, 1–60 |
| `mfa.email-cooldown-seconds` | integer, 0–600 |
| `mfa.email-attempts` | integer, 1–10 |
| `mfa.email-sends-per-hour` | integer, 1–60 |
| `mfa.cli-recovery-minutes` | integer, 1–60 |

Booleans accept `true`/`false` (also `1`/`0`, `yes`/`no`, `on`/`off`).

`config validate` checks the stored configuration without saving and without
sending mail. It also warns when mail is enabled but the selected transport is
not ready, or when an integration is enabled without its secret.

Startup settings are read-only. `config list` names them with the value's source
and the environment variable to change. Edit `.env` or Compose, then recreate
the container; the CLI never edits the host `.env` or creates an override file.
Read-only startup keys include:

- `public-url` (`STELLARR_PUBLIC_URL`, or `STELLARR_DOMAIN` and `STELLARR_PUBLIC_PORT`)
- `tls.domain` (`STELLARR_DOMAIN`)
- `https-port` (`PUBLIC_HTTPS_PORT`, normally set from host `STELLARR_HTTPS_PORT`; entrypoint default `443`)
- `oidc.enabled`, `oidc.authority`, `oidc.client-id`, `oidc.callback-path`
- `rtc.public-host`, `rtc.turn-port`, `rtc.turns-port`, `rtc.turns-enabled`, `rtc.turn-tcp-enabled`, `rtc.media-port`
- `storage.endpoint` (the entrypoint always sets `http://127.0.0.1:9000`; `Storage__Endpoint` from Compose is overwritten)
- `storage.bucket` (`RUSTFS_BUCKET`, default `stellarr-images`; `Storage__Bucket` from Compose is overwritten)

For nullable integrations, `value` is the stored preference (`null` means auto)
and `effectiveValue` is the current availability. For example, `giphy.enabled`
can be stored as `true` while `effectiveValue` is `false` until a GIPHY key is
set. `source` is `database` only when that field was explicitly stored; a null
nullable flag remains `default` even when the settings row exists.

Setting a startup key with `config set` fails with `read_only_setting` and tells
you the variable to change.

### Secrets

```sh
stellarr secrets list
printf '%s\n' "$SMTP_PASSWORD" |
  docker compose exec -T stellarr stellarr secrets set mail.smtp-password --stdin --yes
stellarr secrets clear mail.smtp-password
```

Secret names are `mail.smtp-password`, `mail.resend-api-key` and `giphy.api-key`.
Values are accepted only from `--stdin` or a hidden prompt. A positional value is
rejected because the shell would already have exposed it in process arguments
and history. `--stdin` cannot also answer a confirmation, so it requires
`--yes`.

The value is encrypted with the existing data-protection key ring in
`<data-root>/keys` and stored in the same `InstanceSecrets` table Cockpit uses. A
database value wins over the environment. `clear` removes the database override
and explains the environment fallback; it cannot guarantee that an integration
is disabled if its environment variable is still set. Neither `list`, errors,
JSON output nor the operator audit contains a secret value, hash, cookie or
token.

### Users and sessions

```sh
stellarr users list
stellarr users show arkazz
stellarr sessions list
stellarr sessions list --user arkazz
stellarr sessions revoke 4a85e7e0-bc1c-4e18-8ed2-191f1e8b0f21
stellarr sessions revoke --user arkazz --all
```

`users` and `sessions` lists are limited to 200 and 500 rows respectively. They
show administrative metadata only; password hashes, cookies and token values are
never read back.

Revocation updates the durable `UserSessions` rows, so the existing
authentication check rejects the cookie on its next request. The running API
checks the database for revoked sessions at most once per second and aborts the
matching WebSocket connections; their normal disconnect lifecycle closes any
voice or media session they held. Revoking all sessions of an account also marks
approved desktop browser handoffs that have not yet been redeemed, preventing
them from becoming new sessions.

### Account security and MFA recovery

```sh
stellarr security show arkazz
stellarr security methods arkazz
stellarr security recover arkazz --reason "lost authenticator"
```

`security show` reports the instance MFA requirement, confirmed and pending
methods, trusted devices, active sessions, unused recovery-code count and recent
account-global security events. `security methods` prints the same inspection
focused on method metadata. Neither command can read a TOTP seed, recovery-code
hash, cookie or trusted-device token.

`security recover` is the emergency path for an account that lost every second
factor. It revokes all MFA methods, trusted devices, active sessions, approved
desktop handoffs, unused recovery codes and earlier CLI recovery credentials,
then increments the account's session version so older cookies fail. In the
same transaction it issues one random recovery credential, prints it once and
records `security.recover` as `local-cli` in the operator audit. The credential
expires after `mfa.cli-recovery-minutes` (10 by default) and can be exchanged at
`POST /api/auth/recovery/redeem` only for enrollment-only access. It cannot
create an ordinary session, grant API or hub access, or disable an enforced MFA
policy. A disabled account stays disabled and is refused by this command.

Recovery sets a durable recovery-required state. Password, OIDC, registration
and desktop sign-in cannot issue a session or an ordinary enrollment grant while
it is set. Only the current CLI credential can start replacement enrollment, and
the state clears only after a replacement factor is confirmed. The credential is
stamped with the security version at issue: expiry, deletion, a password reset or
any other security-version change makes it stale, and an old credential never
silently adopts the newer version. A second reset therefore invalidates a
pending replacement flow from the first.

Verified addresses can receive an account security alert. That mail is sent only
when mailing is operational and the operator enabled `mail.alerts.enabled`; the
event itself and the in-app history are recorded regardless. The CLI records the
reset event and alert recipient in the same transaction as the recovery, before
the credential can expire.

The recovery credential is the only secret-like value the CLI prints, and it is
printed only when it is newly issued. Store it only long enough to complete
enrollment.

### Emergency use with a stopped instance

The CLI is the same published binary in the same image and needs no API. With
the instance stopped, run a one-off container on the same named volume:

```sh
docker compose stop stellarr
docker compose run --rm --no-deps --entrypoint stellarr stellarr status
docker compose run --rm --no-deps --entrypoint stellarr stellarr config list
docker compose start stellarr
```

For a raw image, mount the volume explicitly:

```sh
docker run --rm -it \
  -v stellarr-v2_stellarr_data:/data/stellarr \
  --entrypoint stellarr \
  ghcr.io/arkazzae/stellarr:latest doctor
```

Do not run two Stellarr containers that both serve the same volume. The one-off
command is a short CLI process, not a second instance.

## Confirmation, JSON and automation

A mutation shows its target and asks for confirmation. In a non-interactive
session, or with a closed stdin, it fails with `confirmation_required` instead of
waiting. `--yes` accepts the change for automation. Invalid arguments, a refused
confirmation and Ctrl+C leave no state changes. Mutations and their operator audit
entry are saved in one transaction, and SQLite lock conflicts produce a clear
`database_locked` error.

`--json` emits exactly one JSON document on stdout. Successful commands use:

```json
{
  "ok": true,
  "command": "config.set",
  "exitCode": 0,
  "data": { "key": "time-zone", "value": "Europe/Warsaw" },
  "warnings": []
}
```

Errors use a stable `error.code` and a non-zero exit status:

```json
{
  "ok": false,
  "command": "config.set",
  "exitCode": 2,
  "error": {
    "code": "invalid_value",
    "message": "This time zone is not available on the server.",
    "details": { "fields": { "timeZone": ["..."] } }
  }
}
```

Text diagnostics go to stderr. In JSON mode nothing but the document is written
to stdout, so `jq` and scripts can parse it safely.

### Exit statuses

| Status | Meaning |
| --- | --- |
| `0` | Success. `status`/`doctor` found no failure. |
| `1` | Unexpected failure, or `doctor` found a failed check. |
| `2` | Invalid usage or value, refused confirmation, or cancellation. |
| `3` | Not found: database, account, session or setting. |
| `4` | Conflict, read-only setting, busy database, or incompatible schema. |
| `5` | The database file could not be opened. |

Stable error codes include `usage`, `database_not_found`,
`database_locked`, `schema_incompatible`, `confirmation_required`,
`cancelled`, `invalid_value`, `read_only_setting`, `setting_not_found`,
`secret_not_found`, `secret_value_argument`, `user_not_found` and
`session_not_found`.

## Audit and safety

Every successful mutation adds an `OperatorAuditEntries` row with actor
`local-cli`, the operation (`config.set`, `secrets.set`, `secrets.clear`,
`sessions.revoke`, `sessions.revoke-all`, `security.recover`), its target and a
UTC timestamp. The row and the change commit together. The normal API startup
creates or upgrades that table; the CLI only verifies it and refuses to write
when it is missing.

Read commands leave instance settings, the database schema and key files
unchanged. The CLI opens an existing database and never initializes or migrates
one. Secret values are excluded from command output and audit records.

The available commands cover diagnostics, configuration, secrets, account
inspection, session revocation and emergency MFA recovery. Password resets, OIDC
linking, backup and restore, database repair and service control are not
available.
