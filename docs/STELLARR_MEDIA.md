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

`Rtc:Topology` (`STELLARR_RTC_TOPOLOGY` in compose) is `mesh` or `sfu`, in
lower case. A missing or empty value means `mesh`, because compose passes an
unset variable on as an empty one. Any other value stops the API at start, and
so does the container entrypoint.

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
  the public media endpoint, `udp://{Rtc:PublicHost}:{Rtc:MediaPort}`, with
  `localhost` when `Rtc:PublicHost` is not set. It is diagnostic: the
  candidates a browser connects to always come from the SDP;
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
- a media session the same connection already has is taken off the seat first
  and closed silently. The close goes to the media server in the background,
  so it may arrive after the new session is created; the media server's rule of
  one session per account makes the order irrelevant;
- `sessionId` is opaque. The client quotes it in every signal and drops any
  signal or closure that names another session or another room;
- the hub refuses with:
  - `HubException("Media server is not enabled.")` in the mesh topology;
  - `HubException("Invalid channelId.")` when `channelId` is not a uuid;
  - `HubException("Not seated in this voice room.")` when the caller holds no
    seat in that room, also when the seat ended while the media server was
    creating the session. That session is closed again;
  - `HubException("Media server is unavailable.")` when the media server
    cannot be reached or does not answer in time, and while the API resets it:
    after the API starts, until the first reset succeeds, and after the API
    lost track of its events.

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
{ "mid": "fAk", "userId": "uuid", "kind": "audio | video", "streamId": "…" }
```

- the hub checks the version, the kind (a browser may send `offer`, `answer`
  and `candidate`), the seat, that the session belongs to the calling
  connection, and the v1 limit of 128 KiB per payload, counted in UTF-8 bytes
  of the payload string. It also checks that the payload is what its kind
  promises: `offer` and `answer` an object with the matching `type` and a
  string `sdp`, `answer` also an integer `negotiationId`, `candidate` an
  object or `null`;
- a failed check gets `HubException("Invalid media signal.")`, a `channelId`
  that is not a uuid `HubException("Invalid ChannelId.")`, and the mesh
  topology `HubException("Media server is not enabled.")`;
- `SendMediaSignal` returns once the media server has taken the signal. A
  stale answer (`409`) returns normally, since the media server drops it by
  design. A description or candidate the media server refuses (`422`, or `413`
  for a body it will not read) gets `HubException("Invalid media signal.")`;
  any other failure `HubException("Media server is unavailable.")`. Neither
  ends the session. `404 unknown-session` returns normally and is followed by
  `MediaSessionClosed` (see "Events" below);
- the `MediaSignal` event carries only `offer`, `answer` and `tracks`. The
  media server never trickles candidates; all of them are in its SDP. A client
  drops any other kind;
- a `tracks` list is always the whole directory of the session, never a delta.

### Negotiation rules

- the browser offers whenever what it publishes changes: the microphone at
  join, the camera or a screen share starting or stopping. Its first offer
  comes after `OpenMediaSession` has returned and must have at least one
  section; a browser that publishes nothing offers a `recvonly` audio section,
  which is answered `inactive`;
- the browser publishes each track on a section of its own, made with
  `addTransceiver(track, { direction: "sendonly", streams: [stream] })`. A
  browser-made `sendrecv` section is answered `recvonly` and works the same.
  Media on a section the media server made is never accepted: such a section
  offered `sendrecv` is answered `sendonly`, and offered `sendonly` is
  answered `inactive`. This is why `addTrack` must not be used: Chromium was
  seen to reuse such a section for it, and the track is then silently not
  published;
- the media server offers whenever what it forwards to this browser changes:
  somebody published or withdrew a track, joined or left. It sends a session
  nothing, neither an offer nor a `tracks` list, before it has answered that
  session's first browser offer, so no signal can reach a browser before it
  knows its `sessionId`;
- every signal from the media server reaches the browser in the order the
  media server produced it. The answer to a browser offer travels on the same
  ordered path as the media server's own offers. The browser sends its own
  signals one at a time, each after the hub has returned the previous one;
- **glare**: the browser is impolite. It ignores a media-server offer that
  arrives while its own offer is being made or is unanswered. The media server
  is polite: when a browser offer arrives while its own offer is pending, it
  rolls its offer back, answers the browser, and then offers again;
- `negotiationId` numbers the media server's offers of one session, from 1.
  The browser echoes it in the answer. The media server drops an answer whose
  number is not the one it is waiting for, or that comes when it waits for
  none, with `409 stale-negotiation`. The sections of an offer that was rolled
  back never come back: what they carried is offered again on new sections;
- a media-server offer that gets no answer and no competing browser offer for
  10 s is rolled back and issued again with a new number. After three
  unanswered offers in a row the media server closes the session with `error`;
- a browser that cannot apply a description of the media server, or whose
  offer or answer the hub refuses, replaces the session at once (see
  "Recovery") instead of waiting for the third strike. This is also what ends
  a session whose answer arrived after its offer had been rolled back: the
  browser then holds sections the media server forgot, and cannot apply the
  next offer.

### The directory

With one connection, the connection no longer tells whose track arrived. The
directory does:

- `mid` names a receiving section of the browser's connection, exactly as the
  `a=mid` of that section reads (today three letters and digits, such as
  `fAk`; a client assumes no format). The media server assigns it, so a
  publisher cannot claim somebody else's track;
- `userId` is the account that publishes the track, taken from the seat, as a
  lower-case uuid;
- `streamId` is the stream id the publisher currently gives that track, or
  `""` when its section names no stream. It is the id the publisher announces
  in its `state` signal as `screenStreamId` or `cameraStreamId`, so the v1 rule
  for telling camera, screen and microphone apart still applies, per person;
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
afterwards; the directory is. The client therefore ignores the streams a
browser groups arriving tracks into and files each track by the directory
alone.

`state` signals keep travelling over `SendVoiceSignal`, from browser to
browser, unchanged. In the `sfu` topology the hub refuses the kinds `offer`,
`answer` and `candidate` on `SendVoiceSignal` with
`HubException("Invalid voice signal.")`, so browsers cannot open a direct
connection behind the media server and learn each other's addresses.

### `MediaSessionClosed`

```json
{ "channelId": "uuid", "sessionId": "opaque", "reason": "media-restarted | transport-timeout | error" }
```

Sent only when the media plane ended a session that the seat still needs:

| Reason | Cause |
| --- | --- |
| `media-restarted` | the media server process restarted, or the API reset it after losing track of its events, and the session was lost; or a signal found it gone (`404`) |
| `transport-timeout` | the connection was never up, or stayed disconnected, for 30 s; up means ICE, DTLS and SRTP |
| `error` | the session could not continue (see the limits below) |

The hub passes `transport-timeout` on as it is and reports any other reason
of the media server as `error`.

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
| a moderator kicks or bans the person from the server | `ModerationEndpoints` |

Every one of these goes through one place, `PresenceTracker`, which hands the
session of a seat that ends, moves or gets a new session to a background
closer. The seat ends at once and in memory; the closer retries the
`DELETE` every 2 s until the media server takes it, and keeps at most 4096
closes waiting, dropping the oldest beyond that. Joining the room the connection
already sits in is not a change: the seat keeps its mute state and its
session.

A person who is no longer seated must stop receiving media at once. The check
is server-side: a browser that ignores `VoiceChannelKicked` gets no more
packets.

Deleting a voice channel or a server, disabling an account and revoking a
sign-in do not end seats yet, in either topology, so a media session there
lives until its hub connection drops.

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
   `bundlePolicy: "max-bundle"`, adds what it publishes as `sendonly`
   sections (see "Negotiation rules"), and sends an offer;
3. answers the media server's offers and files every arriving track under the
   person the directory names;
4. keeps every per-person feature on the receiving side: volume, gate, noise
   removal, EQ, speech detection. Each person still arrives as a separate
   track;
5. sends its `state` over `SendVoiceSignal` as before;
6. writes its Opus profiles into the `a=fmtp` lines of its own
   descriptions. The media server repeats a publisher's own Opus parameters
   back to it (see "Forwarding"), so the parameters of the browser's offer
   reach its encoder, as Chromium was seen to follow. In its answers the
   client gives a received screen's sound the stereo screen-audio profile.

TURN stays in the ICE list. A browser on a network that blocks UDP reaches the
media server through coturn.

### State in the `sfu` topology

| Field | Meaning |
| --- | --- |
| `peerCount` | the other people seated in the room |
| `connectedPeerCount` | those of them whose microphone packets are arriving |
| `transport.media = connecting` | the connection to the media server is not up yet, or it is up and outgoing audio is not proven yet |
| `transport.media = ready` | the connection is up, outgoing audio is proven, nobody else is in the room |
| `transport.media = connected` | the connection is up and every other person's microphone is arriving |
| `transport.media = degraded` | the connection is up and some people's microphones are not arriving; or it is `disconnected` or `failed`; or it is up and outgoing audio stayed unproven for three samples; or it is being replaced |
| `transport.media = failed` | recovery was exhausted |

"Up" is the connection state `connected`. "Proven" keeps its v1 meaning:
cumulative RTP counters that advance, not a state the browser reports. A
person's microphone is "arriving" when the `inbound-rtp` packet counter of a
section the directory files as their microphone advanced since the previous
sample, judged afresh at every sample. A muted person counts as arriving once
their microphone has a section, as in the mesh. A connection that is up but
has not proven outgoing audio after three samples shows the transport error
`voiceClient.mediaServerStalled`.

### Recovery

- a connection that stays `disconnected` past the grace window (10 s), or
  becomes `failed` or `closed`, is replaced: the client closes it at once,
  calls `OpenMediaSession` again and builds a new connection. The people stay
  and only what arrived on the old connection stops playing. The microphone,
  camera and screen captures stay open;
- these trigger the same replacement, without the grace window:
  `MediaSessionClosed` for the current session; a description of the media
  server the browser cannot apply; an offer or answer the hub refuses; a
  failed `OpenMediaSession`, the first one included;
- at most three replacements in a row, after pauses of 2 s, 4 s and 8 s, which
  span a restart of the media server process. After that `transport.media` is
  `failed` and the error is the `transport` error
  `voiceClient.mediaServerLost`. The seat is kept, so the existing
  "Reconnect" action recovers with one leave and join. A replacement whose
  connection proves outgoing audio resets the count, and so does every
  successful `JoinVoice`;
- a loss while the hub itself is not connected spends no attempt: the hub
  reconnect ends the seat anyway, and the join that follows opens the next
  session;
- a working connection is never rebuilt because a tab was hidden and shown;
  a resumed tab replaces only a connection that is `disconnected` or `failed`.

## Control API

`AppHub` is the only client. The control API listens on `127.0.0.1:5200`
inside the container and is not published.

- JSON over HTTP/1.1, field names in camelCase;
- every request except `GET /v1/health` carries
  `Authorization: Bearer <secret>`; a wrong or missing secret gets `401`.
  With an empty secret, which only a loopback address accepts, the API sends
  no `Authorization` header and the media server checks none. Both sides trim
  the secret, since HTTP drops whitespace around a header value;
- an error body is `{ "error": "<code>", "detail": "<text>" }`;
- `sessionId` and `epoch` are opaque to the API; the media server makes them
  32 lower-case hexadecimal characters. `roomId` and `userId` must be shaped
  as uuids, which the API writes in lower case.

| Request | Success | Errors |
| --- | --- | --- |
| `GET /v1/health` | `200 { "status": "ok", "version": "…", "epoch": "…", "rooms": 0, "sessions": 0 }` | |
| `POST /v1/reset` | `200 { "epoch": "…", "seq": 0 }` | |
| `POST /v1/sessions` with `{ "roomId": "uuid", "userId": "uuid" }` | `201 { "sessionId": "…", "epoch": "…" }` | `422 invalid-request` |
| `DELETE /v1/sessions/{sessionId}` | `204`, also for an unknown session | |
| `POST /v1/sessions/{sessionId}/offer` with `{ "sdp": "…" }` | `204` | `404 unknown-session`, `422 invalid-sdp`, `422 limit-exceeded` |
| `POST /v1/sessions/{sessionId}/answer` with `{ "sdp": "…", "negotiationId": 7 }` | `204` | `404 unknown-session`, `409 stale-negotiation`, `422 invalid-sdp` |
| `POST /v1/sessions/{sessionId}/candidate` with `{ "candidate": { … } }` or `{ "candidate": null }` | `204` | `404 unknown-session`, `422 invalid-candidate` |
| `GET /v1/events?epoch=…&after=…&waitMs=…` | `200 { "epoch": "…", "reset": false, "events": [Event] }` | `422 invalid-request` |
| `GET /v1/stats` | `200`, see below | |

A request may also get:

| Status | Code | When | The API treats it as |
| --- | --- | --- | --- |
| `413` | `payload-too-large` | a request body over 256 KiB | a refused signal, like `422` |
| `404` | `not-found` | a route that does not exist | the media server being unavailable; on a signal route the API reads only the status and takes it for `unknown-session` |
| `405` | `method-not-allowed` | a route that does not take the method | the media server being unavailable |
| `503` | `unavailable` | the media task of the process is gone | the media server being unavailable |

Anything the API cannot use, a status it does not expect included, counts as
the media server being unavailable, except for `DELETE`, where any `2xx` or
`404` means the session is closed.

- `POST /v1/reset` closes every session without events and returns the last
  sequence number issued. It keeps the epoch. The API calls it when it starts,
  because it starts with no seats;
- `POST /v1/sessions` closes an older session of the same `userId` without an
  event;
- sessions closed through this API never produce a `closed` event;
- an unknown session is reported as `404` before anything in the body is
  looked at, because the API acts on that answer whatever the body was;
- a candidate is the object a browser's `RTCIceCandidate.toJSON()` gives;
  only `candidate` and `usernameFragment` are read. A well-formed candidate
  the media server cannot use gets `204` and is ignored: an mDNS host name,
  IPv6, TCP and an empty candidate string. So do the usable candidates of a
  session after its first 64. Only a malformed one gets `422`;
- an answer whose `negotiationId` is not the one the media server waits for,
  or that comes when it waits for none, gets `409`; a malformed answer with
  the right number gets `422`, and the offer keeps waiting for a good one;
- a `422 invalid-sdp` for an answer that parses but cannot be applied rolls
  the media server's offer back, and the media server offers again.

### Events

`GET /v1/events` is a long poll. It returns at once when events newer than
`after` exist, and otherwise waits up to `waitMs` (at most 30000) for one. One
response carries at most 256 events, in order.

```json
{ "seq": 41, "type": "signal", "sessionId": "…", "kind": "answer | offer | tracks", "payload": { } }
{ "seq": 42, "type": "closed", "sessionId": "…", "reason": "transport-timeout | error" }
```

- `seq` grows by one per event within an epoch, from 1. A closed event has no
  `kind` and no `payload`;
- `payload` is the object of the hub payload table above. The API serialises
  it into the `payload` string of the `MediaSignal` envelope as it came, and
  ignores a signal whose payload is not an object or whose kind it does not
  know. The hub does not apply its 128 KiB limit to this direction;
- `epoch` identifies one run of the media server process. When the `epoch` in
  the request is not the current one, or is missing, the response is
  immediate: `{ "epoch": "<current>", "reset": true, "events": [] }`. The API
  then knows that the sessions of the old epoch are gone, sends
  `MediaSessionClosed` with `media-restarted` to the connections that had one,
  and polls on from `after=0` of the new epoch;
- the media server keeps the last 4096 events. A request for an older `after`
  gets `reset: true` in the current epoch, and so does an `after` beyond the
  last sequence number issued, which no correct poller can send. The API then
  calls `POST /v1/reset` and ends every session it holds the same way;
- an `after` or a `waitMs` that is not a non-negative integer gets
  `422 invalid-request`; a missing one counts as 0;
- the API remembers, for every session, the `epoch` that `POST /v1/sessions`
  returned. A new epoch ends only the sessions of another epoch, so a session
  opened in the new epoch before the poll noticed the restart survives;
- `POST /v1/reset` keeps the epoch, so the epoch cannot tell which sessions a
  reset ended. The API therefore never creates a session while a reset runs,
  nor while it hands out events: one gate in the API keeps the three apart.
  When it resets, at start and after a lost window, it ends every session it
  holds, and it refuses `OpenMediaSession` until the reset has succeeded;
- when the media server cannot be reached, or answers in a way the API cannot
  use, the API polls again after 2 s. The first successful response ends the
  sessions whose epoch differs from the epoch it names; if the epoch did not
  change, polling goes on from the last sequence number and nothing is lost;
- the API polls with `waitMs=25000` and gives a poll that long plus 5 s, and
  every other request 5 s, before it counts the media server as unavailable;
- `404 unknown-session` on an offer, an answer or a candidate means the media
  server no longer has the session. The hub does not fail the call: it forgets
  the session and sends `MediaSessionClosed` with `media-restarted` to that
  connection. The API reads only the status, not the error code, of a `404`.

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

- `state` is `new` until the first browser offer is answered, `connecting`
  until the connection is first up (ICE, DTLS and SRTP), then `connected`, or
  `disconnected` while it is down;
- `published` counts the tracks the session sends, `forwarded` the receiving
  sections that forward somebody's track;
- `ingress` and `egress` count each media packet once as the media server
  receives or writes it, with its payload bytes. RTP headers, RTCP and the
  media server's own retransmissions are not counted.

## Media plane

### Transport

- one UDP socket for every session; packets are matched to a session by the
  remote address, and before that by the ICE credentials of the first check;
- a session takes connectivity checks from at most 64 distinct remote
  addresses over its life. A check from a further new address is dropped
  without an answer; the addresses already taken keep working. A browser uses
  a handful, and without the limit one browser could make its session, and the
  one task that serves every room, grow without bound;
- ICE-lite: the media server answers connectivity checks and sends none, so
  the browser is the controlling agent and the DTLS client. The connection is
  up once ICE, DTLS and SRTP all are;
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
  per track, the first of its own preference that the media server accepts.
  The media server's answers and later offers keep each browser's own codec
  order for the sections that browser publishes;
- for each section a browser publishes, the media server's descriptions to
  that browser repeat the Opus format parameters (`a=fmtp`) of its latest
  offer, so the publisher's client chooses its own encoder profile (bitrate,
  stereo, DTX, FEC) through its offer. The sections the media server creates
  carry its own defaults, `minptime=10;useinbandfec=1`;
- a publisher sends one encoding per track. Simulcast is not supported: every
  layer would arrive on one section and be forwarded as one stream;
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
| SDP of one signal, as text | 128 KiB | `422 invalid-sdp` for a browser's description; closed with `error` when the media server's own offer or answer would exceed it |
| tracks one session publishes at a time | 8 | `422 limit-exceeded` |
| request body of the control API | 256 KiB | `413 payload-too-large` |
| usable trickled candidates of one session | 64 | later ones get `204` and are ignored |
| remote addresses one session takes checks from | 64 | checks from a further address are dropped |
| time to connect after creation (ICE, DTLS and SRTP) | 30 s | closed with `transport-timeout` |
| time disconnected | 30 s | closed with `transport-timeout` |
| unanswered offers in a row | 3 | closed with `error` |

Two limits of 128 KiB meet here. The media server counts the SDP text; the
hub counts the UTF-8 bytes of the browser's payload string, in which JSON
escaping makes every line break of the SDP four bytes. A browser description
close to the limit is therefore refused by the hub first, with
`HubException("Invalid media signal.")`, and the client replaces the session
at once.

Sections are not reused, so every track that starts and stops leaves an
inactive section in the descriptions of everybody else in the room. In an
offer to Chromium's codec list a forwarded video section measured about
3.8 KB and an audio one about 1 KB. A session whose description grew too
large ends with `error`, or with a refused answer, and is reopened by the
client with a fresh, compact description.

### Not in this version

Each item is a known gap, not an oversight. The default topology stays `mesh`
until the first one is closed.

- adaptation to a slow receiver: dropping VP9 temporal layers, pausing the
  picture and keeping the sound. Today a receiver on a weak downlink gets the
  publisher's full stream;
- forwarding only the loudest speakers in a large room;
- subscriptions the browser chooses, such as not receiving a screen share
  nobody watches;
- simulcast, and reusing inactive sections, which would keep the
  descriptions of a long call small;
- keeping a session across a hub reconnect, and ICE restart;
- following a browser whose address changes at once. Its own media is taken
  from the new address with its next check, but the media server keeps
  sending to the old one until that pair has had no check for 15 s, so the
  browser hears nobody for that long;
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
| `STELLARR_MEDIA_LOG` | `info` | a `tracing` filter, such as `info` or `stellarr_media=debug` |

- values are trimmed, and an empty variable counts as unset, because the
  entrypoint exports `STELLARR_MEDIA_PUBLIC_IP` empty when it knows no public
  address;
- an empty secret is accepted only when the control API listens on a loopback
  address; otherwise the process refuses to start;
- `STELLARR_MEDIA_ADVERTISE` may name loopback addresses, which the
  development stack uses. Bound to `0.0.0.0`, the derived local candidate is
  the source address of the default route, or `127.0.0.1` without one;
- the process exits with a non-zero status when its configuration is invalid
  or it cannot bind a socket. supervisord restarts it as it restarts the other
  programs: without limit after a run of at least 2 s, so a crash gives the API
  a new epoch at once, and after at most three attempts that fail within 2 s,
  which only a configuration error does, it gives up until the container
  restarts;
- supervisord runs it as `nobody`, before the API, which resets it on start.
  It logs to its standard output, without colour codes when that is not a
  terminal.

The API reads:

| Setting | Default | Meaning |
| --- | --- | --- |
| `Rtc:Topology` | `mesh` | `mesh` or `sfu`; empty means `mesh` |
| `Rtc:MediaControlUrl` | `http://127.0.0.1:5200` | where the control API is, an absolute `http` or `https` address |
| `Rtc:MediaControlSecret` | empty | the bearer secret |
| `Rtc:MediaPort` | `49000` | the public UDP port named in `mediaServer`, from 1 to 65535 |

In the `sfu` topology a value of these the API cannot use stops it at start.
In the mesh topology only `Rtc:Topology` is read, and the API never calls the
media server.

The container entrypoint creates the secret under `secrets/media-control-secret`
on first start, the same way it creates the TURN secret; a
`STELLARR_MEDIA_CONTROL_SECRET` in the container's environment takes its place.
It passes the public address it resolved for coturn to the media server as
`STELLARR_MEDIA_PUBLIC_IP`, and the host port of `49000/udp`
(`STELLARR_MEDIA_PORT` in compose) as both `STELLARR_MEDIA_PUBLIC_PORT` and
`Rtc:MediaPort`. The socket stays bound to `0.0.0.0:49000` and the control API
to `127.0.0.1:5200`. In the `sfu` topology without a public address or a
`STELLARR_MEDIA_ADVERTISE` it prints a warning, because only browsers that
reach the container's own address, or come through TURN, can connect.

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
