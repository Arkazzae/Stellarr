# Stellarr RTC v1

Status: **binding base contract**  
Wire protocol version: **1**  
Default topology: **mesh**  
Optional topology: **sfu**, through Stellarr's own SFU written in Rust (Stellarr Media), defined in [`STELLARR_MEDIA.md`](./STELLARR_MEDIA.md)

This document defines the stable boundary on which later versions of voice and
video are built. The implementation may change; the meaning of the contract
must not change silently. Both topologies share it; `STELLARR_MEDIA.md` adds
only what the `sfu` topology needs on top.

## Layers

```text
UI / React
    |
    v
VoiceClient + VoiceState             stable product API
    |
    +-- session / lifecycle          join, leave, mute, resume, recovery
    +-- capture                      microphone, camera, screen, system audio
    +-- processing                   echo cancellation, levelling, noise
    |                                suppression (RNNoise, GTCRN, Speex), input gate
    +-- observation                  speech detector, levels, quality telemetry
    +-- codec                        Opus / video codecs
    +-- media transport              ICE, DTLS, SRTP, RTP/RTCP
    |
    v
RTC protocol v1 over SignalR         versioned control plane
    |
    +-- mesh (default): browser to browser
    `-- sfu: one connection to Stellarr Media, which forwards to the room
```

The UI may use only `VoiceClient` and the immutable `VoiceState`. Components
must not import SignalR, `RTCPeerConnection`, DSP worklets or anything of the
media server directly.

## Bootstrap contract

`GET /api/bootstrap` returns `rtc`:

```json
{
  "protocolVersion": 1,
  "topology": "mesh",
  "capabilities": {
    "audioCodecs": ["opus"],
    "videoCodecs": ["vp9", "vp8", "h264"],
    "audioProcessing": ["browser", "rnnoise", "gtcrn", "speex", "gate"],
    "camera": true,
    "screenShare": true,
    "screenAudio": true
  },
  "iceServers": [],
  "signalingHub": "/hubs/app",
  "mediaServer": ""
}
```

`iceServers` is filled in per request: a STUN entry, a TURN entry with
time-limited credentials, and, when `Rtc__TurnsEnabled` is on, a TURNS entry.
The empty list above only shows the shape.

`topology` is the value of `Rtc:Topology`, `mesh` or `sfu`. `mediaServer` is
empty in the mesh topology; in the `sfu` topology it names the public media
endpoint, as `STELLARR_MEDIA.md` defines. Capabilities and `iceServers` are the
same in both.

The client checks the version and the topology before it opens a device. An
unsupported contract ends the attempt with a readable `unsupported` error; the
client never guesses a format. The HTTP parser still accepts the older `mode`
field in place of `topology`, only as a migration from the scaffold to v1. It
is not part of the binding contract.

## Signalling contract

Every `VoiceSignal` message has an envelope:

```json
{
  "protocolVersion": 1,
  "channelId": "uuid",
  "fromUserId": "uuid",
  "toUserId": "uuid",
  "kind": "offer | answer | candidate | state",
  "payload": "JSON string"
}
```

- `channelId` stays the name of the wire field for v1 compatibility, but it
  identifies an RTC room: a public voice channel or a private direct
  conversation;
- the client sends the envelope without `fromUserId`; the hub fills it in from
  the session. When `toUserId` is absent, the hub relays the message to every
  other connection in the room;
- the backend checks the session, membership of the channel or participation
  in the direct conversation, the recipient, the version, the kind, and a limit
  of 128 KiB per payload;
- the occupancy snapshot of a public channel goes to the server, and the
  snapshot of a direct conversation goes only to its two participants;
- declining a private call atomically frees the seats in the room and sends a
  targeted `DirectCallDeclined`, after which the caller closes its local
  media;
- the browser adapter rejects an unknown version and kind before passing the
  message on to the media layer;
- the payload is decoded by typed RTC codecs, not by casting the result of
  `JSON.parse`;
- `offer` and `answer` carry `{ type, sdp }` with a matching type;
- `candidate` carries an ICE candidate, or `null` as the end-of-candidates
  marker;
- `state` carries `{ muted, screenStreamId, cameraStreamId }`. `cameraStreamId`
  is an optional extension of v1; its absence means the camera is off.

An incompatible change to the envelope, to the meaning of a field or to a
payload raises `protocolVersion`. A new optional field that an old receiver can
safely ignore does not need a new version.

### Hub methods and events

The names are fixed in `web/src/lib/rtc/protocol.ts` and implemented by
`AppHub` in `server/Stellarr.Api/Realtime/`.

| Kind | Name | Purpose |
| --- | --- | --- |
| method | `JoinVoice` | take a seat in a voice channel or a direct call |
| method | `LeaveVoice` | give the seat up |
| method | `SendVoiceSignal` | relay an envelope to one peer or to the room |
| method | `DeclineDirectCall` | end a direct call for both people |
| method | `PlaySoundboard` | play a soundboard clip in the room |
| method | `GetRtcClock` | server time in Unix milliseconds |
| event | `VoiceParticipantChanged` | occupancy of a room: `channelId`, `sequence`, `participants` |
| event | `VoiceSignal` | an envelope relayed from a peer |
| event | `VoiceSessionReplaced` | the account joined from another tab |
| event | `DirectCallDeclined` | the other person declined the call |
| event | `SoundboardPlayed` | a scheduled soundboard clip |
| event | `JoinSoundPlayed` | a scheduled arrival clip |
| event | `SoundboardChanged` | the server's soundboard changed; reload it |

`sequence` orders occupancy snapshots of one room. A client drops a snapshot
older than the last one it applied instead of tearing down live peers.

The `sfu` topology adds the methods `OpenMediaSession` and `SendMediaSignal`
and the events `MediaSignal` and `MediaSessionClosed`.
[`STELLARR_MEDIA.md`](./STELLARR_MEDIA.md) defines them, their payloads and the
negotiation with the media server. In that topology `SendVoiceSignal` still
carries `state` from browser to browser, but the hub refuses `offer`, `answer`
and `candidate` on it, so browsers cannot open a direct connection to each
other.

### Soundboard in a voice channel

The soundboard uses the same authenticated control plane and the list of
active connections from `PresenceTracker`, but it does not pretend to be a
microphone track:

- `PlaySoundboard(channelId, soundId)` checks that the caller is present in the
  voice channel, the clip's server, the permission to play, and, when the
  server keeps its rate limit on, a cooldown of one clip per 5 s per person;
- `GetRtcClock()` lets the client estimate its clock offset from half the
  round-trip time;
- `SoundboardPlayed` carries the full description of the clip and a shared
  `startsAtUnixMs` set 750 ms in the future;
- every client decodes the audio first and then schedules the trimmed segment in
  an `AudioContext`. A late receiver skips the start of the clip by the amount
  it is late, so it stays in step with the rest of the call.

The catalogue and the trim boundaries are persisted by the API. The hub
transmits only the decision to play one clip; it does not copy binary audio
through SignalR.

### Arrival sound

Joining a channel can announce a personal clip, picked in the person's
settings from the soundboards of the servers they belong to. It is the same
envelope as the soundboard, but the occasion is `JoinVoice` instead of a tile
press:

- the choice is stored in `UserPreferences.JoinSoundId`; validation on save
  requires membership of the clip's server, and the hub checks it again at
  playback, so leaving the server silences the announcement;
- `JoinSoundPlayed` carries the same `SoundboardPlayedDto` as the soundboard,
  with `triggeredByUserId` set to the person joining and `startsAtUnixMs` 750 ms
  in the future;
- the server shortens the window to `JoinSound.MaxSeconds` (5 s) in the DTO,
  both in the picker library and in the event, so the preview in settings is
  the same segment the channel will hear;
- the cooldown `JoinSound.Cooldown` (30 s per person) silences a loop of joins
  and leaves; joining itself is never refused because of it;
- the client plays the clip in the soundboard engine (volume, mute, chosen
  output) and does not add it to the tiles, because the clip may come from a
  server the listener is not on. The ordinary join tone stays silent for a
  person whose announcement was scheduled a moment ago;
- the listener's `joinLeaveSound` preference silences both halves of the same
  announcement: the join and leave tones in `VoiceProvider`, and another
  person's clip in the adapter (`setArrivalsAudible`). The tone played when a
  screen share starts has its own pair and is not covered by this preference.

`AttachmentAccess` lets people read such a file when they share a server or a
private conversation with its owner. Otherwise a clip from server A could not
be fetched in a channel of server B.

## State model

`VoiceState.connection` describes the session cycle as the UI sees it. The
transport state is separate, because the control plane and the data plane can
work independently:

| Field | States | Meaning |
| --- | --- | --- |
| `transport.signaling` | `idle`, `connecting`, `connected`, `reconnecting`, `disconnected` | availability of the hub and the ability to negotiate |
| `transport.media` | `idle`, `ready`, `connecting`, `connected`, `degraded`, `failed` | the actual state of the peer connections and media |
| `peerCount` | number | number of remote connections expected |
| `connectedPeerCount` | number | number of peer connections in the `connected` state |

`signaling=connected` does not mean audio is flowing. `media=ready` means a
correct join with no remote peer. With several peers, a mix of working and
failing connections gives `degraded`.

In the `sfu` topology a browser has one connection, to the media server, so the
fields keep their names but count people: `peerCount` is the other people
seated in the room and `connectedPeerCount` those of them whose microphone
packets are arriving. `STELLARR_MEDIA.md` ("State in the `sfu` topology")
defines each `transport.media` state for that topology.

The mesh identifies a peer by `userId`, so an account can have only one active
voice session. Joining from a newer tab atomically removes the older
connection from the recipient list and sends it `VoiceSessionReplaced`; the
account's ordinary presence stays multi-tab. The media server keeps the same
rule: at most one media session per account.

## Audio standard v1

- working format of the microphone: 48 kHz, mono;
- observation and speech detection: 10 ms frames;
- Opus: 20 ms packets, in-band FEC on;
- Premium profile: 128 kb/s maximum, 64 kb/s minimum, DTX off;
- Studio profile: 256 kb/s maximum, 96 kb/s minimum, DTX off;
- the speech detector and the level meter observe the microphone. They do not
  mute the track or stop RTP. The input gate is a separate stage of the capture
  graph that uses the same detector: it is on by default and is a user setting.
  It lowers the samples to silence between sentences, after an 80 ms lookahead
  so the start of a word is not clipped, and Opus keeps receiving a continuous
  stream;
- remote microphones have local volume strips and an optional EQ and compressor
  path;
- mute turns off only the microphone; the audio of a shared screen is a
  separate source;
- the microphone and the screen audio have separate sinks and separate Opus
  profiles;
- when a tab is hidden and shown again, working media are not rebuilt; only
  connections that are `disconnected` or `failed` are repaired;
- expired TURN credentials must not reach a new session or a peer that joins
  later; a long call refreshes the credentials before the expiry margin.

The profile parameters are defined once in
`web/src/lib/voice/audioProfiles.ts`. The SDP code,
`RTCRtpSender.setParameters` and the settings UI must read the same model and
not keep their own copies of the numbers.

## Screen-share standard v1

| Profile | Picture limit | FPS | Send ceiling |
| --- | ---: | ---: | ---: |
| Economy | 720p | 15 | 1 Mb/s |
| Balanced (default) | 1080p | 30 | 2.5 Mb/s |
| Sharp | 1440p | 30 | 5 Mb/s |
| Ultra | 2160p | 60 | 12 Mb/s |

- the limits apply both to `getDisplayMedia` and to the active track;
- changing the profile during a share does not reopen the picker and does not
  need SDP renegotiation;
- VP9 is preferred, then AV1, VP8 and H.264; fallback codecs are not removed;
- `contentHint=detail` and `maintain-resolution` protect the legibility of
  text;
- VP9 uses two or three temporal layers. An older WebRTC stack gets an
  automatic fallback without `scalabilityMode`;
- the picture has medium network priority and Opus has high priority, so
  congestion lowers the stream first instead of damaging the call;
- the bitrates are ceilings. The browser's congestion control still decides
  the actual rate;
- in the mesh topology the bitrate is sent separately to each remote
  participant. In the `sfu` topology it is sent once, and the media server
  forwards the same stream to every receiver; it does not yet adapt it to a
  receiver on a weak downlink.

The source of truth for the profiles is `web/src/lib/voice/screenShare.ts`.

## Camera standard v1

- the camera is part of `VoiceClient`, not a separate UI adapter;
- capture is video only, so sound always comes from the controlled microphone
  pipeline;
- the default profile is at most 1280×720, 30 fps and 1.5 Mb/s per peer; the
  other two profiles are 854×480 at 24 fps and 0.7 Mb/s, and 1920×1080 at
  30 fps and 3 Mb/s;
- `contentHint=motion` and `maintain-framerate` protect the smoothness of a
  face;
- `cameraStreamId` and `screenStreamId` separate the roles of the tracks
  independently of the order of SDP, tracks and state frames;
- changing the device uses `replaceTrack` and updates the msid without leaving
  the call;
- a denied permission or an unplugged device does not drop the audio;
- turning the camera off, leaving the call and dispose always stop the track.

The source of truth for camera capture and encoding is `web/src/lib/voice/camera.ts`.

## Module boundaries

| Responsibility | Source of truth |
| --- | --- |
| wire version, signal kinds, payload codecs | `web/src/lib/rtc/protocol.ts`, `server/Stellarr.Api/Realtime/RtcProtocol.cs` |
| UI API | `web/src/lib/voice/types.ts` (`VoiceClient`) |
| session and transport state | `VoiceStateStore` in `web/src/lib/voice/store.ts`, the `VoiceClient` implementation |
| `VoiceClient` implementation, which picks the topology the bootstrap names | `web/src/lib/voice/webrtc.ts` |
| what a topology provides, and the people of a call apart from their connections | `web/src/lib/voice/webrtcTopology.ts` (`CallTopology`), `web/src/lib/voice/webrtcParticipant.ts` |
| browser mesh | `web/src/lib/voice/webrtcMesh.ts`, `web/src/lib/voice/webrtcMeshHealth.ts` |
| client of the `sfu` topology: the media session, negotiation and replacement; the directory; the state table | `web/src/lib/voice/webrtcSfu.ts`, `web/src/lib/voice/webrtcSfuDirectory.ts`, `web/src/lib/voice/webrtcSfuHealth.ts` |
| catalogue, trimming and synchronised clips | `web/src/adapters/soundboard.ts`, ASP.NET `SoundboardEndpoints` + `AppHub` |
| arrival sound: choice, 5 s window and cooldown | `web/src/containers/useJoinSound.ts`, ASP.NET `JoinSound` + `AccountEndpoints` + `AppHub` |
| Opus profiles | `web/src/lib/voice/audioProfiles.ts` |
| picture profiles and stream compression | `web/src/lib/voice/screenShare.ts` |
| camera capture | `web/src/lib/voice/camera.ts` |
| microphone capture and DSP | `web/src/lib/voice/micPipeline.ts` |
| speech detector and input gate | `web/src/lib/voice/vad.ts`, `web/public/audio/vad-processor.js` |
| ICE/TURN lifecycle | `web/src/lib/voice/iceSession.ts` |
| control plane | ASP.NET `AppHub` |
| topology switch, media sessions and the control API client of the `sfu` topology | in `server/Stellarr.Api/Realtime/`: `MediaTopology` (the switch), `AppHub.Media.cs` (the hub leg), `PresenceTracker` (a seat and its session), `MediaPlane`, `MediaControlClient`, `MediaEventPump`, `MediaEventOutbox` and `MediaSessionCloser` |
| media server: ICE-lite, DTLS, SRTP, rooms, the directory, negotiation and forwarding | `media/` (Stellarr Media, Rust) |
| NAT traversal | coturn; in the `sfu` topology it relays to the media server |

## Moving from mesh to SFU

`Rtc:Topology` chooses the topology of an instance. The `sfu` topology, defined
in [`STELLARR_MEDIA.md`](./STELLARR_MEDIA.md), changes neither the components
nor the public `VoiceClient`. Against the mesh it:

1. fetches the bootstrap with `topology: "sfu"` and `mediaServer`;
2. keeps the same session states, errors and diagnostics, with the counters of
   the state model counting people;
3. replaces N peer connections with one connection to Stellarr Media;
4. forwards Opus and the video codecs without decoding, mixing or transcoding
   them;
5. handles RTCP feedback (NACK, RTX, transport-wide congestion feedback and
   keyframe requests) per connection in the media server, which reports
   per-session counters on its control API; the operator panel does not show
   them yet;
6. stays on protocol version 1. The version is raised only when v1 cannot be
   extended compatibly.

The mesh client stays in the code base, and `mesh` stays the default until the
first gap that `STELLARR_MEDIA.md` lists under "Not in this version", adapting
a stream to a slow receiver, is closed.

## Quality gate before release

Every RTC change must pass:

1. tests of the envelope and payload codecs and of rejecting a wrong version;
2. tests of perfect negotiation, the ICE queue and bounded recovery;
3. a test of the start of a short utterance: neither the speech detector nor
   the input gate may clip the first syllable;
4. a two-account test through the domain: bytes and packets sent and received
   on both sides;
5. a forced-TURN test from another network, including the relay ports;
6. switching tabs or sleeping and coming back without dropping healthy media;
7. screen share start and stop, renegotiation, and no doubled audio;
8. local and remote camera, device change, a denied permission, and independent
   recognition of the camera and the screen;
9. `typecheck`, the web tests, the .NET tests, the media server's checks
   (`cargo fmt --check`, clippy without warnings and `cargo test`), the image
   build and the container health check.

A change to the `sfu` topology must also pass the gate in
[`STELLARR_MEDIA.md`](./STELLARR_MEDIA.md) ("Quality gate"); there the
two-account test also shows that the two browsers have no candidate pair
between them, and the forced-TURN test ends the relay at the media server.

A change is not considered done only because the hub lists the participants or
the UI shows "Connected". The media criterion is two-way RTP traffic and the
transport state.
