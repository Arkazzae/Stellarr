# Architecture

The versioned WebRTC contract is specified in [`RTC_STANDARD.md`](./RTC_STANDARD.md), and Stellarr Media, the media server every call goes through, in [`STELLARR_MEDIA.md`](./STELLARR_MEDIA.md).

```text
Browser
  |
  | HTTPS + WebSocket
  v
Nginx :443
  |-- Next.js :3000 (web client)
  |-- Cockpit (/cockpit/, static operator SPA)
  `-- ASP.NET Core :5000
        |-- SignalR (/hubs/app: signaling & presence)
        |-- SQLite WAL (/data/stellarr/db/stellarr.db)
        |-- RustFS S3 :9000 (/data/stellarr/objects)
        `-- Stellarr Media control API 127.0.0.1:5200

Browser <---- ICE / STUN / TURN ----> coturn :3478 / :5349 / 49160-49200/udp
                                        |
                                        `-- relays to Stellarr Media

Browser <---- WebRTC :49000/udp ----> Stellarr Media
                                        |
                                        `-- forwards RTP to the other browsers in the room
```

## Component responsibilities

- **Next.js (`web/`)**: Serves the web interface and implements the browser-side `VoiceClient`. UI components interact exclusively with the public `VoiceClient` and `VoiceState` contract.
- **Stellarr Cockpit (`cockpit/`)**: Standalone single-page operator panel served by Nginx under `/cockpit/` (`/ops/` redirects with `308`). Calls `/api/cockpit/*` and requires the built-in instance owner role.
- **ASP.NET Core (`server/Stellarr.Api`)**: Control plane handling authentication, sessions, servers, channels, public and direct messages, uploads, presence, and SignalR signaling. It also manages media session lifecycles via the `stellarr-media` loopback control API and brokers SDP/ICE signaling between browsers and the media server.
- **Operator CLI (`server/Stellarr.Cli`)**: The `stellarr` command in the same container image. It diagnoses the instance and manages settings, encrypted secrets and sessions directly against the existing data volume, without starting another API. It shares settings validation and secret storage with Cockpit. See [Operator CLI](./install/cli.md) for commands and offline recovery.
- **SQLite**: Stores relational application state in WAL mode. Binary attachments are never stored in SQLite.
- **RustFS**: S3-compatible object store on loopback (`127.0.0.1:9000`) holding uploaded images, audio, video, and documents. Clients never access RustFS directly; the API authorizes and streams all downloads.
- **coturn**: Provides STUN and HMAC-authenticated TURN relay. It contains no room or application logic. TURN allocations relay media to the container's local `stellarr-media` UDP socket.
- **Stellarr Media (`media/`, Rust)**: Selective Forwarding Unit (SFU) that carries all call media; browsers never send media to each other directly. Runs ICE-lite on a single UDP port (`49000/udp`), terminates DTLS/SRTP per client, and forwards microphone, camera, and screen-share RTP packets without transcoding or mixing, while handling RTCP feedback (NACK, RTX, TWCC, PLI/FIR) per leg. Because SRTP ends at the media server, call media is decrypted in its memory and is not end-to-end encrypted between browsers. Controlled exclusively by the API over `127.0.0.1:5200`.

## Single-container deployment model

All runtime services—RustFS, Stellarr Media, ASP.NET Core, Next.js, `coturn`, Nginx, and `stellarr-tls-maintenance`—are supervised by `supervisord` (`infra/supervisord.conf`) inside a single container image backed by one persistent volume (`/data/stellarr`). Nginx provides a single HTTP/HTTPS origin on the outside.

This packaging targets private self-hosted instances with a single deployment lifecycle and backup volume. If scaling beyond a single host is required, the media plane (`stellarr-media`) and `coturn` are already decoupled at the protocol boundary and can be separated without changing the browser or API contracts.
