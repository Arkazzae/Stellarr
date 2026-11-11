# Stellarr Media smoke test

The crate's own tests put str0m on both ends of every connection, which
cannot show how a browser behaves. This harness runs the release binary
against headless Chromium and checks every behaviour of
[`docs/STELLARR_MEDIA.md`](../../docs/STELLARR_MEDIA.md) that depends on the
browser.

## Run

```bash
cd media/smoke
npm ci
npm run smoke          # builds the release binary, then runs every scenario
node smoke.mjs a e     # only some scenarios, against the binary already built
```

It needs Node 20 or newer and a Chromium on the machine; nothing is
downloaded. It takes about two and a half minutes.

| Variable | Default | Meaning |
| --- | --- | --- |
| `STELLARR_SMOKE_BROWSER` | `/usr/bin/chromium`, else `/usr/bin/google-chrome-stable` | the browser |
| `STELLARR_SMOKE_OUT` | a new directory under the system temp directory | where the log, the descriptions and the results go |
| `STELLARR_SMOKE_ADVERTISE` | `127.0.0.1` | the address the media server advertises; anything else binds it to `0.0.0.0` |
| `STELLARR_MEDIA_BINARY` | `../target/release/stellarr-media` | the binary under test |
| `STELLARR_MEDIA_LOG` | `info,stellarr_media=debug` | its log filter |

Each scenario prints one `PASS` or `FAIL` line with the numbers it checked, and
the script exits non-zero when any failed. The output directory keeps
`stellarr-media.log`, `results.json`, and for every page every description it
sent and received (`<scenario>-<person>-descriptions.json`).

The script stops everything it starts, also when it is interrupted: the media
servers, the browsers and the page server.

## How it works

`smoke.mjs` plays `AppHub`. It starts the binary on spare loopback ports with
a random control secret, creates and deletes sessions on the control API,
posts every signal of a page in the order the page sent it, and long-polls
`/v1/events` and hands each event to the page of its session, in log order.
It can hold a session's events back to stage a collision.

`page/client.js` is the smallest client that keeps the "Client rules" of the
contract: one `RTCPeerConnection` with `max-bundle` and no ICE servers, the
browser offers what it publishes (`addTransceiver(track, { direction:
"sendonly", streams })`), it ignores a media server offer while an offer of
its own is being made or is unanswered, and every arriving track is filed
under the person the directory names. Person A also rewrites the Opus
parameters of its descriptions as the mesh client does.

Every person runs in a Chromium of their own, whose fake microphone plays a
tone of their own and whose fake camera shows a colour of their own
(`lib/fixtures.mjs`). A receiver measures the tone and the colour of every
section it receives, so the directory is checked against the media itself.

No claim rests on a connection state. Media is proven by `getStats()`:
`packetsReceived` and `framesDecoded` advancing per mid, `packetsSent` of what
a page publishes, keyframes, NACKs, retransmissions, the selected candidate
pair.

## Scenarios

| | What it proves |
| --- | --- |
| a | two people hear each other's microphone and nothing of their own; the audio level header extension arrives |
| b | a camera that has run alone for seconds is decoded by a newcomer within a second: the media server asked the publisher for a keyframe |
| c | a third person who joins late receives all four tracks, each under the right account, with the directory in hand before `ontrack` |
| d | when a person leaves, the others' sections go inactive and the directory shrinks; a later browser offer leaves them inactive |
| e | a forced collision: the page ignores the held media server offer, the media server rolls its own back, and both changes land |
| f | a camera swapped for a capture in a new stream (`replaceTrack` and `setStreams`) gives the others a `tracks` update, no offer, and the picture goes on |
| g | the selected candidate pair of every page ends at the media server |
| h | `addTrack` is offered `sendrecv` and answered `recvonly`; a later `addTrack` reuses a section the media server created, and publishes nothing |
| i | VP9, H.264, AV1 and VP9 with temporal layers are each sent by the publisher's preference and decoded by a receiver that numbers them differently |
| j | a publisher's Opus encoder runs on the profile its own client wrote: 128 kb/s mono for the microphone, 160 kb/s stereo for screen audio |
| k | a camera turned off and on, once with `removeTrack` and once with `transceiver.stop()` and a recycled m-line, arrives on a new section every time |
| l | a 50 second call outlives every timer of the media server and stays connected |
| m | a person with nothing to publish offers a receive-only section and receives everybody |
| n | through a NAT that loses every 15th camera packet both ways, NACK and RTX repair each leg separately; the media server advertises the NAT's address, not its own |
| o | an answer that comes after the 10 second offer timeout: the session is closed with `error`, and the others are unaffected |

## What it does not cover

TURN, Firefox and Safari, simulcast, real network conditions beyond the lossy
NAT, and the hub itself: SignalR, the seat rules and authorisation are the
API's tests.
