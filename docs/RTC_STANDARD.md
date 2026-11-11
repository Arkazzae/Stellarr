# Stellarr RTC v1

Status: **binding base contract**  
Wire protocol version: **1**  
Default topology: **mesh**  
Optional topology: **sfu** (via Stellarr Media; see [`STELLARR_MEDIA.md`](./STELLARR_MEDIA.md))

This document specifies the versioned boundary between the web UI, `VoiceClient`, the SignalR control plane, and the media transport layer. Both `mesh` and `sfu` topologies implement this contract; [`STELLARR_MEDIA.md`](./STELLARR_MEDIA.md) defines the `sfu`-specific additions.

## Architecture layers

```text
UI / React components
    |
    v
VoiceClient + VoiceState             public client API
    |
    +-- session / lifecycle          join, leave, mute, resume, recovery
    +-- capture                      microphone, camera, screen, system audio
    +-- processing                   echo cancellation, leveler, noise suppression
    |                                (RNNoise, GTCRN, Speex), input gate
    +-- observation                  VAD, audio levels, quality telemetry
    +-- codec                        Opus / video codecs
    +-- media transport              ICE, DTLS, SRTP, RTP/RTCP
    |
    v
RTC protocol v1 over SignalR         versioned control plane
    |
    +-- mesh (default): peer-to-peer between browsers
    `-- sfu: single peer connection to Stellarr Media
```

UI components interact exclusively with `VoiceClient` and the immutable `VoiceState` snapshot. Components must never import SignalR, `RTCPeerConnection`, audio worklets, or media-server internals directly.

## Bootstrap contract

`GET /api/bootstrap` returns the `rtc` configuration object:

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

- `iceServers` is populated per request with a STUN URL, an HMAC-authenticated TURN URL, and (when `Rtc:TurnsEnabled` is `true`) a `turns:` URL.
- `topology` reflects `Rtc:Topology` (`mesh` or `sfu`).
- `mediaServer` is `""` in `mesh` mode and `udp://<host>:<port>` in `sfu` mode.
- The client validates `protocolVersion` and `topology` before opening media devices and fails with an `unsupported` error if either is unknown. (The parser still accepts legacy `mode` as a fallback for `topology` during v1 migration.)

## Signaling contract

Every `VoiceSignal` message uses the following envelope:

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

- `channelId` identifies an RTC room: either a server voice channel or a two-user direct conversation.
- Clients omit `fromUserId`; `AppHub` populates it from the authenticated session. When `toUserId` is omitted, the hub broadcasts the signal to all other participants in the room.
- The backend validates authentication, channel/conversation access, recipient membership, `protocolVersion`, `kind`, and a 128 KiB payload size limit.
- Occupancy updates (`VoiceParticipantChanged`) for a server voice channel are broadcast to the server; updates for a direct call are sent only to the two participants.
- Declining a direct call (`DeclineDirectCall`) atomically clears room occupancy and sends `DirectCallDeclined` so the caller releases local capture devices.
- Payloads are validated by typed codecs (`web/src/lib/rtc/protocol.ts`):
  - `offer` and `answer`: `{ type, sdp }` with matching SDP type.
  - `candidate`: ICE candidate object, or `null` for end-of-candidates.
  - `state`: `{ muted, screenStreamId, cameraStreamId }` (`cameraStreamId` is optional; absence indicates camera is off).

Breaking changes to the envelope or payload semantics require incrementing `protocolVersion`. Additive optional fields remain on version `1`.

### Hub methods and events

Defined in `web/src/lib/rtc/protocol.ts` and implemented by `AppHub` in `server/Stellarr.Api/Realtime/`:

| Type | Name | Description |
| --- | --- | --- |
| Method | `JoinVoice` | Take a seat in a voice channel or direct call |
| Method | `LeaveVoice` | Leave the current voice seat |
| Method | `SendVoiceSignal` | Relay a `VoiceSignal` envelope to a peer or the room |
| Method | `DeclineDirectCall` | End a ringing/active direct call for both participants |
| Method | `PlaySoundboard` | Schedule a soundboard clip in the room |
| Method | `GetRtcClock` | Return server Unix timestamp in milliseconds |
| Event | `VoiceParticipantChanged` | Room occupancy snapshot: `{ channelId, sequence, participants }` |
| Event | `VoiceSignal` | Relayed `VoiceSignal` envelope |
| Event | `VoiceSessionReplaced` | Account joined voice from a newer browser tab |
| Event | `DirectCallDeclined` | Remote participant declined the direct call |
| Event | `SoundboardPlayed` | Scheduled soundboard clip broadcast |
| Event | `JoinSoundPlayed` | Scheduled arrival sound broadcast |
| Event | `SoundboardChanged` | Server soundboard catalog updated |

Clients ignore any `VoiceParticipantChanged` snapshot whose `sequence` is older than the highest sequence already applied for that room.

In the `sfu` topology, `AppHub` adds `OpenMediaSession`, `SendMediaSignal`, `MediaSignal`, and `MediaSessionClosed` (see [`STELLARR_MEDIA.md`](./STELLARR_MEDIA.md)). In `sfu` mode, `SendVoiceSignal` only accepts `kind: "state"` and rejects `offer`, `answer`, and `candidate`.

### Soundboard synchronization

Soundboard playback uses the SignalR control plane rather than injecting audio into the microphone track:

- `PlaySoundboard(channelId, soundId)` verifies that the caller is seated in `channelId`, checks server membership and permissions, and enforces a 5-second per-user cooldown (when rate limiting is enabled on the server).
- `GetRtcClock()` allows clients to estimate clock offset using half the round-trip time.
- `SoundboardPlayed` broadcasts clip metadata and a shared `startsAtUnixMs` timestamp scheduled 750 ms in the future.
- Each receiver fetches and decodes the audio asset, then schedules the trimmed segment in `AudioContext` (clipping the leading offset if the event arrived late).

### Arrival sound

Users can configure a personal arrival clip (`UserPreferences.JoinSoundId`) from any server they belong to:

- Membership in the clip's source server is verified both when saving preferences and upon `JoinVoice`.
- `JoinSoundPlayed` reuses `SoundboardPlayedDto` with `triggeredByUserId` set to the joining user and `startsAtUnixMs` 750 ms in the future.
- Clips are capped at `JoinSound.MaxSeconds` (5 s) and rate-limited by `JoinSound.Cooldown` (30 s per user; cooldown suppresses the clip without blocking `JoinVoice`).
- `AttachmentAccess` permits downloading a join-sound asset whenever the listener shares a server or direct conversation with the clip's owner.
- The local `joinLeaveSound` user preference mutes both standard join/leave tones and remote arrival clips (`setArrivalsAudible`).

## State model

`VoiceState` separates control-plane signaling state from data-plane media state:

| Field | Values | Meaning |
| --- | --- | --- |
| `transport.signaling` | `idle`, `connecting`, `connected`, `reconnecting`, `disconnected` | SignalR hub connectivity and negotiation readiness |
| `transport.media` | `idle`, `ready`, `connecting`, `connected`, `degraded`, `failed` | Aggregate WebRTC media transport health |
| `peerCount` | `number` | Number of remote participants seated in the room |
| `connectedPeerCount` | `number` | Number of remote participants with active incoming audio |

- `transport.media = ready` indicates the local session is established with no remote peers in the room (`peerCount === 0`).
- `transport.media = degraded` indicates partial connectivity across peers or an unverified/recovering media leg.
- Only one active voice session is permitted per account across tabs. Joining from a second tab atomically replaces the earlier seat and sends `VoiceSessionReplaced` to the previous connection.

## Audio standard v1

- **Capture format**: 48 kHz, mono.
- **VAD and metering**: 10 ms analysis frames; observation never mutes the track or halts RTP transmission.
- **Input gate**: Enabled by default (user-configurable), 80 ms lookahead, 600 ms hold time, attenuates silence between utterances while keeping RTP continuous.
- **Opus encoding**: 20 ms packet time, in-band FEC enabled; bitrate profiles are defined in `web/src/lib/voice/audioProfiles.ts` (Premium default: 64–128 kb/s, DTX off; Studio: 96–256 kb/s, DTX off; Screen audio: 96–160 kb/s stereo).
- **Source separation**: Microphone and screen-share audio use separate tracks, separate Opus profiles, and separate playback sinks. Muting affects only the microphone.
- **Tab visibility**: Hiding and restoring a browser tab never tears down healthy connections; only `disconnected` or `failed` connections trigger repair.
- **TURN credential refresh**: Long-lived sessions refresh TURN credentials before expiration so late joiners and ICE restarts always use valid credentials.

## Screen-share standard v1

| Profile | Max resolution | Max frame rate | Max bitrate |
| --- | ---: | ---: | ---: |
| Economy | 720p | 15 fps | 1 Mb/s |
| Balanced (default) | 1080p | 30 fps | 2.5 Mb/s |
| Sharp | 1440p | 30 fps | 5 Mb/s |
| Ultra | 2160p | 60 fps | 12 Mb/s |

- Profiles are defined in `web/src/lib/voice/screenShare.ts` and applied to both `getDisplayMedia` constraints and `RTCRtpSender` encoding parameters. Switching profiles mid-share updates constraints and sender parameters without re-prompting or renegotiating SDP.
- Codec preference order: VP9 (with 2–3 temporal layers when supported), AV1, VP8, H.264.
- Uses `contentHint = "detail"` and `degradationPreference = "maintain-resolution"`.
- Video senders use `medium` network priority while Opus audio uses `high`.

## Camera standard v1

- Managed directly by `VoiceClient` (`web/src/lib/voice/camera.ts`), capturing video only.
- Profiles:
  - **Low**: 854×480 @ 24 fps, 0.7 Mb/s
  - **Standard (default)**: 1280×720 @ 30 fps, 1.5 Mb/s
  - **High**: 1920×1080 @ 30 fps, 3.0 Mb/s
- Uses `contentHint = "motion"` and `degradationPreference = "maintain-framerate"`.
- `cameraStreamId` and `screenStreamId` in the `state` signal distinguish camera and screen tracks regardless of SDP m-line ordering.
- Switching camera devices uses `RTCRtpSender.replaceTrack` without renegotiating the call. Camera errors or permission denials never interrupt voice audio.

## Module boundaries

| Area | Source files |
| --- | --- |
| Wire protocol & payload codecs | `web/src/lib/rtc/protocol.ts`, `server/Stellarr.Api/Realtime/RtcProtocol.cs` |
| Public client contract | `web/src/lib/voice/types.ts` (`VoiceClient`, `VoiceState`) |
| State store | `web/src/lib/voice/store.ts` (`VoiceStateStore`) |
| Topology dispatcher | `web/src/lib/voice/webrtc.ts`, `web/src/lib/voice/webrtcTopology.ts`, `web/src/lib/voice/webrtcParticipant.ts` |
| Mesh implementation | `web/src/lib/voice/webrtcMesh.ts`, `web/src/lib/voice/webrtcMeshHealth.ts` |
| SFU client implementation | `web/src/lib/voice/webrtcSfu.ts`, `web/src/lib/voice/webrtcSfuDirectory.ts`, `web/src/lib/voice/webrtcSfuHealth.ts` |
| Soundboard & arrival sounds | `web/src/adapters/soundboard.ts`, `web/src/containers/useJoinSound.ts`, `SoundboardEndpoints.cs`, `JoinSound.cs`, `AppHub.cs` |
| Opus, screen, and camera profiles | `web/src/lib/voice/audioProfiles.ts`, `web/src/lib/voice/screenShare.ts`, `web/src/lib/voice/camera.ts` |
| Microphone DSP & VAD | `web/src/lib/voice/micPipeline.ts`, `web/src/lib/voice/vad.ts`, `web/public/audio/vad-processor.js` |
| ICE/TURN credential lifecycle | `web/src/lib/voice/iceSession.ts` |
| Backend control plane & SFU broker | `server/Stellarr.Api/Realtime/`: `AppHub.cs`, `AppHub.Media.cs`, `MediaTopology.cs`, `PresenceTracker.cs`, `MediaPlane.cs`, `MediaControlClient.cs`, `MediaEventPump.cs`, `MediaEventOutbox.cs`, `MediaSessionCloser.cs` |
| Rust SFU media server | `media/` (`stellarr-media`) |

## Quality gate

Every RTC change must pass:

1. Unit tests for signaling envelopes, payload codecs, and protocol version validation.
2. Tests for perfect negotiation, ICE candidate queuing, and bounded session recovery.
3. Speech onset verification confirming VAD and the 80 ms lookahead gate do not clip initial syllables.
4. Two-client end-to-end call verification confirming bidirectional RTP packet and byte counters advance.
5. Forced-TURN relay verification across networks (`49160-49200/udp`).
6. Tab visibility and suspend/resume checks confirming healthy peer connections are not dropped.
7. Screen-share start/stop, profile switching, and audio isolation checks.
8. Camera start/stop, device hot-swap, permission denial handling, and independent stream-ID mapping alongside screen sharing.
9. All automated checks: `npm run typecheck`, `npm test` (`web` and `cockpit`), `dotnet test`, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, and container build/health checks.
