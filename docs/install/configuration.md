# Configuration

Settings are environment variables that `docker-compose.yml` passes to the
container. Put them in a file named `.env` next to the compose file, starting
from `.env.example`. After a change, run `docker compose up -d`: Compose
recreates the container with the new values and keeps the data volume.

Settings marked **seed** only give the first value of a setting that the owner
can later change on the settings page of the operator panel, at `/ops/`. Once
the owner has saved that page, the saved value takes precedence over the
variable.

## Address and TLS

| Variable | Type | Default | Effect |
| --- | --- | --- | --- |
| `PUBLIC_HOST` | host name or IPv4 address | `localhost` | The name people use to reach the instance. It is the host in the TURN addresses that browsers receive, the TURN realm, and the name in the self-signed certificate. When it changes, the container generates a new self-signed certificate on the next start. A certificate signed by an authority is left alone. |
| `PUBLIC_IP` | IPv4 address or `auto` | empty | The public address that the TURN server advertises as its own. Set it when the host is behind NAT. `auto` looks up the A record of `PUBLIC_HOST` on every start. An invalid value, or `auto` without an A record, stops the container with an error. |
| `STELLARR_HTTPS_PORT` | port number | `8443` | Host port mapped to the HTTPS port of the container. It is also the port in the redirect from HTTP to HTTPS, and is left out of the address when it is `443`. A value outside 1-65535 stops the container. |
| `STELLARR_HTTP_PORT` | port number | `8888` | Host port mapped to the HTTP port of the container, which only redirects to HTTPS. The value goes into the port mapping as written, so `127.0.0.1:8888` publishes the port on the loopback interface only. |
| `STELLARR_PUBLIC_URL` | URL | empty | The address people use, for example `https://chat.example.com`. It is the **seed** of the Public URL in the operator settings, which password reset mail uses to build its link. It is also the origin that the instance reports to desktop clients in `/.well-known/stellarr/client`; when empty, the origin is taken from the request. A value that is not an absolute `http` or `https` origin without credentials, query or fragment makes that one endpoint answer 500. |
| `STELLARR_VERSION` | image tag | `latest` | The tag of `ghcr.io/arkazzae/stellarr` that the stack runs. Releases are tagged `1.2.3` and `1.2`; `latest` follows the newest stable release. Pin a release for a real installation. |

The container generates a self-signed certificate when
`/data/stellarr/tls/fullchain.pem` and `privkey.pem` are missing. To use your
own, see [Reverse proxy and TLS](reverse-proxy-and-tls.md).

## Voice

| Variable | Type | Default | Effect |
| --- | --- | --- | --- |
| `STELLARR_RTC_TOPOLOGY` | `mesh` or `sfu` | `mesh` | How the browsers of a call exchange media. `mesh` connects every browser to every other one. `sfu` sends each browser's media once to Stellarr Media, the media server in the container, which forwards it to the rest of the call; it needs `PUBLIC_IP` and `49000/udp` forwarded. An empty value means `mesh`; any other value stops the container. [Stellarr Media](../STELLARR_MEDIA.md) lists what `sfu` does not do yet. |
| `STELLARR_TURN_PORT` | port number | `3478` | Host port for STUN and TURN, TCP and UDP. Browsers are told to use this port. |
| `STELLARR_TURNS_PORT` | port number | `5349` | Host port for TURN over TLS, TCP and UDP. Browsers are told to use this port when `STELLARR_TURNS_ENABLED` is `true`. |
| `STELLARR_TURN_TCP_ENABLED` | `true` or `false` | `false` | Offers TURN over TCP besides UDP. When `false`, the TURN server does not listen on TCP and browsers are not given a TCP address. Any other value stops the container. |
| `STELLARR_TURNS_ENABLED` | `true` or `false` | `false` | Offers TURN over TLS. When `false`, the TURN server does not listen for TLS or DTLS. Turn it on only with a certificate that browsers trust. Any other value stops the container. |
| `STELLARR_MEDIA_PORT` | port number | `49000` | Host port for `49000/udp`, the media server's port. In the `sfu` topology browsers are told to use this port, so forward the same external port to it on the router. A value outside 1-65535 stops the container. |
| `STELLARR_TURN_RELAY_RANGE` | port range | `49160-49200` | Host ports published for the relay range `49160-49200/udp` of the container. Browsers are told the container's port numbers, so when you publish a different range, forward public ports `49160-49200` to it on the router. |

`PUBLIC_HOST` and `PUBLIC_IP` also belong to voice. [RTC and
ports](../RTC_AND_PORTS.md) explains what each port does.

## Uploads and quotas

Sizes are in bytes. A value of `0` or less turns a quota off, except where
noted.

| Variable | Type | Default | Effect |
| --- | --- | --- | --- |
| `STELLARR_UPLOAD_USER_BYTES` | bytes | `2147483648` (2 GiB) | What one account may keep stored. |
| `STELLARR_UPLOAD_TOTAL_BYTES` | bytes | `21474836480` (20 GiB) | What the whole instance may keep stored. |
| `STELLARR_MIN_FREE_BYTES` | bytes | `1073741824` (1 GiB) | Free space an upload has to leave on the data volume, which the database and logs share. `0` turns the check off. |
| `STELLARR_MAX_CONCURRENT_UPLOADS` | integer | `4` | Uploads handled at the same time. Values are kept between 1 and 32. |

Each file is also limited by type: images 10 MiB, audio 25 MiB, video 100 MiB
and other files 25 MiB. Nginx rejects a request body above 128 MiB.

## Mail

Stellarr sends password reset mail and delivery tests through the Resend HTTPS
API. Nothing is sent until a key is set. Reset mail also needs a public URL,
from `STELLARR_PUBLIC_URL` or the operator settings.

| Variable | Type | Default | Effect |
| --- | --- | --- | --- |
| `STELLARR_MAIL_ENABLED` | `true` or `false` | `true` | **Seed** of the mailing switch in the operator settings. |
| `STELLARR_RESEND_API_KEY` | string | empty | The Resend API key. It stays in the container's environment: the operator panel shows only whether a key is set. |
| `STELLARR_MAIL_FROM` | e-mail address | `onboarding@resend.dev` | **Seed** of the sender address. Use `onboarding@resend.dev` for tests and an address on a domain verified at Resend for real mail. |
| `STELLARR_MAIL_FROM_NAME` | string | `Stellarr` | The sender name shown next to the address. |

## Single sign-on

Sign-in through an OpenID Connect provider is optional, and password sign-in
stays available. The provider must be reachable over HTTPS and the client must
have a secret. The callback path is fixed at `/api/auth/oidc/callback`.

| Variable | Type | Default | Effect |
| --- | --- | --- | --- |
| `STELLARR_OIDC_ENABLED` | `true` or `false` | `false` | Turns single sign-on on. It also needs the issuer, the client id and a secret. |
| `STELLARR_OIDC_ISSUER` | HTTPS URL | empty | The issuer of the provider. |
| `STELLARR_OIDC_CLIENT_ID` | string | empty | The client id registered at the provider. |
| `STELLARR_OIDC_CLIENT_SECRET` | string | empty | The client secret. When set, it is used instead of the file below. |
| `STELLARR_OIDC_CLIENT_SECRET_FILE` | path in the container | empty | A file that holds the client secret, for deployments that mount secrets. |
| `STELLARR_OIDC_DISPLAY_NAME` | string | `Main account` | The label of the sign-in button. Any text works, for example `Konto główne` on a Polish installation. |

## Language

| Variable | Type | Default | Effect |
| --- | --- | --- | --- |
| `STELLARR_LANGUAGE` | `en` or `pl` | `en` | The language of the interface for everyone who has not chosen one, and of everything the server says: error messages, system messages, the names of the roles and channels of a new server, and mail. The web server reads it on every request. Text that was saved earlier keeps the language it was written in. The API stops at start-up on any other value, and the web client falls back to English. |

[Localization](../LOCALIZATION.md) describes how a person's own choice and the
instance default combine.

## Instance identity

| Variable | Type | Default | Effect |
| --- | --- | --- | --- |
| `STELLARR_INSTANCE_ID` | UUID | generated | The id by which clients recognise this instance. When empty, a UUID is generated on the first start and kept in `/data/stellarr/instance-id`. A value that is not a UUID makes `/.well-known/stellarr/client` answer 500. |
| `STELLARR_INSTANCE_NAME` | string | `Stellarr` | The instance name reported to clients before the first account exists. After that, the name of the server is reported. |
| `STELLARR_TIME_ZONE` | time zone id | `UTC` | **Seed** of the server time zone in the operator settings, for example `Europe/Warsaw`. |
| `STELLARR_DESKTOP_MINIMUM_VERSION` | version | `0.1.0` | The oldest desktop client that may sign in. Older ones are refused. The operator can save another value in the operator panel, which then wins. |
| `STELLARR_DESKTOP_RECOMMENDED_VERSION` | version | `0.1.3` | The desktop client version that the instance reports as recommended in the handshake. The operator can save another value, which then wins. |

## Other

| Variable | Type | Default | Effect |
| --- | --- | --- | --- |
| `GIPHY_API_KEY` | string | empty | The GIPHY web-integration key for the GIF search. GIPHY requires the browser to make the requests, so the API hands the key to signed-in clients. Changing it needs a restart of the container, not a rebuild. When you build the image from source, the same value is also passed as a build argument. |
| `STELLARR_EF_COMMAND_LOG_LEVEL` | .NET log level | `Warning` | The level of the log category that records every SQL command. `Information` logs each command. |

## Limits of the container

| Variable | Type | Default | Effect |
| --- | --- | --- | --- |
| `STELLARR_CONTAINER_MEMORY_LIMIT` | size | `4g` | Memory the container may use. |
| `STELLARR_CONTAINER_CPUS` | number | `4` | CPUs the container may use. |
| `STELLARR_CONTAINER_PIDS_LIMIT` | integer | `512` | Processes the container may run. |

## Read by the container, not set by the compose file

The entrypoint and the certificate script read the variables below. The compose
file does not pass them. To set one, add it under `environment:` in a
`docker-compose.override.yml`.

| Variable | Default | Effect |
| --- | --- | --- |
| `TLS_RENEW_BEFORE_SECONDS` | `2592000` (30 days) | The container renews a self-signed certificate when it expires within this time, or when it does not match `PUBLIC_HOST`. |
| `TLS_RENEW_CHECK_SECONDS` | `43200` (12 hours) | How often the container checks that certificate. |
| `STELLARR_MEDIA_ADVERTISE` | empty | A comma-separated list of `ip:port` that the media server advertises to browsers instead of `PUBLIC_IP` and the container's own address. |
| `STELLARR_MEDIA_LOG` | `info` | The media server's log filter, such as `info` or `stellarr_media=debug`. |
| `STELLARR_MEDIA_CONTROL_SECRET` | the stored secret | Replaces the secret that the API and the media server share. |

On the first start the container also creates the secrets that its object
store, its TURN server and its media server share with the API, and keeps them
in `/data/stellarr/secrets`. They are part of the data volume and have to be
restored with it.

## Development stack

`docker-compose.dev.yml` reads the variables below besides the ones above. Its
defaults differ in two places: `STELLARR_TIME_ZONE` is `Europe/Warsaw` and
`STELLARR_INSTANCE_NAME` is `Stellarr Dev`. It does not pass
`STELLARR_PUBLIC_URL` or the TURN, upload, single sign-on and container limit
settings.

| Variable | Default | Effect |
| --- | --- | --- |
| `STELLARR_DEV_WEB_PORT` | `3000` | Host port of the web client. |
| `STELLARR_DEV_OPS_PORT` | `3001` | Host port of the operator panel. |
| `STELLARR_DEV_API_PORT` | `5000` | Host port of the API. |
| `STELLARR_DEV_S3_PORT` | `9000` | Host port of the object store. |
| `STELLARR_DEV_MEDIA_PORT` | `49100` | Host port of the media server's `49000/udp`, which it advertises on `127.0.0.1`. It differs from production's port so the two stacks can run on one host. |
| `STELLARR_DEV_MEDIA_CONTROL_PORT` | `5200` | Host port of the media server's control API, published on the loopback interface only. |
| `STELLARR_ALLOWED_DEV_ORIGINS` | empty | Extra host names, comma-separated, that may load the development server's chunks. `127.0.0.1` is always allowed. |
| `STELLARR_API_ORIGIN` | `http://127.0.0.1:5000` | Where the development servers forward API requests: `next dev` sends `/api`, `/assets` and `/hubs` there, and the operator panel's dev server sends `/api` and `/health`. The development stack sets it to `http://api:5000` itself. |
| `WATCHPACK_POLLING` | `true` | Makes the web dev server poll for file changes, which a bind mount needs on some hosts. |
