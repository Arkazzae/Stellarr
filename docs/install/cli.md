# Operator CLI

`stellarr` is the operator CLI bundled inside the Stellarr container. It checks installation health, edits database-backed settings shared with Cockpit, manages encrypted secrets, inspects account security, and revokes sessions without signing in to Cockpit or starting a second API process.

It operates directly on the data volume rather than calling the HTTP API. Access control is therefore governed by container and volume access: anyone who can run `docker exec` or mount `/data/stellarr` already controls the instance. All CLI mutations record operator audit entries under the actor `local-cli`.

```sh
docker compose exec stellarr stellarr doctor
docker compose exec stellarr stellarr config list
docker compose exec stellarr stellarr config set time-zone Europe/Warsaw
docker compose exec stellarr stellarr sessions list --user arkazz
```

> [!NOTE]
> `help`, `--help`, and `version` do not open the database. Every other command opens the existing SQLite database and never creates or migrates it. If the database schema is older than the CLI, start the container normally once so the API runs its startup schema upgrade, then retry.

## Data root and container paths

The CLI resolves the data root in this order:

1. `--data-root <path>`
2. `STELLARR_DATA_ROOT`
3. the `DataRoot` configuration value
4. `/data/stellarr`

The database is `<data-root>/db/stellarr.db` and the data-protection keys live in `<data-root>/keys`. This is the same database, encryption key ring, and `Stellarr` application name used by the API, even when `docker exec` does not inherit environment exports created by the container entrypoint.

Read-only commands never create the keys directory, write a key file, or persist a new data-protection key. If every stored key has expired, decryption uses an in-memory XML snapshot so existing secrets remain readable without modifying the volume. The API's key ring must exist before `secrets set` can write a value that the running API can decrypt.

## Commands

### Status and diagnostics

```sh
stellarr status
stellarr doctor
```

`status` reports the database path and size, the instance name, account and active-session counts, and whether the local API responds at `http://127.0.0.1:5000/health/ready` (override with `STELLARR_API_URL`). It reports `healthy: true` and exits `0` only when the local API answers; an unreachable API or non-success health response sets `healthy: false` and exits `1` while still printing the database summary.

`doctor` checks the data root, database file and required schema, key directory, available disk space on the filesystem backing the data root, and the local API without modifying anything. On a stopped instance, an unreachable API is reported as a warning rather than a failure so `doctor` can be used during offline recovery. A missing database, incompatible schema, or missing required directory fails the check.

### Configuration

```sh
stellarr config list
stellarr config get time-zone
stellarr config set time-zone Europe/Warsaw
stellarr config validate
```

`config list` prints each setting's effective value, its source (`database`, `configuration`, `environment`, or `default`), whether it is editable, and whether a restart is required. `config set` updates the same database row Cockpit uses, so changes appear in Cockpit immediately. Validation shares the same rules as Cockpit: an invalid value is rejected before anything is written, and updating one key preserves all other keys.

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
| `mail.smtp.security` | `starttls`, `tls`, or `none` |
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

Booleans accept `true`/`false` (as well as `1`/`0`, `yes`/`no`, `on`/`off`).

`config validate` checks the stored configuration without saving and without sending test emails. It also warns when mail is enabled without a ready transport, or when an integration is enabled without its secret.

Startup settings are read-only. `config list` displays their current source and the environment variable to change. Update `.env` or `docker-compose.yml` and recreate the container; the CLI never edits host `.env` files. Read-only startup keys include:

- `public-url` (`STELLARR_PUBLIC_URL`, or `STELLARR_DOMAIN` and `STELLARR_PUBLIC_PORT`)
- `tls.domain` (`STELLARR_DOMAIN`)
- `https-port` (`PUBLIC_HTTPS_PORT`, normally set from host `STELLARR_HTTPS_PORT`; entrypoint default `443`)
- `oidc.enabled`, `oidc.authority`, `oidc.client-id`, `oidc.callback-path`
- `oidc.trust-provider-mfa`, `oidc.provider-mfa-amr`
- `oidc.providers` (the ids of the providers under `Oidc__Providers__<id>__*`, each marked when its second step is trusted; no secrets)
- `rtc.public-host`, `rtc.turn-port`, `rtc.turns-port`, `rtc.turns-enabled`, `rtc.turn-tcp-enabled`, `rtc.media-port`

For nullable integrations, `value` is the stored preference (`null` means automatic) and `effectiveValue` reflects current availability. For example, `giphy.enabled` can be stored as `true` while `effectiveValue` remains `false` until a GIPHY API key is configured. `source` is `database` only when that field was explicitly saved; a `null` flag stays `default` even when the settings row exists.

Attempting to modify a startup key with `config set` fails with `read_only_setting` and names the environment variable to update instead.

### Secrets

```sh
stellarr secrets list
printf '%s\n' "$SMTP_PASSWORD" |
  docker compose exec -T stellarr stellarr secrets set mail.smtp-password --stdin --yes
stellarr secrets clear mail.smtp-password
```

Supported secret keys are `mail.smtp-password`, `mail.resend-api-key`, and `giphy.api-key`.

> [!WARNING]
> Secret values are accepted only via `--stdin` or an interactive hidden prompt. Passing a secret as a positional command-line argument is rejected because it would expose the secret in process tables and shell history. When using `--stdin`, pass `--yes` as well since stdin cannot also answer a confirmation prompt.

Secrets are encrypted with the data-protection key ring in `<data-root>/keys` and stored in the `InstanceSecrets` table shared with Cockpit. Database secrets take precedence over environment variables. `clear` removes the database override and notes any environment fallback. Secret plaintext, password hashes, cookies, and tokens are never included in `list` output, errors, JSON responses, or audit logs.

### Users and sessions

```sh
stellarr users list
stellarr users show arkazz
stellarr sessions list
stellarr sessions list --user arkazz
stellarr sessions revoke 4a85e7e0-bc1c-4e18-8ed2-191f1e8b0f21
stellarr sessions revoke --user arkazz --all
```

`users` and `sessions` lists return up to 200 and 500 rows respectively and expose only administrative metadata.

Revoking a session updates the `UserSessions` table so the API rejects the session cookie on its next HTTP request. The running API checks for revoked sessions at most once per second and closes the matching WebSocket connections, which ends any voice or media session they held. Revoking all sessions for an account also invalidates any unredeemed desktop browser handoff tokens.

### Account security and MFA recovery

```sh
stellarr security show arkazz
stellarr security methods arkazz
stellarr security recover arkazz --reason "lost authenticator"
stellarr security unlink arkazz 3f2a6c1e-0b7d-4f5e-9a2c-8d1e4b6f7a90
```

`security show` reports the instance MFA requirement, confirmed and pending methods, trusted devices, active sessions, unused recovery-code count, the account's links to identity providers (each with its id, issuer and provider) and recent account-global security events. `security methods` prints the same inspection focused on method metadata. Neither command can read a TOTP seed, recovery-code hash, cookie or trusted-device token.

`security unlink` removes one of those links after a confirmation, so that identity no longer signs in to the account. It records `security.unlink` in the operator audit and a security event. Sessions already open stay open; end them with `sessions revoke` when the provider account was compromised. A recovery keeps the links, so check them while cleaning up an account.

`security recover` is the emergency path for an account that lost every second factor. It revokes all MFA methods, trusted devices, active sessions, approved desktop handoffs, unused recovery codes and earlier CLI recovery credentials, then increments the account's session version so older cookies fail. In the same transaction it issues one random recovery credential, prints it once and records `security.recover` as `local-cli` in the operator audit. The credential expires after `mfa.cli-recovery-minutes` (10 by default) and can be exchanged at `POST /api/auth/recovery/redeem` only for enrollment-only access. It cannot create an ordinary session, grant API or hub access, or disable an enforced MFA policy. A disabled account stays disabled and is refused by this command.

Recovery sets a durable recovery-required state. Password, passkey, OIDC, registration and desktop sign-in cannot issue a session or an ordinary enrollment grant while it is set. Only the current CLI credential can start replacement enrollment, and the state clears only after a replacement factor is confirmed. The credential is stamped with the security version at issue: expiry, deletion, a password reset or any other security-version change makes it stale, and an old credential never silently adopts the newer version. A second reset therefore invalidates a pending replacement flow from the first.

Verified addresses can receive an account security alert. That mail is sent only when mailing is operational and the operator enabled `mail.alerts.enabled`; the event itself and the in-app history are recorded regardless. The CLI records the reset event and alert recipient in the same transaction as the recovery, before the credential can expire.

The recovery credential is the only secret-like value the CLI prints, and it is printed only when it is newly issued. Store it only long enough to complete enrollment.

### Emergency use with a stopped instance

Because `stellarr` accesses the data volume directly without calling the API, you can run it in a one-off container while the instance is stopped:

```sh
docker compose stop stellarr
docker compose run --rm --no-deps --entrypoint stellarr stellarr status
docker compose run --rm --no-deps --entrypoint stellarr stellarr config list
docker compose start stellarr
```

Or directly with `docker run` against the named volume:

```sh
docker run --rm -it \
  -v stellarr_stellarr_data:/data/stellarr \
  --entrypoint stellarr \
  ghcr.io/arkazzae/stellarr:latest doctor
```

> [!CAUTION]
> Never run two full Stellarr server containers against the same `/data/stellarr` volume at the same time. Only use `--entrypoint stellarr` for short-lived CLI commands when running a second container against the volume.

## Confirmation, JSON, and automation

Mutating commands display their target and prompt for confirmation. In non-interactive sessions (or when stdin is closed), they fail with `confirmation_required` unless `--yes` is passed. Invalid arguments, declined prompts, and `Ctrl+C` leave the database untouched. Every mutation and its audit log entry are committed in a single SQLite transaction, and lock contention returns a `database_locked` error.

`--json` writes a single JSON document to stdout. Successful commands return:

```json
{
  "ok": true,
  "command": "config.set",
  "exitCode": 0,
  "data": { "key": "time-zone", "value": "Europe/Warsaw" },
  "warnings": []
}
```

Errors return a stable `error.code` and a non-zero exit status:

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

Human-readable diagnostics are written to stderr so stdout remains valid JSON for `jq` and scripts.

### Exit statuses

| Status | Meaning |
| --- | --- |
| `0` | Success (`status` and `doctor` found no failures). |
| `1` | Unexpected error, or `doctor` reported a failed check. |
| `2` | Invalid arguments or value, declined confirmation, or cancellation. |
| `3` | Not found: database, account, session, or setting. |
| `4` | Conflict, read-only setting, locked database, or incompatible schema. |
| `5` | The database file could not be opened. |

Error codes: `usage`, `database_not_found`, `database_locked`, `schema_incompatible`, `confirmation_required`, `cancelled`, `invalid_value`, `read_only_setting`, `setting_not_found`, `secret_not_found`, `secret_value_argument`, `user_not_found`, and `session_not_found`.

## Audit and safety

Every successful mutation inserts an `OperatorAuditEntries` row with actor `local-cli`, the operation name (`config.set`, `secrets.set`, `secrets.clear`, `sessions.revoke`, `sessions.revoke-all`, `security.unlink`, `security.recover`), its target, and a UTC timestamp in the same transaction as the change.

Read-only commands never modify settings, schema, or key files, and the CLI never creates or migrates a database. Secret values are left out of command output and audit records. Password resets, linking an identity provider, backup/restore, database repair, and service process supervision are not performed by the CLI.
