# Requirements

Stellarr runs as one Docker container. The host needs Docker, memory and disk
for that container and, for voice with people outside your own network, open
ports.

To try it on one machine, follow the [quick start](quick-start.md).

## Host

| Item | Requirement |
| --- | --- |
| Software | Docker Engine with the Compose plugin, which provides the `docker compose` command. Nothing else is installed on the host. |
| Architecture | `linux/amd64` or `linux/arm64`. The release workflow publishes the image for both. |
| Memory | The compose file caps the container at 4 GiB (`STELLARR_CONTAINER_MEMORY_LIMIT`). |
| CPU | The container may use 4 CPUs (`STELLARR_CONTAINER_CPUS`). |
| Processes | The container may run 512 processes (`STELLARR_CONTAINER_PIDS_LIMIT`). |
| Disk | The image, plus the data volume `stellarr_data`, which holds the database, uploaded files, keys, secrets and certificates. |

The compose file gives limits, not minimums. For orientation, an idle instance
with two accounts and no uploads used 280 MiB of memory, 0.3% of one CPU and 118
processes; the image took 1.1 GB on disk (`linux/amd64`) and the data volume
under 1 MB. These figures were measured on Docker 29.9.

Uploads count against two quotas and a free-space check: 2 GiB per account and
20 GiB for the whole instance, and an upload that would leave less than 1 GiB
free on the data volume is refused. [Configuration](configuration.md#uploads-and-quotas)
lists the settings.

## Ports

The compose file publishes all the ports below on the host. With the default
settings nothing listens on `3478/tcp` and `5349`, and a connection to them is
refused. The media server listens on `49000/udp` in both voice topologies, but
in the default one it receives no calls and drops whatever arrives.

| Default port | Protocol | Purpose | Needed | Setting |
| --- | --- | --- | --- | --- |
| `8443` | TCP | HTTPS: the web client, the API, the realtime connection and the operator panel | Always | `STELLARR_HTTPS_PORT` |
| `8888` | TCP | HTTP. Every request is answered with a redirect to HTTPS. | Only for people who type an `http://` address | `STELLARR_HTTP_PORT` |
| `3478` | UDP | STUN and TURN: finding a path between two browsers, and relaying audio when there is none | Voice | `STELLARR_TURN_PORT` |
| `49160-49200` | UDP | The 41 relay ports that TURN hands out | Voice | `STELLARR_TURN_RELAY_RANGE` |
| `3478` | TCP | TURN over TCP. Closed unless `STELLARR_TURN_TCP_ENABLED=true`. | Optional | `STELLARR_TURN_PORT` |
| `5349` | TCP and UDP | TURN over TLS. Closed unless `STELLARR_TURNS_ENABLED=true`, which needs a certificate that browsers trust. | Optional | `STELLARR_TURNS_PORT` |
| `49000` | UDP | Stellarr Media, the media server of the `sfu` voice topology. Every browser in a call sends its audio and video here once. | Voice, in the `sfu` topology only | `STELLARR_MEDIA_PORT` |

The database, the object store, the API and the web server listen only inside
the container and are not published. [RTC and ports](../RTC_AND_PORTS.md) covers
the relay range, TURN transports and the diagnostic order for voice problems.

## Behind NAT

When the host sits behind a router, people outside your network cannot reach its
private address. Two things make voice work for them:

1. Forward the ports marked "voice" on the router to the host. Add the HTTPS
   port, or put a [reverse proxy](reverse-proxy-and-tls.md#run-behind-a-reverse-proxy)
   in front.
2. Set `PUBLIC_IP` to the public IPv4 address, or to `auto` to look up the A
   record of `PUBLIC_HOST` on every start.

Without `PUBLIC_IP` the TURN server hands out its own address inside Docker. A
test allocation on a default instance returned the relay address
`172.20.0.2:49164`, which a browser on another network cannot reach.

In the `sfu` topology (`STELLARR_RTC_TOPOLOGY=sfu`) also forward `49000/udp`,
on the same external port as `STELLARR_MEDIA_PORT`. The media server advertises
`PUBLIC_IP` with that port, so without `PUBLIC_IP` only browsers that reach the
container's own address, or come through TURN, can join a call. [Stellarr
Media](../STELLARR_MEDIA.md) describes the topology and what it does not do yet.

## Name and certificate

`PUBLIC_HOST` is `localhost` by default, which works on the machine itself.
Everyone else needs a DNS name, or the host's IP address, that points at the
host. On the first start the container generates a self-signed certificate for
that name, and browsers show a warning for it.
[Reverse proxy and TLS](reverse-proxy-and-tls.md) replaces it with one that
browsers trust.

## Browser

Voice, camera and screen sharing use WebRTC. The page has to be loaded over
HTTPS, or from `localhost`, for the browser to offer the microphone.
