# Stellarr Media

Stellarr Media (`stellarr-media`) is Stellarr's Rust WebRTC Selective Forwarding Unit (SFU). Its full protocol and operational reference is in [`docs/stellarr-media.md`](../docs/stellarr-media.md).

## Running locally

```bash
cargo run --release
```

By default, `stellarr-media` binds its UDP media socket on `0.0.0.0:49000` and its HTTP control API on `127.0.0.1:5200`.

| Variable | Default | Description |
| --- | --- | --- |
| `STELLARR_MEDIA_BIND` | `0.0.0.0:49000` | UDP media socket bind address |
| `STELLARR_MEDIA_PUBLIC_IP` | empty | Public IPv4 address advertised in ICE host candidates |
| `STELLARR_MEDIA_PUBLIC_PORT` | port of `STELLARR_MEDIA_BIND` | Public UDP port advertised with `STELLARR_MEDIA_PUBLIC_IP` |
| `STELLARR_MEDIA_ADVERTISE` | empty | Comma-separated `ip:port` list overriding derived host candidates |
| `STELLARR_MEDIA_CONTROL_BIND` | `127.0.0.1:5200` | HTTP control API bind address |
| `STELLARR_MEDIA_CONTROL_SECRET` | empty | Bearer secret for the control API (required when not bound to loopback) |
| `STELLARR_MEDIA_LOG` | `info` | `tracing` filter (e.g. `info,stellarr_media=debug`) |

Health check:

```bash
curl http://127.0.0.1:5200/v1/health
```

## Testing

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

- `src/`: unit tests for SDP/STUN helpers, event ring buffer, configuration parsing, and RTP sequence/timestamp rewriting.
- `tests/core.rs`: deterministic sans-IO tests of room routing, track directory, SDP negotiation, limits, and timeouts on a simulated clock.
- `tests/media.rs`: in-memory ICE/DTLS/SRTP packet forwarding tests using `str0m` peer instances.
- `tests/http.rs`: end-to-end tests of the HTTP control API and UDP media forwarding over ephemeral sockets.

For browser interoperability tests against headless Chromium, see [`smoke/README.md`](smoke/README.md):

```bash
cd smoke && npm ci && npm run smoke
```

## Crate layout

- `src/core/`: sans-IO SFU state machine (rooms, sessions, `str0m::Rtc`, negotiation, and RTP forwarding). Performs no clock or socket I/O.
- `src/server.rs`: single async event loop driving `core`, the UDP socket, and timers alongside the Axum HTTP server.
- `src/http.rs`: control API routes and bearer authentication.
- `src/config.rs`: environment configuration parser.
- `src/events.rs`: bounded 4,096-event ring buffer and long-poll notifier.
- `src/sdp_text.rs`, `src/stun.rs`: SDP parameter and STUN packet utilities.
