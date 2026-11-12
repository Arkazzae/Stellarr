# Configuration

`docker-compose.yml` configures the container through environment variables read from `.env` (copy `.env.example` to `.env` to start). Apply changes by running `docker compose up -d`. Settings stored in the database can also be inspected and changed with the [operator CLI](cli.md).

Variables marked **seed** initialize settings that the instance owner can later change in Cockpit (`/cockpit/`). Once saved in Cockpit, the database value takes precedence over the environment variable.

## Address and TLS

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `STELLARR_DOMAIN` | hostname or IP | empty | Primary hostname or IP used for the public origin, ICE/TURN server URLs, TURN realm, and self-signed TLS certificate SAN. When unset, TLS and TURN fall back to `localhost`, password-reset links stay disabled (unless `STELLARR_PUBLIC_URL` is set), and desktop clients use the origin they connected to. Changing `STELLARR_DOMAIN` triggers regeneration of a self-signed certificate on next start (CA-signed certificates are never overwritten). Falls back to `PUBLIC_HOST` if unset. |
| `STELLARR_PUBLIC_PORT` | port | `STELLARR_HTTPS_PORT` | External HTTPS port used by browsers (`STELLARR_HTTPS_PORT` when connecting directly, or `443` behind a [reverse proxy](reverse-proxy-and-tls.md#run-behind-a-reverse-proxy)). Omitted from the public URL when `443`. |
| `PUBLIC_IP` | IPv4 or `auto` | empty | IPv4 address browsers reach the host at, advertised by `coturn` (`external-ip`) and `stellarr-media`. Required for voice from any browser not on the Docker host itself; without it, such a browser connects only through TURN. `auto` resolves the `A` record of `STELLARR_DOMAIN` on startup and fails if no valid IPv4 is returned. |
| `STELLARR_HTTPS_PORT` | port (`1–65535`) | `8443` | Host port mapped to container port `443/tcp` and used in HTTP-to-HTTPS redirects. |
| `STELLARR_HTTP_PORT` | port or `ip:port` | `8888` | Host port mapped to container port `80/tcp` (HTTP redirect only). Prefix with an IP (e.g. `127.0.0.1:8888`) to bind to a single host interface. |
| `STELLARR_PUBLIC_URL` | origin URL | empty | Explicit public origin (e.g. `https://chat.example.com`), overriding the URL derived from `STELLARR_DOMAIN` and `STELLARR_PUBLIC_PORT`. Used in password-reset links, `/.well-known/stellarr/client` and as the site passkeys are created for (passkeys need an HTTPS origin with a host name). Displayed read-only in Cockpit. Must be an absolute `http` or `https` origin without credentials, query, or fragment. |
| `STELLARR_VERSION` | image tag | `latest` | Image tag for `ghcr.io/arkazzae/stellarr`. Pin a release tag (e.g. `1.2.3`) for production deployments. |

If `/data/stellarr/tls/fullchain.pem` or `privkey.pem` is missing, the container generates a self-signed certificate. See [Reverse proxy and TLS](reverse-proxy-and-tls.md).

## Voice and RTC

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `STELLARR_TURN_PORT` | port (`1–65535`) | `3478` | Published host port and advertised port for STUN and TURN (`udp` and `tcp`). |
| `STELLARR_TURNS_PORT` | port (`1–65535`) | `5349` | Published host port and advertised port for TURN over TLS (`STELLARR_TURNS_ENABLED=true`). |
| `STELLARR_TURN_TCP_ENABLED` | `true` \| `false` | `false` | Enables the TURN/TCP listener in `coturn` and advertises `?transport=tcp` ICE URLs. |
| `STELLARR_TURNS_ENABLED` | `true` \| `false` | `false` | Enables TURN over TLS/DTLS in `coturn` and advertises `turns:` ICE URLs. Requires a browser-trusted TLS certificate. |
| `STELLARR_MEDIA_PORT` | port (`1–65535`) | `49000` | Published host UDP port for [Stellarr Media](../STELLARR_MEDIA.md) (`49000/udp`), which carries every call. Advertised in ICE candidates and `/api/bootstrap`; must match the external router port. |
| `STELLARR_TURN_RELAY_RANGE` | port range | `49160-49200` | Host UDP ports mapped to container ports `49160-49200/udp` for TURN allocations. |

See [RTC and ports](../RTC_AND_PORTS.md) for port sizing and NAT rules.

## Uploads and quotas

Byte limits accept `0` (or negative values) to disable the quota.

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `STELLARR_UPLOAD_USER_BYTES` | bytes | `2147483648` (2 GiB) | Per-account storage quota. |
| `STELLARR_UPLOAD_TOTAL_BYTES` | bytes | `21474836480` (20 GiB) | Instance-wide storage quota. |
| `STELLARR_MIN_FREE_BYTES` | bytes | `1073741824` (1 GiB) | Minimum free disk space required on `/data/stellarr` to accept an upload (`0` disables the check). |
| `STELLARR_MAX_CONCURRENT_UPLOADS` | integer (`1–32`) | `4` | Maximum concurrent uploads across the instance. |

Per-file limits by media type: images 10 MiB, audio 25 MiB, documents/other 25 MiB, video 100 MiB. Nginx enforces a 128 MiB maximum request body size.

## Mail

Password-reset, invitation and test emails go through an SMTP server by default. Its host, port, encryption (STARTTLS, TLS or none) and login are set in Cockpit under **Settings**. Resend's HTTPS API can replace SMTP: turn it on under **Integrations**. An installation that never chose keeps sending through Resend while it has a Resend key and no SMTP host, as it did before SMTP existed.

The SMTP password and the Resend key can be set in Cockpit or in the environment. A value set in Cockpit is stored encrypted with the instance's data-protection keys and takes precedence; removing it there falls back to the environment's. Cockpit never shows a secret again, only whether it is set and where from.

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `STELLARR_MAIL_ENABLED` | `true` \| `false` | `true` | **Seed** for the mailing toggle in Cockpit settings. |
| `STELLARR_SMTP_PASSWORD` | string | empty | SMTP password, used when Cockpit holds none. |
| `STELLARR_RESEND_API_KEY` | string | empty | Resend API key, used when Cockpit holds none. |
| `STELLARR_MAIL_FROM` | email | empty | **Seed** for the sender address. `onboarding@resend.dev` works only through Resend, for testing. |
| `STELLARR_MAIL_FROM_NAME` | string | `Stellarr` | Sender display name. |

## Single sign-on (OIDC)

OpenID Connect login is optional; local username/password login remains available. The callback URL is `<public-url>/api/auth/oidc/callback`.

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `STELLARR_OIDC_ENABLED` | `true` \| `false` | `false` | Enables OIDC login (requires issuer, client ID, and client secret). |
| `STELLARR_OIDC_ISSUER` | HTTPS URL | empty | OIDC provider issuer URL. |
| `STELLARR_OIDC_CLIENT_ID` | string | empty | OIDC client ID. |
| `STELLARR_OIDC_CLIENT_SECRET` | string | empty | OIDC client secret (takes precedence over `STELLARR_OIDC_CLIENT_SECRET_FILE`). |
| `STELLARR_OIDC_CLIENT_SECRET_FILE` | container path | empty | Path to a mounted file containing the OIDC client secret. |
| `STELLARR_OIDC_DISPLAY_NAME` | string | `Main account` | Sign-in button label on the login screen. |
| `STELLARR_OIDC_TRUST_PROVIDER_MFA` | `true` \| `false` | `false` | Counts a sign-in the provider confirmed with more than a password as the instance's second step (see below). |
| `STELLARR_OIDC_PROVIDER_MFA_AMR` | comma-separated list | `mfa` | The `amr` values in the provider's ID token that mean it asked for more than a password. |

### More than one provider

Further providers are added in the `environment` of the `stellarr` service, each
under an id of 1 to 32 lower-case letters, digits or hyphens (not `default`,
`login` or `callback`). Each gets its own button and the callback
`<public-url>/api/auth/oidc/<id>/callback`. The provider above keeps its
callback and is offered first.

```yaml
      Oidc__Providers__work__DisplayName: Work account
      Oidc__Providers__work__Authority: https://id.example.com/realms/work
      Oidc__Providers__work__ClientId: stellarr
      Oidc__Providers__work__ClientSecretFile: /run/secrets/oidc-work
      # Optional, off by default:
      Oidc__Providers__work__TrustProviderMfa: "true"
      Oidc__Providers__work__ProviderMfaAmr: mfa,hwk
```

A provider is offered only when its issuer is HTTPS and it has a client ID and
a secret; an id that breaks the rules stops the server at start. People link
their accounts to a provider from their settings (see
[Account security](account-security.md#signing-in-through-an-identity-provider)),
which uses the same callback. An identity is linked to an account per issuer:
the same subject at two providers is two different people, and no account is
ever matched by its email address.

### The provider's own second step

By default the provider only proves who someone is, and the instance asks for
its own second step after it, as after a password (see
[Account security](account-security.md)). With `TrustProviderMfa` on, a
sign-in whose ID token lists one of the configured `amr` values counts as the
second step, Cockpit included. Such a provider is asked with `max_age=300` to
sign the person in again when its own session is older than five minutes, and
the token's `auth_time` must show a sign-in from the last five minutes; a
token without it falls back to the instance's own step. Turn it on only for a
provider that really requires a second factor and reports it in `amr`.

## Language

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `STELLARR_LANGUAGE` | `en` \| `pl` | `en` | Default interface locale for users without a saved preference, and the language used by the API for error messages, system messages, default server/role/channel names, audit entries, and emails. Stored records keep the language in which they were created. Unknown values abort API startup. |

See [Localization](../LOCALIZATION.md).

## Instance identity and desktop handshake

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `STELLARR_INSTANCE_ID` | UUID | generated | Persistent instance UUID reported at `/.well-known/stellarr/client`. Generated on first start and stored in `/data/stellarr/instance-id` when unset. |
| `STELLARR_INSTANCE_NAME` | string | `Stellarr` | Instance name reported before the first server is created (afterward, the primary server's name is used; editable in Cockpit). |
| `STELLARR_TIME_ZONE` | IANA time zone | `UTC` | **Seed** for the instance time zone in Cockpit settings (e.g. `Europe/Warsaw`). |
| `STELLARR_DESKTOP_MINIMUM_VERSION` | semver | `0.1.0` | Minimum allowed desktop client version; older clients are rejected by the client gate. |
| `STELLARR_DESKTOP_RECOMMENDED_VERSION` | semver | `0.1.3` | Recommended desktop client version advertised in `/.well-known/stellarr/client`. |

## Other settings

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `GIPHY_API_KEY` | string | empty | GIPHY web-integration key for the GIF search, handed to signed-in browser clients. It can also be set in Cockpit under **Integrations**, which takes precedence, checks the key against GIPHY and turns GIFs on or off. Changes reach open tabs when they reload; no restart is needed. When building from source, the same value is passed as a build argument and is used only while the API cannot be asked. |
| `STELLARR_EF_COMMAND_LOG_LEVEL` | .NET log level | `Warning` | Log level for `Microsoft.EntityFrameworkCore.Database.Command` (`Information` logs SQL queries). |

## Container resource limits

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `STELLARR_CONTAINER_MEMORY_LIMIT` | size | `4g` | Container memory limit (`mem_limit`). |
| `STELLARR_CONTAINER_CPUS` | number | `4` | Container CPU quota (`cpus`). |
| `STELLARR_CONTAINER_PIDS_LIMIT` | integer | `512` | Container process limit (`pids_limit`). |

## Advanced container environment variables

The container entrypoint and TLS maintenance scripts read the following variables directly. They are not defined in `docker-compose.yml`; set them via `docker-compose.override.yml` when needed.

| Variable | Default | Description |
| --- | --- | --- |
| `STELLARR_DATA_ROOT` | `/data/stellarr` | Root directory for persistent state inside the container. |
| `TLS_RENEW_BEFORE_SECONDS` | `2592000` (30 days) | Renew managed self-signed certificates when remaining validity falls below this threshold or when `STELLARR_DOMAIN` changes. |
| `TLS_RENEW_CHECK_SECONDS` | `43200` (12 hours) | Interval between self-signed certificate renewal checks. |
| `STELLARR_MEDIA_ADVERTISE` | empty | Comma-separated `ip:port` list overriding the derived `stellarr-media` ICE host candidates. |
| `STELLARR_MEDIA_LOG` | `info` | `tracing` filter for `stellarr-media` (e.g. `info,stellarr_media=debug`). |
| `STELLARR_MEDIA_CONTROL_SECRET` | `/data/stellarr/secrets/media-control-secret` | Overrides the shared bearer secret between the API and `stellarr-media`. |
| `TURN_SHARED_SECRET` | `/data/stellarr/secrets/turn-shared-secret` | Overrides the shared HMAC secret between the API and `coturn`. |
| `RUSTFS_SECRET_KEY` | `/data/stellarr/secrets/rustfs-secret` | Overrides the shared S3 secret key between the API and RustFS. |
| `RUSTFS_ACCESS_KEY` | `stellarr` | S3 access key for RustFS. |
| `RUSTFS_BUCKET` | `stellarr-images` | S3 bucket name in RustFS. |

On first start, generated secrets are written to `/data/stellarr/secrets/` and must be backed up with the data volume.

## Development stack (`docker-compose.dev.yml`)

`docker-compose.dev.yml` runs each service from bind mounts with live reload (`STELLARR_TIME_ZONE` defaults to `Europe/Warsaw`, `STELLARR_INSTANCE_NAME` to `Stellarr Dev`, and `PUBLIC_HOST` sets `Rtc__PublicHost`).

| Variable | Default | Description |
| --- | --- | --- |
| `STELLARR_DEV_WEB_PORT` | `3000` | Host port for Next.js (`next dev`). |
| `STELLARR_DEV_COCKPIT_PORT` | `3001` | Host port for Cockpit (`vite`). |
| `STELLARR_DEV_API_PORT` | `5000` | Host port for the ASP.NET Core API (`dotnet watch`). |
| `STELLARR_DEV_S3_PORT` | `9000` | Host port for RustFS. |
| `STELLARR_DEV_MEDIA_PORT` | `49100` | Host UDP port for `stellarr-media` (advertised on `127.0.0.1`). |
| `STELLARR_DEV_MEDIA_CONTROL_PORT` | `5200` | Host loopback TCP port (`127.0.0.1:5200`) for the `stellarr-media` control API. |
| `STELLARR_ALLOWED_DEV_ORIGINS` | empty | Comma-separated hostnames allowed to load Next.js dev chunks (`127.0.0.1` is always allowed). |
| `STELLARR_API_ORIGIN` | `http://127.0.0.1:5000` | Upstream API origin proxied by the web (`/api`, `/assets`, `/hubs`) and Cockpit (`/api`, `/health`) dev servers (`http://api:5000` inside `docker-compose.dev.yml`). |
| `WATCHPACK_POLLING` | `true` | Enables file-system polling in `next dev` for bind mounts. |
