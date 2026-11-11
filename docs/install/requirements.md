# Requirements

Stellarr runs as a single Docker container. To test it locally on one machine, follow the [Quick start](quick-start.md).

## Host

| Resource | Requirement |
| --- | --- |
| Software | Docker Engine with the Compose plugin (`docker compose`) |
| Architecture | `linux/amd64` or `linux/arm64` |
| Memory limit | 4 GiB default cap (`STELLARR_CONTAINER_MEMORY_LIMIT`); idle baseline is ~280 MiB |
| CPU limit | 4 CPUs default cap (`STELLARR_CONTAINER_CPUS`) |
| Process limit | 512 processes (`STELLARR_CONTAINER_PIDS_LIMIT`) |
| Disk | ~1.1 GB for the image plus the `stellarr_data` volume (database, uploads, keys, secrets, and TLS certificates) |

Uploads are governed by two storage quotas and a free-space check: 2 GiB per account, 20 GiB total for the instance, and at least 1 GiB of free space remaining on the data volume. See [Configuration](configuration.md#uploads-and-quotas).

## Ports

`docker-compose.yml` publishes the ports below on the host. By default, `3478/tcp` and `5349` are disabled in `coturn`.

| Default port | Protocol | Purpose | Required for | Variable |
| --- | --- | --- | --- | --- |
| `8443` | TCP | HTTPS: web client, API, SignalR WebSocket, and Cockpit (`/cockpit/`) | Always | `STELLARR_HTTPS_PORT` |
| `8888` | TCP | HTTP redirect to HTTPS | HTTP redirect only | `STELLARR_HTTP_PORT` |
| `49000` | UDP | Stellarr Media, the media server every call goes through | Voice | `STELLARR_MEDIA_PORT` |
| `3478` | UDP | STUN and TURN (UDP) | Voice | `STELLARR_TURN_PORT` |
| `49160-49200` | UDP | TURN media relay range (41 ports) | Voice | `STELLARR_TURN_RELAY_RANGE` |
| `3478` | TCP | TURN over TCP (enabled with `STELLARR_TURN_TCP_ENABLED=true`) | Optional | `STELLARR_TURN_PORT` |
| `5349` | TCP, UDP | TURN over TLS/DTLS (enabled with `STELLARR_TURNS_ENABLED=true`; requires a trusted TLS certificate) | Optional | `STELLARR_TURNS_PORT` |

Internal services (SQLite, RustFS, ASP.NET Core, Next.js, and the media control API) listen only inside the container. See [RTC and ports](../RTC_AND_PORTS.md) for relay sizing and troubleshooting.

## Behind NAT

Every call goes through Stellarr Media, the media server inside the container. A browser on the Docker host itself reaches it without further setup. Voice for any other browser, including one on another device in your local network, requires:

1. `PUBLIC_IP` set to the IPv4 address browsers reach the host at, or to `auto` to resolve the `A` record of `STELLARR_DOMAIN` at container startup.
2. UDP `49000` (or `STELLARR_MEDIA_PORT`) forwarded to the Docker host on the same external port, because the media server advertises that port to browsers.
3. The other voice ports (`3478/udp` and `49160-49200/udp`) and the HTTPS port (or a [reverse proxy](reverse-proxy-and-tls.md#run-behind-a-reverse-proxy) in front) forwarded to the Docker host.

Without `PUBLIC_IP`, the media server advertises only the container's own address. A browser that is not on the host then reaches it only through TURN (`coturn`), and gets no connection when TURN is blocked too. The container logs a warning at startup in that case. See [Stellarr Media](../STELLARR_MEDIA.md) and [RTC and ports](../RTC_AND_PORTS.md#nat-and-firewall-configuration).

## Domain and TLS

When `STELLARR_DOMAIN` is unset, TLS and TURN fall back to `localhost`, which works on the host machine itself. Remote users require a DNS name or IP address pointing to the host. On first start, the container generates a self-signed certificate for that name. To configure a browser-trusted certificate, see [Reverse proxy and TLS](reverse-proxy-and-tls.md).

## Browser

WebRTC microphone, camera, and screen capture require a secure context (`https://` or `localhost`).
