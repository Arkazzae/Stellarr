# Stellarr Media

The selective forwarding unit of Stellarr, built as the `stellarr-media`
binary. [`docs/STELLARR_MEDIA.md`](../docs/STELLARR_MEDIA.md) is its contract:
the control API that `AppHub` calls, the media plane, the limits and the
configuration.

## Run

```bash
cargo run --release
```

It listens for media on UDP `0.0.0.0:49000` and serves the control API on
`127.0.0.1:5200`. The environment variables of the contract configure it:

| Variable | Default |
| --- | --- |
| `STELLARR_MEDIA_BIND` | `0.0.0.0:49000` |
| `STELLARR_MEDIA_PUBLIC_IP` | empty |
| `STELLARR_MEDIA_PUBLIC_PORT` | the port of `STELLARR_MEDIA_BIND` |
| `STELLARR_MEDIA_ADVERTISE` | empty |
| `STELLARR_MEDIA_CONTROL_BIND` | `127.0.0.1:5200` |
| `STELLARR_MEDIA_CONTROL_SECRET` | empty |
| `STELLARR_MEDIA_LOG` | `info` |

The process refuses to start with an empty secret when the control API is not
on a loopback address, and exits with a non-zero status when it cannot bind a
socket. SIGTERM and SIGINT stop it cleanly.

```bash
curl http://127.0.0.1:5200/v1/health
```

## Test

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

- `src/` holds the unit tests of the text helpers, the event log, the
  configuration and the sequence rewriting;
- `tests/core.rs` drives the core without a socket: rooms, the directory,
  negotiation, the limits and the timers, on a simulated clock;
- `tests/media.rs` connects str0m clients with full ICE, DTLS and SRTP to the
  core through an in-memory network and checks what is forwarded;
- `tests/http.rs` runs the process on ephemeral ports: every route of the
  control API, and two clients over a real UDP socket.

[`smoke/`](smoke/README.md) runs the release binary against headless
Chromium, playing the hub itself: what a browser does that a str0m client
cannot show, proven from `getStats()` and the decoded media.

```bash
cd smoke && npm ci && npm run smoke
```

## Layout

- `core/` is sans-IO: it owns every room, session and `Rtc`, reads no clock
  and touches no socket;
- `server.rs` runs one task that owns the core, the UDP socket and the timer,
  and the HTTP server next to it. HTTP handlers send that task jobs and await
  the reply;
- `http.rs` is the control API, `config.rs` the environment, `events.rs` the
  ordered event log, `sdp_text.rs` and `stun.rs` small readers of SDP and STUN.
