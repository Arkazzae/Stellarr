# Stellarr Media

Status: **binding contract of the `sfu` topology**  
Wire protocol version: **1** (additive to [`RTC_STANDARD.md`](./RTC_STANDARD.md))  
Default topology: **mesh**; an instance opts into `sfu`

Stellarr Media is Stellarr's own selective forwarding unit, written in Rust.
It replaces the browser mesh with one connection per participant: every
browser sends its microphone, camera and screen to the media server once, and
the media server forwards the packets to everybody else in the room.

This document defines three boundaries:

1. the hub leg between a browser and `AppHub` (public, versioned);
2. the control API between `AppHub` and the media server (internal);
3. what the media server does with media.

`RTC_STANDARD.md` stays the contract of everything the two topologies share:
the bootstrap, the `VoiceSignal` envelope, the state model, the audio, screen
and camera standards. Nothing in it changes meaning.

## Decisions

| Question | Decision |
| --- | --- |
| WebRTC stack | `str0m` (sans-IO). ICE, DTLS and SRTP are not written by hand |
| Transport | ICE-lite, one UDP socket, port `49000` |
| What is forwarded | every kind from the first version: microphone, camera, screen picture, screen sound |
| Processing | RTP is forwarded, never decoded, mixed or transcoded |
| Who authorises | `AppHub` only. The media server trusts its control API and nothing else |
| Signalling path | browser ↔ `AppHub` (SignalR) ↔ media server (loopback HTTP) |
| Connections per browser | one `RTCPeerConnection` |
| Who offers | the browser offers what it publishes; the media server offers what it forwards |
| Glare | the media server is the polite side, the browser the impolite side |
| Whose track is it | a directory keyed by `mid`, issued by the media server. Never guessed from an id the publisher chose |
| Direct calls | the same topology as voice channels; one instance has one topology |
| Rollout | `Rtc:Topology` is `mesh` by default; the mesh client stays in the code base |

## Topology switch

`Rtc:Topology` (`STELLARR_RTC_TOPOLOGY` in compose) is `mesh` or `sfu`. Any
other value stops the API at start.

`GET /api/bootstrap` reports it:

```json
{
  "protocolVersion": 1,
  "topology": "sfu",
  "mediaServer": "udp://chat.example.com:49000"
}
```

- `topology` is the configured value. Capabilities and `iceServers` are the
  same in both topologies;
- `mediaServer` is `""` in the mesh topology. In the `sfu` topology it names
  the public media endpoint, `udp://{Rtc:PublicHost}:{Rtc:MediaPort}`. It is
  diagnostic: the candidates a browser connects to always come from the SDP;
- a client that predates the `sfu` topology refuses to join with the readable
  `unsupported` error that v1 already requires. This is why the protocol
  version stays 1.

## Hub leg

The `sfu` topology adds two hub methods and two events. The v1 names and
payloads keep their meaning.

| Kind | Name | Purpose |
| --- | --- | --- |
| method | `OpenMediaSession` | create the media session of the caller's seat |
| method | `SendMediaSignal` | send one signal to the media server |
| event | `MediaSignal` | one signal from the media server |
| event | `MediaSessionClosed` | the media plane ended the session |

### `OpenMediaSession(channelId) → { sessionId }`

- the caller must hold the voice seat of `channelId` (`JoinVoice` first);
- a media session the same connection already has is closed first, silently;
- `sessionId` is opaque. The client quotes it in every signal and drops any
  signal or closure that names another session;
- the hub refuses with `HubException("Media server is not enabled.")` in the
  mesh topology, and with `HubException("Media server is unavailable.")` when
  the media server cannot be reached.

A client opens a session after every successful `JoinVoice`: on join, after an
administrator move, after a hub reconnect, and to replace a session that died.
Opening a session always means a new `RTCPeerConnection`.

### The `MediaSignal` envelope

```json
{
  "protocolVersion": 1,
  "channelId": "uuid",
  "sessionId": "opaque",
  "kind": "offer | answer | candidate | tracks",
  "payload": "JSON string"
}
```

| Kind | Direction | Payload |
| --- | --- | --- |
| `offer` | browser → media | `{ "type": "offer", "sdp": "…" }` |
| `answer` | media → browser | `{ "type": "answer", "sdp": "…" }` |
| `offer` | media → browser | `{ "type": "offer", "sdp": "…", "negotiationId": 7, "tracks": [Track] }` |
| `answer` | browser → media | `{ "type": "answer", "sdp": "…", "negotiationId": 7 }` |
| `candidate` | browser → media | an ICE candidate, or `null` for end-of-candidates |
| `tracks` | media → browser | `{ "tracks": [Track] }` |

`Track` is one entry of the directory:

```json
{ "mid": "4", "userId": "uuid", "kind": "audio | video", "streamId": "…" }
```

- the hub checks the version, the kind (a browser may send `offer`, `answer`
  and `candidate`), the seat, that the session belongs to the calling
  connection, and the v1 limit of 128 KiB per payload;
- the media server never trickles candidates. All of its candidates are in its
  SDP;
- a `tracks` list is always the whole directory of the session, never a delta.

### Negotiation rules

- the browser offers whenever what it publishes changes: the microphone at
  join, the camera or a screen share starting or stopping;
- the media server offers whenever what it forwards to this browser changes:
  somebody published or withdrew a track, joined or left;
- every signal from the media server reaches the browser in the order the
  media server produced it. The answer to a browser offer travels on the same
  ordered path as the media server's own offers;
- **glare**: the browser is impolite. It ignores a media-server offer that
  arrives while its own offer is being made or is unanswered. The media server
  is polite: when a browser offer arrives while its own offer is pending, it
  rolls its offer back, answers the browser, and then offers again;
- `negotiationId` numbers the media server's offers of one session. The
  browser echoes it in the answer. The media server drops an answer whose
  number is not the one it is waiting for;
- a media-server offer that gets no answer and no competing browser offer for
  10 s is rolled back and issued again with a new number. After three
  unanswered offers in a row the media server closes the session with `error`.

### The directory

With one connection, the connection no longer tells whose track arrived. The
directory does:

- `mid` names a receiving section of the browser's connection. The media
  server assigns it, so a publisher cannot claim somebody else's track;
- `userId` is the account that publishes the track, taken from the seat;
- `streamId` is the stream id the publisher currently gives that track. It is
  the id the publisher announces in its `state` signal as `screenStreamId` or
  `cameraStreamId`, so the v1 rule for telling camera, screen and microphone
  apart still applies, per person;
- a track whose `mid` is not in the directory is not played. A browser holds
  such a track until a directory names it;
- the directory and the occupancy snapshot travel on different paths. An entry
  that names a person the browser has not yet seen in `VoiceParticipantChanged`
  is held until the snapshot names them, and an entry of a person the snapshot
  no longer lists is not played;
- when a publisher replaces a device and the stream id changes, the media
  server sends a new `tracks` list. No SDP exchange is needed for that.

The SDP `msid` of a forwarded section is only a hint. The media server sets it
to the publisher's stream id at the moment the section is created, which keeps
the picture and the sound of one screen share in step. It is not updated
afterwards; the directory is.

`state` signals keep travelling over `SendVoiceSignal`, from browser to
browser, unchanged. In the `sfu` topology the hub refuses the kinds `offer`,
`answer` and `candidate` on `SendVoiceSignal`, so browsers cannot open a direct
connection behind the media server and learn each other's addresses.

### `MediaSessionClosed`

```json
{ "channelId": "uuid", "sessionId": "opaque", "reason": "media-restarted | transport-timeout | error" }
```

Sent only when the media plane ended a session that the seat still needs:

| Reason | Cause |
| --- | --- |
| `media-restarted` | the media server process restarted and lost every session |
| `transport-timeout` | ICE never connected, or stayed disconnected, for 30 s |
| `error` | the session could not continue (see the limits below) |

A session that ends because its seat ended, or because the same connection
opened a new one, is closed without this event: the seat events of v1 already
say what happened.

## Seat and session

A media session exists only while its connection holds the seat of that room.
`AppHub` owns this rule and closes the session in the media server on every
change of a seat:

| Change of the seat | Where |
| --- | --- |
| the person leaves | `LeaveVoice` |
| the connection drops | `OnDisconnectedAsync` |
| a newer tab takes the seat | `JoinVoice` (`VoiceSessionReplaced`) |
| the connection joins another room | `JoinVoice` with a previous room |
| a direct call is declined or blocked | `DeclineDirectCall`, a block in `SocialEndpoints` |
| a moderator removes the person from the channel | `VoiceModerationEndpoints` (kick) |
| a moderator moves the person | `VoiceModerationEndpoints` (move); the client opens a session in the new room |
| the person leaves or is removed from the server | `ModerationEndpoints` |

A person who is no longer seated must stop receiving media at once. The check
is server-side: a browser that ignores `VoiceChannelKicked` gets no more
packets.

The media server keeps at most one session per account. Creating a session for
an account that has one closes the older one.

A hub reconnect ends the seat, as it does in the mesh topology, so it ends the
media session too. The client joins again and opens a new session. Keeping a
session alive across a hub reconnect is a later extension; `sessionId` exists
so that it can be added without a new protocol version.

## Client rules

`VoiceClient` and `VoiceState` do not change. A client that reads
`topology: "sfu"`:

1. joins with `JoinVoice`, then calls `OpenMediaSession`;
2. creates one `RTCPeerConnection` with the bootstrap `iceServers` and
   `bundlePolicy: "max-bundle"`, adds what it publishes, and sends an offer;
3. answers the media server's offers and files every arriving track under the
   person the directory names;
4. keeps every per-person feature on the receiving side: volume, gate, noise
   removal, EQ, speech detection. Each person still arrives as a separate
   track;
5. sends its `state` over `SendVoiceSignal` as before.

TURN stays in the ICE list. A browser on a network that blocks UDP reaches the
media server through coturn.

### State in the `sfu` topology

| Field | Meaning |
| --- | --- |
| `peerCount` | the other people seated in the room |
| `connectedPeerCount` | those of them whose microphone packets are arriving |
| `transport.media = connecting` | the connection to the media server is not up yet |
| `transport.media = ready` | the connection is up, outgoing audio is proven, nobody else is in the room |
| `transport.media = connected` | the connection is up and every other person's microphone is arriving |
| `transport.media = degraded` | the connection is up and some people's microphones are not arriving, or the connection is being recovered |
| `transport.media = failed` | recovery was exhausted |

"Proven" keeps its v1 meaning: cumulative RTP counters that advance, not a
state the browser reports.

### Recovery

- a connection that stays `disconnected` past the grace window, or becomes
  `failed`, is replaced: the client calls `OpenMediaSession` again and builds a
  new connection. The microphone, camera and screen captures stay open;
- `MediaSessionClosed` for the current session triggers the same replacement;
- at most three replacements in a row, with a growing pause. After that the
  call fails with the `transport` error. A replacement that proves media resets
  the count;
- a working connection is never rebuilt because a tab was hidden and shown.

## Control API

`AppHub` is the only client. The API listens on `127.0.0.1:5200` inside the
container and is not published.

- JSON over HTTP/1.1, field names in camelCase;
- every request except `GET /v1/health` carries
  `Authorization: Bearer <secret>`; a wrong or missing secret gets `401`;
- an error body is `{ "error": "<code>", "detail": "<text>" }`.

| Request | Success | Errors |
| --- | --- | --- |
| `GET /v1/health` | `200 { "status": "ok", "version": "…", "epoch": "…", "rooms": 0, "sessions": 0 }` | |
| `POST /v1/reset` | `200 { "epoch": "…", "seq": 0 }` | |
| `POST /v1/sessions` with `{ "roomId": "uuid", "userId": "uuid" }` | `201 { "sessionId": "…", "epoch": "…" }` | `422 invalid-request` |
| `DELETE /v1/sessions/{sessionId}` | `204`, also for an unknown session | |
| `POST /v1/sessions/{sessionId}/offer` with `{ "sdp": "…" }` | `204` | `404 unknown-session`, `422 invalid-sdp`, `422 limit-exceeded` |
| `POST /v1/sessions/{sessionId}/answer` with `{ "sdp": "…", "negotiationId": 7 }` | `204` | `404 unknown-session`, `409 stale-negotiation`, `422 invalid-sdp` |
| `POST /v1/sessions/{sessionId}/candidate` with `{ "candidate": { … } }` or `{ "candidate": null }` | `204` | `404 unknown-session`, `422 invalid-candidate` |
| `GET /v1/events?epoch=…&after=…&waitMs=…` | `200 { "epoch": "…", "reset": false, "events": [Event] }` | |
| `GET /v1/stats` | `200`, see below | |

- `POST /v1/reset` closes every session without events and returns the last
  sequence number issued. The API calls it when it starts, because it starts
  with no seats;
- `POST /v1/sessions` closes an older session of the same `userId` without an
  event;
- sessions closed through this API never produce a `closed` event.

### Events

`GET /v1/events` is a long poll. It returns at once when events newer than
`after` exist, and otherwise waits up to `waitMs` (at most 30000) for one. One
response carries at most 256 events, in order.

```json
{ "seq": 41, "type": "signal", "sessionId": "…", "kind": "answer | offer | tracks", "payload": { } }
{ "seq": 42, "type": "closed", "sessionId": "…", "reason": "transport-timeout | error" }
```

- `seq` grows by one per event within an epoch;
- `payload` is the object of the hub payload table above. The API serialises
  it into the `payload` string of the `MediaSignal` envelope;
- `epoch` identifies one run of the media server process. When the `epoch` in
  the request is not the current one, the response is immediate:
  `{ "epoch": "<current>", "reset": true, "events": [] }`. The API then knows
  that every session it had is gone, sends `MediaSessionClosed` with
  `media-restarted` to the connections that had one, and polls on from
  `after=0` of the new epoch;
- the media server keeps the last 4096 events. A request for an older `after`
  gets `reset: true` as well; the API then calls `POST /v1/reset` and treats
  its sessions the same way;
- when the media server cannot be reached, the API retries with a pause and
  treats the first successful response as it would a new epoch;
- the API remembers, for every session, the `epoch` that `POST /v1/sessions`
  returned. A reset ends only the sessions of an older epoch, so a session
  opened in the new epoch before the poll noticed the restart survives;
- `404 unknown-session` on an offer, an answer or a candidate means the media
  server no longer has the session. The hub does not fail the call: it forgets
  the session and sends `MediaSessionClosed` with `media-restarted` to that
  connection.

### Stats

```json
{
  "epoch": "…",
  "rooms": [
    {
      "roomId": "uuid",
      "sessions": [
        {
          "sessionId": "…",
          "userId": "uuid",
          "state": "new | connecting | connected | disconnected",
          "ageMs": 0,
          "published": 2,
          "forwarded": 6,
          "ingress": { "packets": 0, "bytes": 0 },
          "egress": { "packets": 0, "bytes": 0 }
        }
      ]
    }
  ]
}
```

## Media plane

### Transport

- one UDP socket for every session; packets are matched to a session by the
  remote address, and before that by the ICE credentials of the first check;
- ICE-lite: the media server answers connectivity checks and sends none;
- the media server advertises host candidates only, in this order: the public
  address, when one is configured, then the primary local IPv4 address of the
  machine. The second one is what coturn, in the same container, relays to
  for a browser that needs TURN;
- a datagram that matches no session is dropped without an answer;
- IPv4 only in this version.

### Forwarding

- a room is the set of sessions with the same `roomId`. Every session receives
  every track that every other session of the room publishes. A session never
  receives its own tracks;
- a published track is a section of the browser's description that sends
  towards the media server. A section that stops sending is withdrawn;
- for each published track, each other session gets one send-only section. A
  withdrawn track makes that section inactive. Sections are not reused in this
  version;
- packets are forwarded as they arrive. Per connection the media server
  rewrites only what belongs to that connection: SSRC, payload type, header
  extension ids, and sequence numbers and timestamps where continuity needs
  it. The payload is never touched;
- a packet whose codec the receiving browser did not negotiate is dropped;
- codecs offered: Opus; VP9, VP8, H.264, AV1. A publisher uses one video codec
  per track, the first of its own preference that the media server accepts;
- the audio level header extension is forwarded;
- NACK and RTX are handled per connection, and so is transport-wide congestion
  feedback. A publisher's congestion control therefore reacts to its own
  uplink only;
- a keyframe is requested from the publisher when a section starts forwarding
  and when a receiver asks for one (PLI or FIR), at most once per second per
  track.

### Limits

| Limit | Value | When exceeded |
| --- | ---: | --- |
| SDP of one signal | 128 KiB | `422 invalid-sdp`, or `error` when the media server's own offer would exceed it |
| tracks one session publishes at a time | 8 | `422 limit-exceeded` |
| time to connect after creation | 30 s | closed with `transport-timeout` |
| time disconnected | 30 s | closed with `transport-timeout` |
| unanswered offers in a row | 3 | closed with `error` |

A session that is closed with `error` because its description grew too large
is reopened by the client with a fresh, compact description.

### Not in this version

Each item is a known gap, not an oversight. The default topology stays `mesh`
until the first one is closed.

- adaptation to a slow receiver: dropping VP9 temporal layers, pausing the
  picture and keeping the sound. Today a receiver on a weak downlink gets the
  publisher's full stream;
- forwarding only the loudest speakers in a large room;
- subscriptions the browser chooses, such as not receiving a screen share
  nobody watches;
- keeping a session across a hub reconnect, and ICE restart;
- ICE over TCP, IPv6;
- end-to-end encryption of frames. Media is encrypted on each connection and
  is readable in the memory of the media server, which the mesh topology never
  allowed;
- media statistics in the operator panel.

## Process and configuration

The media server is the crate `media/` of this repository and builds the binary
`stellarr-media`. In the production image supervisord runs it next to the API.

| Variable | Default | Meaning |
| --- | --- | --- |
| `STELLARR_MEDIA_BIND` | `0.0.0.0:49000` | the UDP socket |
| `STELLARR_MEDIA_PUBLIC_IP` | empty | public IPv4 address to advertise |
| `STELLARR_MEDIA_PUBLIC_PORT` | the port of `STELLARR_MEDIA_BIND` | public UDP port to advertise with it |
| `STELLARR_MEDIA_ADVERTISE` | empty | a comma-separated list of `ip:port` that replaces the derived candidate list |
| `STELLARR_MEDIA_CONTROL_BIND` | `127.0.0.1:5200` | the control API |
| `STELLARR_MEDIA_CONTROL_SECRET` | empty | the bearer secret of the control API |
| `STELLARR_MEDIA_LOG` | `info` | log level |

- an empty secret is accepted only when the control API listens on a loopback
  address; otherwise the process refuses to start;
- the process exits with a non-zero status when it cannot bind a socket, so
  supervisord restarts it and the API sees a new epoch.

The API reads:

| Setting | Default | Meaning |
| --- | --- | --- |
| `Rtc:Topology` | `mesh` | `mesh` or `sfu` |
| `Rtc:MediaControlUrl` | `http://127.0.0.1:5200` | where the control API is |
| `Rtc:MediaControlSecret` | empty | the bearer secret |
| `Rtc:MediaPort` | `49000` | the public UDP port named in `mediaServer` |

In the mesh topology the API never calls the media server.

The container entrypoint creates the secret under `secrets/media-control-secret`
on first start, the same way it creates the TURN secret, and passes the public
address it resolved for coturn to the media server.

## Quality gate

The gate of `RTC_STANDARD.md` applies to both topologies. The `sfu` topology
adds:

1. unit tests of the media server's rooms, directory and negotiation, without a
   network;
2. a test with real protocol stacks in one process: two and three clients
   through the media server, sound and picture, a late join, a leave, and an
   offer collision;
3. tests of the hub leg: version, kind, seat, a session of another connection,
   and every seat change in the table above closing the session;
4. tests of the client: the directory, glare, a session closed by the media
   plane, replacement and its limit;
5. a two-account test through the domain in the `sfu` topology: bytes and
   packets in both directions, and no candidate pair between the two browsers;
6. the forced-TURN test with the relay ending at the media server.
