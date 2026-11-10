# Architecture

The binding, versioned media contract is described in
[`RTC_STANDARD.md`](./RTC_STANDARD.md).

```text
Browser
        |
        | HTTPS + WebSocket
        v
      Nginx :443
       |         \
       |          \__ Next.js :3000
       |           \__ operator panel, static files under /ops/
       |
       \__ ASP.NET Core :5000
              |       \
              |        \__ SignalR signaling / presence
              |
              +__ SQLite WAL
              |
              \__ RustFS S3 :9000

Browser <---- ICE / TURN ----> coturn :3478 / :5349 / relay UDP
Browser <---- WebRTC mesh ----> Browser
                  |
                  \__ planned Stellarr Media SFU :49000/udp
```

## Responsibilities

- Next.js owns the interface and the browser implementation of the versioned `VoiceClient`; the UI knows only its public contract.
- The operator panel (`ops/`) is a separate single-page build that Nginx serves under `/ops/`. It talks to the `/api/ops/` endpoints of the same API and needs the owner role.
- ASP.NET Core is the control plane: sessions, users, channels, public and direct messages, uploads, presence and signaling.
- Direct messages are persisted in SQLite and pushed as targeted SignalR events;
  the identifier of a two-person conversation can also serve as a private RTC room.
- SQLite holds the application state. Binary objects do not go into the database.
- RustFS holds uploaded files (images, audio, video and documents), but it is not a public CDN. The backend authorizes and streams the downloads.
- coturn solves NAT traversal. It implements neither room logic nor media routing.
- Stellarr Media is planned as the audio data plane: ICE-lite, DTLS, SRTP, RTP forwarding and quality telemetry.

## Why one container

The final image contains several processes but has one deployment cycle and one persistent volume. Supervisor keeps the processes running (RustFS, the API, the Next.js server, coturn, Nginx and the TLS certificate maintenance, see `infra/supervisord.conf`), and Nginx provides a single origin. This is a deliberate profile for a small private instance, not a horizontal scaling model.

If the instance grows, the first boundaries to separate should be the media plane and coturn. The frontend contract and the backend control plane stay unchanged.
