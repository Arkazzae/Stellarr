# Quick start

This guide starts a local Stellarr instance on a single machine, creates the owner account, invites a second user, and tests voice chat between two browser profiles.

## Prerequisites

- Docker Engine with the Compose plugin (`docker compose version`). See [Requirements](requirements.md).
- Free host ports `8443`, `8888`, `3478`, `5349`, `49000`, and `49160-49200`. If a port is in use, override the corresponding variable in `.env` (see [Requirements](requirements.md#ports)).
- A second browser profile or private window to test a two-user call.

## 1. Download Compose and environment files

```bash
mkdir stellarr && cd stellarr
curl -fsSLO https://raw.githubusercontent.com/Arkazzae/Stellarr/main/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/Arkazzae/Stellarr/main/.env.example -o .env
```

All variables in `.env` have defaults suitable for local testing on `localhost`.

## 2. Start the container

```bash
docker compose up -d
```

Docker pulls `ghcr.io/arkazzae/stellarr`, creates the `stellarr-v2_stellarr_data` volume, and starts the `stellarr-v2` container. Verify that it is healthy:

```bash
docker compose ps
```

The container reports `healthy` once both `/health` (API) and `/login` (web client) respond over HTTPS. If startup fails, inspect `docker compose logs`.

## 3. Open the web client

Open `https://localhost:8443` in your browser.

On first start, the container generates a 365-day self-signed TLS certificate for `localhost`. Accept the browser's self-signed certificate warning to continue. For remote deployments, configure a trusted certificate as described in [Reverse proxy and TLS](reverse-proxy-and-tls.md).

## 4. Create the owner account

1. Select **Create account**.
2. Enter a display name, username (3–32 characters: letters, digits, `.`, `-`, `_`), email, and password (at least 8 characters).
3. Submit the form.

The first account registered on an empty instance becomes the instance owner and is placed in the default `Stellarr` server with `#general` and `voice` channels. Subsequent accounts require an invite link.

## 5. Invite a second user

1. In the channel list header, click **Invite to server** next to the server name.
2. Click **New invite link** to generate an invite URL:

   ```text
   https://localhost/invite/22b115a390a20370
   ```

3. If you are not running on port `443`, include your HTTPS port in the URL before sharing it (for example, `https://localhost:8443/invite/22b115a390a20370`).

> [!WARNING]
> Invite URLs are built from the `Host` header without the external port. When exposing HTTPS on a port other than `443`, append `:8443` (or your configured `STELLARR_HTTPS_PORT`) to the link.

## 6. Join and test voice

1. Open the invite link in a second browser profile or private window, accept the certificate warning, and register a second account.
2. In both browser windows, join the `voice` channel and grant microphone access.
3. Verify two-way audio and check the connection indicator (`Connected`) in the bottom-left status bar.

This test needs no further setup because both browsers run on the Docker host. Voice for a browser on any other device, including one in your local network, requires `PUBLIC_IP` and UDP port `49000` (`STELLARR_MEDIA_PORT`) forwarded to the host on the same external port. See [Requirements](requirements.md#behind-nat).

If voice remains stuck on connecting or fails across networks, follow the checklist in [RTC and ports](../RTC_AND_PORTS.md#diagnostics).

## Stop or remove

```bash
docker compose stop      # stop the container
docker compose down      # remove container and network, preserve data volume
```

> [!CAUTION]
> `docker compose down -v` permanently deletes the `stellarr-v2_stellarr_data` volume, including all accounts, messages, uploads, and secrets.

## Next steps

- **Operator panel**: Sign in with the owner account and open `https://localhost:8443/cockpit/`.
- [Requirements](requirements.md): `PUBLIC_IP` and router port forwarding, required for voice from any other device.
- [Reverse proxy and TLS](reverse-proxy-and-tls.md): trusted certificates and reverse proxy setup.
- [Configuration](configuration.md): environment variable reference.

## Build from source

To build the container image from a local checkout instead of pulling from GHCR:

```bash
git clone https://github.com/Arkazzae/Stellarr.git
cd Stellarr
docker compose up -d --build
```

The multi-stage `Dockerfile` compiles the .NET API, Next.js web client, Cockpit operator panel, and Rust media server inside Docker—no local toolchains are required on the host.
