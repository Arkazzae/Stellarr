# RTC and ports

## Host ports

| Default port | Protocol | Process | Purpose |
| --- | --- | --- | --- |
| `8888` | TCP | Nginx | HTTP, redirects to HTTPS |
| `8443` | TCP | Nginx | the application over HTTPS, the API and SignalR/WebSocket |
| `3478` | UDP and TCP | coturn | STUN and TURN without TLS |
| `5349` | UDP and TCP | coturn | TURN over TLS |
| `49000` | UDP | Stellarr Media | the single port of the media server: every call in the `sfu` topology; bound but idle in the mesh topology |
| `49160-49200` | UDP | coturn | relay ports that TURN hands out to clients |

The port set in `STELLARR_HTTPS_PORT` is also used in the HTTP to HTTPS
redirect. With the default setup the redirect therefore leads to `:8443`; with
`STELLARR_HTTPS_PORT=443` the port is left out of the address. A request that a
TLS proxy in front of the container forwards with `X-Forwarded-Proto: https` is
not redirected again.

`STELLARR_TURN_PORT` changes both the published host port and the STUN/TURN
port advertised to the browser. `STELLARR_TURNS_PORT` sets the public port of
encrypted TURN/TLS in the same way (default `5349`); the backend advertises it
as `turns:...?...transport=tcp`. The host port of `49000/udp` is
`STELLARR_MEDIA_PORT`, and like the TURN port it is also the advertised one:
the media server puts it into its candidates and the API names it in the
bootstrap's `mediaServer`. The router must therefore forward the same external
port to it.

The compose file sets `Rtc:TurnsEnabled=false` by default and does not advertise
`turns:`, because the self-signed certificate the container generates is not
trusted by browsers. TURNS can be enabled with `STELLARR_TURNS_ENABLED=true`
only after a certificate from a publicly trusted authority has been placed in
the TLS directory of the data volume (`/data/stellarr/tls/fullchain.pem` and
`privkey.pem`).

The relay range covers 41 ports. The compose file advertises only TURN/UDP by
default (`STELLARR_TURN_TCP_ENABLED=false`): a full mesh of five people then
needs about 20 allocations instead of about 40 for UDP and TCP at the same time.
In the `sfu` topology a browser has one connection instead of one per other
person, so it takes one allocation per advertised TURN transport: five people
need about 5. That relay ends at the media server's address inside the same
container, so it needs no port beyond the relay range. The range is
`min-port` and `max-port` in `infra/turnserver.conf.template`, repeated in the
`ports` of `docker-compose.yml` and in the `EXPOSE` line of the `Dockerfile`. Before enabling TURN/TCP or raising the number of participants,
widen it in all three places and forward the wider range on the host and the
router.

A disabled transport is removed from coturn as well as from the bootstrap: the
container sets `no-tcp`, `no-tls` and `no-dtls` in `/etc/turnserver.conf`. An
older open tab therefore cannot keep reserving ports through an ICE list
remembered from before the deployment.

## Services reachable only inside the container

| Port | Service |
| --- | --- |
| `3000/tcp` | Next.js standalone |
| `5000/tcp` | ASP.NET Core API and SignalR |
| `9000/tcp` | RustFS S3 API |
| `5200/tcp` | Stellarr Media control API, on `127.0.0.1`; only the API calls it, with the bearer secret from `secrets/media-control-secret` |

Compose does not publish these ports. Nginx passes `/api/`, `/assets/`,
`/health`, `/hubs/` and `/.well-known/stellarr/client` to ASP.NET, serves the
operator panel from `/ops/`, proxies `/bergamot-models-gcs/` to the store of
translation models, and sends every other path to Next.js. RustFS is reachable
only through the backend.

## An important distinction

Nginx is the only public HTTP/HTTPS entry point, but it cannot replace the RTC
ports. STUN, TURN and media use UDP or their own TCP, so `3478`, `5349`, the
relay range and `49000` must be exposed independently.

## NAT and firewall

On the router, forward to the Docker host:

- TCP `80/443`, or the external ports chosen for `8888/8443`;
- UDP and TCP `3478`;
- optionally UDP and TCP `5349`;
- UDP `49160-49200`;
- UDP `49000` (or the port set in `STELLARR_MEDIA_PORT`), when the instance
  runs the `sfu` topology.

Set:

```bash
PUBLIC_HOST=chat.example.com
PUBLIC_IP=auto # or a fixed public IPv4
STELLARR_TURN_PORT=3480 # only when 3478 is taken
STELLARR_TURNS_PORT=5349
STELLARR_RTC_TOPOLOGY=sfu # mesh by default
STELLARR_MEDIA_PORT=49000
```

`PUBLIC_HOST` goes into the ICE configuration returned to the client.
`PUBLIC_IP` sets `external-ip` in coturn and must be the address seen from the
Internet. The value `auto` resolves the A record of `PUBLIC_HOST` on every
container start and fails the start if it cannot get a valid IPv4 address; this
prevents advertising a stale relay address.

The media server advertises the same address, with `STELLARR_MEDIA_PORT`,
followed by the container's own address with port `49000`, which is where
coturn relays a browser that needs TURN. Without `PUBLIC_IP` only the container's address is
left: a browser outside the host then reaches the media server only through
TURN, and not at all when TURN is blocked as well. The container prints a
warning at start when the topology is `sfu` and `PUBLIC_IP` is empty. On a
network without a public address, set `PUBLIC_IP` to the address the browsers
reach the host at.

For signed-in users the backend issues one-hour TURN credentials generated with
an HMAC. The container keeps only the shared coturn secret, and the client
never receives a permanent server password.

## The current RTC layer

[`RTC_STANDARD.md`](./RTC_STANDARD.md) defines the semantics and the versioning
rules of the layer. This document stays the network and operations guide.

Signalling runs through `AppHub`. The topology decides where media travel. In
the mesh topology, the default, they travel over direct connections between
browsers. In the `sfu` topology every browser has one connection to Stellarr
Media, the media server in the container, which forwards the packets to the
rest of the room without decoding them; it is defined in
[`STELLARR_MEDIA.md`](./STELLARR_MEDIA.md). No third-party media platform is
involved in either, so capture, ICE, TURN, Opus, muting and speech detection
stay observable without hiding their behaviour under a ready-made platform.

Stellarr Media listens on `49000/udp` in both topologies and stays idle in the
mesh topology. It forwards every kind from its first version: microphone,
camera, screen picture and screen sound. What it does not do yet, such as
adapting a stream to a slow receiver, is listed in `STELLARR_MEDIA.md`, and the
default stays `mesh` until the first of those gaps is closed. The `VoiceClient`
contract on the web side isolates the interface from the topology.

## Opus, noise suppression and detection

In Chromium, Opus is the right codec for calls: the WebRTC profile requires it,
and it gives much better speech quality than the fallback G.711. Stellarr adds
neither AAC nor a codec of its own in JavaScript, because that would break
interoperability between browsers and bypass their network-aware jitter buffer
and congestion control.

The current version offers five microphone profiles and one for screen audio:

| Profile | Opus ceiling | Adaptation minimum | Channels | DTX | FEC | Packet time |
| --- | ---: | ---: | --- | --- | --- | ---: |
| Economy | 32 kb/s | 16 kb/s | mono | yes | yes | 20 ms |
| Balanced | 64 kb/s | 24 kb/s | mono | no | yes | 20 ms |
| Clarity | 96 kb/s | 32 kb/s | mono | no | yes | 20 ms |
| Premium (default) | 128 kb/s | 64 kb/s | mono | no | yes | 20 ms |
| Studio | 256 kb/s | 96 kb/s | mono | no | yes | 20 ms |
| Screen audio | 160 kb/s | 96 kb/s | stereo, when the peer accepts it | no | yes | 20 ms |

The browser still performs the fast congestion control. Stellarr only moves the
bitrate ceiling slowly, from smoothed packet loss and round-trip time, with
hysteresis so the quality does not jump. FEC stays on. DTX switches off the
transmission of silence only in the deliberately economical profile; the
quality profiles transmit continuously, so a detector inside the encoder never
decides where a syllable begins.

Noise reduction has five modes: the browser's own, off, and three that run
locally as WASM in an `AudioWorklet`: RNNoise, GTCRN and Speex. RNNoise is the
default for a new user, and an explicit saved choice still takes precedence.
GTCRN handles keyboards, eating and sudden sounds better at a higher CPU cost;
Speex is a classic DSP filter, the lightest and the weakest. The worklets and
WASM binaries are copied from the npm package into `web/public/audio/` at build time
(`web/scripts/copy-audio-assets.mjs`) and shipped in the image; nothing depends
on a CDN. If a suppressor cannot start, the path tries to fall back to the
browser's reduction and shows the degraded state explicitly.

The speech detector runs on the audio thread. It has an adjustable
sensitivity, a noise-floor estimate, hysteresis, a hangover, and a separate
detection of short impulses based on the rise in level and the peak/RMS ratio.
A series of keyboard or controller clicks does not open detection and cannot
use the hangover of the previous utterance. It analyses 10 ms frames, finishes
its warm-up after 120 ms, and has a separate, faster adaptation to constant
noise so that the indicator does not stay stuck on "speaking".

The detector itself never touches the sent samples. The input gate does, using
its decision. It is on by default and can be turned off in the settings. The
gate delays the output by an 80 ms lookahead, so when it opens it reaches back
to the start of the word, and between sentences it lowers the signal to
silence. An onset needs a pitch between 60 and 400 Hz (only the top of the
sensitivity dial drops this requirement), and an open gate closes after 600 ms
without a voiced frame. The track and RTP keep running, and Opus sees a
continuous stream.

Automatic volume is the pipeline's own leveller, not the platform's AGC. It
learns the level only from frames that the detector marked as voiced, so it
never raises the room between sentences. The browser's AGC is used only when the
capture graph cannot be built. A fixed gain from −12 to +24 dB sits in front of
the whole chain.

The local device and processing settings are stored separately for each account
identifier. An older shared entry is assigned once to the account that is active
during the migration, so switching users in the same browser does not inherit
another person's microphone, output or voice profile.

Remote microphones can be played through the native Web Audio EQ and a
compressor with automatic make-up gain. The options are Off, the presets
Natural, Studio and Broadcast, and the Custom profile with ±12 dB of control
over the bands at 160 Hz, 360 Hz, 3.1 kHz and 8 kHz; a per-person volume of
0–200% is available as well. Everything works on the receiving side only. The
audio of a shared screen bypasses the voice correction. If Web Audio is
unavailable, the client keeps the direct path through the `<audio>` element and
does not interrupt the call.

The speaker test in the settings plays a local voice sample in a loop through the
same EQ and compression profile, the current volume and the chosen output
device. This lets you tune the profile without a second person.

The current audio path:

1. `getUserMedia` at 48 kHz and mono for the microphone.
2. A fixed input gain.
3. An optional suppressor (RNNoise, GTCRN or Speex) in an `AudioWorklet`, or the
   browser's native processing.
4. The input gate and the leveller, driven by the speech detector; the level
   meter and the speaking ring read the same detector on a separate monitor
   stream, off the main interface thread.
5. Opus with FEC, continuous transmission in the quality profiles, and the
   bitrate profile.
6. A local mixer, EQ and compressor for remote microphones.
7. A smoothed ceiling adaptation from `RTCRtpSender.getStats()` and
   `setParameters()`.
8. RTP/SRTP over the WebRTC mesh, or over one connection to Stellarr Media in
   the `sfu` topology.

Screen sharing has four persistent profiles, from 720p15 at 1 Mb/s to 2160p60
at 12 Mb/s. The default 1080p30 stays limited to about 2.5 Mb/s. VP9 is
preferred for compressing a desktop, temporal layers let frames be dropped on
a worse link, and the picture has a lower priority than the voice. In the mesh
each receiver uses a separate send stream, which has to be taken into account
for the Ultra profile. In the `sfu` topology the publisher sends one stream and
the media server forwards it unchanged to every receiver, also to one on a weak
downlink.

## Diagnostics

When voice does not work, check in this order:

1. Whether the application runs in a secure HTTPS context.
2. Whether the browser has the microphone permission.
3. Which topology `GET /api/bootstrap` reports in `rtc.topology`.
4. Whether `3478/udp` (or the port set in `STELLARR_TURN_PORT`) answers from
   the user's network.
5. Whether `PUBLIC_IP` matches the real public IP of the host.
6. Whether the firewall lets `49160-49200/udp` through.
7. Whether both users receive `VoiceSignal` events through `/hubs/app`.

In the `sfu` topology, also:

8. Whether `49000/udp` (or the port set in `STELLARR_MEDIA_PORT`) is forwarded
   to the host on the same external port.
9. Whether the container log shows the `media` program running, and no warning
   about an empty `PUBLIC_IP`.
10. Whether both users receive `MediaSignal` events through `/hubs/app`.
11. Whether the media server lists both sessions as `connected`, with growing
    `ingress` and `egress` counters. Inside the container:

    ```bash
    curl -s -H "Authorization: Bearer $(cat /data/stellarr/secrets/media-control-secret)" \
      http://127.0.0.1:5200/v1/stats
    ```
