# Platforms

Stellarr runs as one container. The [Quick start](quick-start.md) starts it with Docker Compose and [`docker-compose.yml`](../../docker-compose.yml). A platform with its own app format starts the same container from a template in [`deploy/`](../../deploy/README.md).

| Platform | Starts from | Guide |
| --- | --- | --- |
| Docker Compose | [`docker-compose.yml`](../../docker-compose.yml) | [Quick start](quick-start.md) |
| Unraid | [`deploy/unraid/stellarr.xml`](../../deploy/unraid/stellarr.xml) | [Unraid](unraid.md) |

The rest of this page is what any installation gives the container. Compose does all of it already. A template does it too, and the platform guides say which of its fields to fill in.

## Image and data

- The image is `ghcr.io/arkazzae/stellarr:latest`, the newest stable release, or a version tag such as `1.2` to stay on one release line.
- One persistent folder or volume is mounted at `/data/stellarr`. It holds the database, uploaded files, the data-protection keys, the generated secrets and the TLS certificates. Back it up whole, with the container stopped: the secrets stored in the database can be read only with the keys next to it. See [Upgrading](upgrading.md).

## Address

- `STELLARR_DOMAIN` is the name or IPv4 address people open Stellarr at, for example `chat.example.com`, or `192.168.1.10` on a home network. The self-signed certificate and TURN use it. When it is empty they use `localhost`, which only a browser on the same machine can reach.
- `PUBLIC_IP` is the IPv4 address browsers reach the host at: its LAN address when everybody is on your network, your public address for friends over the internet, or `auto` to resolve the domain. Without it, voice from any other device works only through TURN. See [Requirements](requirements.md#behind-nat).

## Ports and the variables that name them

The container cannot see which host ports were mapped to it, and it tells browsers which ports to use. Each of these variables names the host side of its port mapping, so a changed host port means a changed variable:

| Purpose | Container port | Default host port | Container variable | Compose variable |
| --- | --- | --- | --- | --- |
| HTTPS | `443/tcp` | `8443` | `PUBLIC_HTTPS_PORT` | `STELLARR_HTTPS_PORT` |
| Voice media | `49000/udp` | `49000` | `Rtc__MediaPort` | `STELLARR_MEDIA_PORT` |
| TURN | `3478/udp`, `3478/tcp` | `3478` | `Rtc__TurnPort` | `STELLARR_TURN_PORT` |
| TURNS | `5349/tcp`, `5349/udp` | `5349` | `Rtc__TurnsPort` | `STELLARR_TURNS_PORT` |

Compose sets both sides from one variable. The HTTP redirect (`80/tcp`, host `8888`) needs no variable. The TURN relay range `49160-49200/udp` must use the same numbers on the host as in the container. [Requirements](requirements.md#ports) describes what each port is for.

## Language

`STELLARR_LANGUAGE` is the web client's default language, and `Stellarr__Language` is the language of server messages, mail, and the roles and channels of a new server. Compose fills both from one value. Anywhere else, set both to the same value, `en` or `pl`.

## Other settings

Every other setting is optional. A template uses the name the container reads, which `docker-compose.yml` shows next to each Compose variable: `STELLARR_SMTP_PASSWORD` in `.env` reaches the container as `Mail__SmtpPassword`, for example. [Configuration](configuration.md) describes them.

Without `Operations__TimeZone`, the instance time zone starts from the container's `TZ`, or UTC when that is unset. It can be changed later in Cockpit.

Compose limits the container to 4 GB of memory, 4 CPUs and 512 processes, and sets `no-new-privileges`. See [Container resource limits](configuration.md#container-resource-limits).
