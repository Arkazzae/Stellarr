# Architecture

The binding, versioned media contract is described in
[`RTC_STANDARD.md`](./RTC_STANDARD.md), and the `sfu` topology in
[`STELLARR_MEDIA.md`](./STELLARR_MEDIA.md).

```text
Browser
        |
        | HTTPS + WebSocket
        v
      Nginx :443
       |         \
       |          \__ Next.js :3000
       |           \__ Cockpit, the operator panel, static files under /cockpit/
       |
       \__ ASP.NET Core :5000
              |       \
              |        \__ SignalR signaling / presence
              |
              +__ SQLite WAL
              |
              +__ RustFS S3 :9000
              |
              \__ Stellarr Media control API 127.0.0.1:5200 (sfu only)

Browser <---- ICE / TURN ----> coturn :3478 / :5349 / relay UDP
                                  |
                                  \__ relays to Stellarr Media (sfu)

mesh (default)   Browser <---- WebRTC ----> Browser

sfu              Browser <---- WebRTC, :49000/udp ----> Stellarr Media
                                                          |
                                                          \__ forwards to every
                                                              other browser of
                                                              the room
```

## Responsibilities

- Next.js owns the interface and the browser implementation of the versioned `VoiceClient`; the UI knows only its public contract.
- Cockpit, the operator panel (`cockpit/`), is a separate single-page build that Nginx serves under `/cockpit/`. It talks to the `/api/cockpit/` endpoints of the same API and needs the owner role. The old address `/ops/` redirects to it.
- ASP.NET Core is the control plane: sessions, users, channels, public and direct messages, uploads, presence and signaling. In the `sfu` topology it is also the only authority over media sessions: it opens and closes them in the media server through its control API on every change of a seat, and relays the negotiation between the browser and the media server.
- Direct messages are persisted in SQLite and pushed as targeted SignalR events;
  the identifier of a two-person conversation can also serve as a private RTC room.
- SQLite holds the application state. Binary objects do not go into the database.
- RustFS holds uploaded files (images, audio, video and documents), but it is not a public CDN. The backend authorizes and streams the downloads.
- coturn solves NAT traversal. It implements neither room logic nor media routing. In the `sfu` topology it relays a browser that needs TURN to the media server's address inside the container.
- Stellarr Media (`media/`, Rust) is the data plane of the `sfu` topology: ICE-lite on one UDP port, DTLS, SRTP and the forwarding of microphone, camera and screen packets to the rest of the room, with RTCP feedback handled per connection. It trusts nothing but its control API, which listens on loopback and which only the API calls. It never decodes, mixes or transcodes media, but it does decrypt each connection to forward the packets, so media is readable in its memory, which the mesh never allowed. In exchange, every browser connects only to it, and browsers no longer learn each other's addresses. In the mesh topology, still the default, the process runs and stays idle.

## Why one container

The final image contains several processes but has one deployment cycle and one persistent volume. Supervisor keeps the processes running (RustFS, Stellarr Media, the API, the Next.js server, coturn, Nginx and the TLS certificate maintenance, see `infra/supervisord.conf`), and Nginx provides a single origin. This is a deliberate profile for a small private instance, not a horizontal scaling model.

If the instance grows, the first boundaries to separate should be the media plane and coturn. The frontend contract and the backend control plane stay unchanged.
