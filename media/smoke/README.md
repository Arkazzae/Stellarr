# Stellarr Media smoke test

End-to-end browser test suite that runs the `stellarr-media` release binary against headless Chromium instances to verify WebRTC negotiation, codec selection, RTCP feedback, and media forwarding as specified in [`docs/STELLARR_MEDIA.md`](../../docs/STELLARR_MEDIA.md).

## Running

Requires Node.js 20+ and a local Chromium or Chrome binary.

```bash
cd media/smoke
npm ci
npm run smoke          # build release binary and run all scenarios
node smoke.mjs a e     # run specific scenarios against an existing binary
```

| Variable | Default | Description |
| --- | --- | --- |
| `STELLARR_SMOKE_BROWSER` | `/usr/bin/chromium` or `/usr/bin/google-chrome-stable` | Path to Chromium/Chrome executable |
| `STELLARR_SMOKE_OUT` | new directory under system temp | Output directory for logs, SDP dumps, and `results.json` |
| `STELLARR_SMOKE_ADVERTISE` | `127.0.0.1` | Candidate IP advertised by `stellarr-media` |
| `STELLARR_MEDIA_BINARY` | `../target/release/stellarr-media` | Path to `stellarr-media` binary |
| `STELLARR_MEDIA_LOG` | `info,stellarr_media=debug` | `tracing` filter for the media server |

Each scenario prints `PASS` or `FAIL` with the verified metrics and writes `stellarr-media.log`, `results.json`, and per-participant SDP logs (`<scenario>-<participant>-descriptions.json`) to `STELLARR_SMOKE_OUT`.

## Architecture

- `smoke.mjs` acts as the signaling hub: it spawns `stellarr-media` on ephemeral loopback ports, creates/deletes sessions via the HTTP control API, relays browser offers/answers/candidates, and long-polls `/v1/events` (optionally delaying events to stage glare collisions).
- `page/client.js` implements the SFU client contract: a single `RTCPeerConnection` (`max-bundle`), `sendonly` transceivers for published tracks, impolite glare handling, and track attribution via the server directory.
- Each simulated participant runs in an isolated Chromium instance with a distinct synthetic audio frequency and video color (`lib/fixtures.mjs`). Receivers verify both `RTCPeerConnection.getStats()` counters (`packetsReceived`, `framesDecoded`, `packetsSent`, keyframes, NACKs, RTX, candidate pairs) and the decoded audio frequencies and video frame colors against the track directory.

## Scenarios

| ID | Verified behavior |
| --- | --- |
| `a` | Two-way audio forwarding without self-echo; audio-level RTP header extension delivery |
| `b` | Immediate PLI keyframe request when a new participant joins an already-running camera stream |
| `c` | Late third participant receives all four existing tracks attributed to the right `userId`, with directory delivered before `ontrack` |
| `d` | Leaving participant's forwarded m-lines transition to `inactive` and are removed from the directory |
| `e` | Offer glare collision: browser ignores pending server offer, server rolls back and re-offers after answering browser |
| `f` | Track swap (`replaceTrack` + `setStreams`) emits a `tracks` directory update without SDP renegotiation |
| `g` | Selected ICE candidate pairs terminate at `stellarr-media` |
| `h` | Demonstrates why `addTrack` is disallowed (`addTrack` attaches to a server-created m-line and is answered `recvonly`/`inactive`) |
| `i` | VP9, H.264, AV1, and VP9 temporal layers negotiate and decode across mismatched payload-type numbering |
| `j` | Publisher Opus `a=fmtp` parameters (128 kb/s mono mic, 160 kb/s stereo screen audio) are echoed and applied by the encoder |
| `k` | Toggling camera off/on (`removeTrack` or `transceiver.stop()`) allocates a fresh forwarded m-line |
| `l` | 50-second continuous call remains connected past all internal inactivity timers |
| `m` | Receive-only participant (`recvonly` initial offer) receives all published tracks |
| `n` | Simulated NAT with 1-in-15 packet loss in both directions recovers via per-leg NACK and RTX |
| `o` | Unanswered server offers time out after 10 s and close the unresponsive session with `error` after 3 strikes without affecting other peers |
