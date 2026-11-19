# Voice processing record

A record of what the web client's audio processing does today, made before it
is rewritten, so that the rewrite can be held to the same sound:

- **capture**: the speech detector, the input gate and the leveller of the
  detector worklet (`web/src/stellarr/lib/voice/capture/detector/`, built
  into `/audio/detector-worklet.js`), as the app builds them
  (`capture/captureGraph.ts`, `capture/gateNode.ts`, `capture/vad.ts`);
- **playback**: each remote participant's strip of Web Audio nodes
  (`playback/remoteMixer.ts`, `playback/remoteStrip.ts`,
  `playback/playbackProfile.ts`), for every playback profile;
- **suppressor**: the noise suppressors, Speex, RNNoise and GTCRN
  (`capture/speex/`, `capture/rnnoise/` and `capture/gtcrn/`, built into
  `/audio/speex-worklet.js`, `/audio/rnnoise-worklet.js` and
  `/audio/gtcrn-worklet.js`, with the binaries from `artifacts/recipes/speex/`,
  `artifacts/recipes/rnnoise/` and `artifacts/recipes/gtcrn/`).

How the microphone is opened and what the browser does to it
(`micAcquire.ts`, `browserProcessing.ts`, `micPipeline.ts`, the microphone
constraints) is left out on purpose: it is not being preserved. So is the
fixed input gain.

## Checks

| What | Command | Time |
| --- | --- | --- |
| Capture record | `npm run test:web` (three files in `src/stellarr/lib/voice/characterization/`) | about 1.2 s and 3.7 s of CPU, the three files side by side, on a 10-core arm64 Mac |
| Playback record | `npm run bench:voice-playback -w stellarr-web -- --check` | about 5 s, 2 s of it rendering |
| Suppressor record | `npm run test:web` (`src/stellarr/lib/voice/characterization/suppressorRecord.test.ts`) | about 2 s |

Recordings in `recordings/` add their own time: the five synthetic voices
described below, 97 s of audio, add about 3.4 s to `test:web`.

The playback check needs Chrome, found as the transcript benchmark finds it
(`STELLARR_CHROMIUM`, `CHROME`, or a usual install path). In CI it is one more
step in the web job:

```sh
STELLARR_CHROMIUM="$chrome" npm run bench:voice-playback -w stellarr-web -- \
  --check --out "$RUNNER_TEMP/voice-playback.json" --summary "$RUNNER_TEMP/voice-playback.md"
```

Pass or fail, it prints the Chrome the record was made with and the one it
ran in, and for each kind of measurement the largest difference it found, the
tolerance, and where; `--summary` writes the same as Markdown, which CI adds
to the job's summary. `--measured <file>` keeps the run's own measurements in
the record's format, to compare with the record line by line.

## Re-recording

```sh
npm run voice:record -w stellarr-web
```

This rewrites `records/capture/*.txt` and `records/suppressor/*.txt` through
Vitest and
`records/playback.txt` from five separate Chrome runs. **It is legitimate only
in a commit whose message names the audible change it intends**, such as
"the gate releases 20 ms later" or "the studio profile loses 1 dB at 3 kHz".
A rewrite that is meant to sound the same must pass the checks without it. Read
the diff of `records/` before committing: every line that moved is a change
someone will hear or see.

Two other things also move the records, and neither is a change in sound:

- an edit to `fixtures.ts` changes the test audio. The fixture's own test
  ("is the audio its record was made from") fails first and names the digest;
  re-record in the same commit and say that the fixtures changed;
- a new Chrome may render the playback strips differently. The check prints
  the Chrome the record was made with next to the one it ran in.

## The fixtures

Made by `fixtures.ts` from a seed, at 48 kHz, nothing downloaded. Speech is a
small formant synthesiser (a band-limited sawtooth with a falling pitch line
and accents, five resonators gliding between vowels, consonants in front of
syllables: s, sz and f frication, plosive bursts after a closure, nasals,
with word gaps and phrase pauses). Every length is a multiple of 80 ms, a whole
number of render quanta and of 10 ms analysis frames.

| Fixture | Length | What it exercises |
| --- | --- | --- |
| `speech` | 6.72 s | A talker at -26 dBFS, pauses of 300 and 800 ms: onset, lookahead, hangover across words and the short pause (but not at the strict end of the dial), release in the long pause, the leveller lifting the voice. |
| `talker-quiet` | 6.40 s | A soft high voice at -44 dBFS: the absolute floor the dial moves, the leveller climbing at 6 dB/s to its +18 dB ceiling. |
| `talker-loud-after-quiet` | 4.48 s | A quiet phrase, then a shout whose loudest sample is -1 dBFS: the peak guard, the 40 dB/s fall, the 6 dB cut limit, and whether the cut lands while the loud samples are still in the gate's delay line. |
| `clipping` | 4.48 s | Speech driven 20 dB into hard clipping, then samples past full scale (to 1.6): the clamps in the analysis and what the gate passes of samples over 1. |
| `cold-start` | 3.84 s | Speech from the first sample: the 120 ms warm-up learns the voice as if it were the room. |
| `silence` | 1.92 s | Digital zero, then -85 dBFS self-noise: zeros teach the floor nothing; the meter rests at zero. |
| `whisper` | 3.84 s | Whispered phrases at -40 dBFS, no pitch: only the top of the dial lets them count. |
| `keyboard` | 2.56 s | Typing at 4-8 keys a second, peaks near -10 dBFS: the transient and voicing tests. |
| `speech-clicks` | 5.12 s | Clicks 30 ms after a word, 150 ms into a pause (must close the held gate), and typing through a long pause. |
| `breath-chewing` | 3.84 s | An inhale, chewing at speech level and an exhale, no voice: only the voicing requirement keeps the gate shut; the leveller learns nothing. |
| `speech-crunching` | 3.84 s | A phrase running straight into two seconds of crunching: only the unvoiced limit (600 ms) closes the gate. |
| `buzz` | 3.84 s | A 100 Hz transformer buzz after 800 ms of quiet: pitched and steady, so only the stationary-noise rule closes the gate. |
| `mains-hum` | 3.84 s | 50 Hz mains hum with a strong 100 Hz after 800 ms of quiet: pitched, but its energy alternates between 10 ms frames. |
| `fan-speech` | 5.12 s | A fan switching on during a phrase and staying, a second phrase over it: the unvoiced limit, the stationary rule at the top of the dial, speech 14 dB over a fan. |
| `speech-over-fan` | 4.48 s | A voice only 8 dB over a fan running from the first sample: onsets sit on the on-threshold, so the decisions depend on it everywhere on the dial, the remote meter's default included. |
| `fan` | 4.48 s | The fan alone from the first sample: steady noise and nothing else, for the suppressors. The capture record does not use it. |

The playback record uses its own signals, generated in the page: a 31-tone
multitone (third octaves from 20 Hz to 20 kHz), 1 kHz tones at fixed levels
and a 1 kHz tone stepping from -40 to -6 dBFS and back. It also plays the app's
own `public/sounds/voice-playback-test.mp3`, decoded by Chrome, which the
detector treats as speech (it opens eight times and the leveller learns from
it).

## The capture record

`capture/worklet.ts` evaluates the worklet's entry,
`capture/detector/processor.ts`, in a scope that has `AudioWorkletProcessor`,
`registerProcessor` and `sampleRate`, keeps the class it registers, and
drives it as the browser would: render quanta of 128
frames, one mono input, one output, messages from the main thread delivered
between quanta, `postMessage` calls collected with the quantum they were made
in. `capture/app.ts` takes each node's options from the app's own code:
`buildCaptureGraph` for the microphone (gate, leveller or both, as the
settings choose), `SpeechDetector` for the local meter and for a remote
participant, `buildGateNode` at `REMOTE_GATE_SENSITIVITY` for a gated remote
strip. Messages the app posts later (`config` when the dial moves, `stop` on
teardown) are delivered as the app sends them.

Configurations, for every fixture: the meter, the gate, the leveller and both,
at sensitivity 0, 60 (the default) and 100; the meter at 85 (the one place the
voicing requirement is partial); a remote participant's meter; the receiver's
gate at 40. On `speech`, the meter and gate+leveller also run with the dial
moved to 100 at 1.4 s and 0 at 3.0 s, and the call ended at 5.6 s.

Each run is written as (all measured from outside the processor):

| Line | What |
| --- | --- |
| `posts` | every message posted to the main thread, at the end of its render quantum in ms; `+` speaking, `-` not, then the meter level in eighths |
| `speech` | the stretches between a `+` and the next `-` |
| `gain` | per 10 ms of output, RMS(out) / RMS(input delayed by the configuration's latency) in dB; `x` closed (below -60 dB), `-` nothing to measure against, `!` output with no input; `v*n` is n blocks of v, `a>b*n` a straight ramp |
| `peak` | the largest output sample in dBFS, and how many went past 0.95 and past 1 |
| `out none` | the configuration writes no output (the meter) |
| `stopped` | when `process()` first returned false |

`records/capture/index.txt` holds each configuration's latency, measured by
cross-correlation on a probe (white noise while the gate is held open). The
check compares posts, speech and stops exactly, gains within 0.1 dB (the
encoding rounds to at most 0.06 dB), peaks within 0.05 dB and the counts past
0.95 and 1 within 2 samples or 1%. The record was made with Node 26 on
macOS arm64, and repeated runs there are identical. Whether Linux x64 gives
the same digits was not measured: the first CI run is that test. If a
fixture's digest differs there, the generator's arithmetic differs, not the
detector. The playback check also renders `speech` through Chrome's own
AudioWorklet and requires the same gains and the same messages in the same
order, which is what shows that this driver runs the processor as the
browser does.

## The playback record

`playback/render.ts` builds each strip with `RemoteVoiceMixer` itself
(`attachElement`, which mounts a `RemoteStrip` and applies the profile and the
volume immediately, and `setGate`) on an `OfflineAudioContext` at 48 kHz. An
offline context has no `createMediaStreamDestination` and no media element, so
for the length of the build the context object gets two methods: the
destination becomes a gain node feeding the rendered output, and the element
source becomes a buffer source with the test signal. `window.AudioContext`
returns that context while the mixer is made. Nothing else is replaced.

Strips: every profile at 100%; custom tunings flat, bright and extreme at
100%; studio at 50, 150 and 200%; off at 50 and 200%. For each:

| Line | What |
| --- | --- |
| `latency` | samples from input to output, from cross-correlation on -50 dBFS noise |
| `response-low` | gain at 31 third-octave frequencies, multitone at -60 dBFS RMS (under every threshold) |
| `response-hot` | the same at -20 dBFS RMS, where the compressor and limiter work |
| `curve` | output against input level for a 1 kHz tone, dBFS of the tone's peak, steady state |
| `attack`, `release` | output envelope per ms around a -40 to -6 dBFS step and back, aligned by the latency |
| `settle`, `overshoot` | ms to settle within 1 dB after each step; dB the attack overshoots |

Then: the studio strip with the receiver's gate over `speech`; the app's
sample through each profile (`level`: RMS, peak and the 50th, 90th and 99th
percentile of 50 ms blocks); the sample through the capture node in Chrome.

Chrome's compressor is its own implementation, so the playback record is held
to tolerances. The record writes down four times the largest spread seen
across the separate Chrome runs it was made from; the check applies that, but
never less than a floor in `playback/compare.ts`. On one machine runs agree to
the last digit, so the floors are what is in force, and they are set by what
differs between platforms. Against the record, made on macOS arm64 with
Chrome 155, Linux gave measurements identical to the digit with the record's
own Chrome 155 on x64, with Chrome 157 on x64 (the CI runner's) and with
Debian's Chromium 156 on arm64. What differed is the platform, not the
processor or the Chrome version:

| Kind | Largest difference on Linux | Floor |
| --- | ---: | ---: |
| latency | 0 samples | 0 samples |
| frequency response | 0.01 dB | 0.05 dB |
| output against input level | 0.01 dB | 0.1 dB |
| envelope, per 1 ms block | 0.26 dB (the release of the `off` strips) | 0.6 dB |
| envelope area after the step | 4.2 dB·ms | 10 dB·ms |
| settling time | 2 ms | 5 ms |
| overshoot, levels of the sample | 0 dB | 0.1 dB |
| gains of the gated strip and the capture node | 0 dB | 0.25 dB |

An envelope is compared block by block in level, without a tolerance in
time: offline rendering is sample-accurate, every step landed on the same
block on every platform, and the differences were levels on the flat part of
a release, so a block matching its neighbour would have hidden little of
them and would loosen the check exactly at the steps, where attack and
release changes show. Because a release a few per cent slower moves no single
block far, the check also compares each envelope's area: the sum, from the
step on, of how far the output sits from the level it ends at. Lengthening the
studio compressor's release by 10 ms moved no block by more than 0.2 dB but
moved that area by 40 dB·ms. The smallest change the check was tried against,
moving the presence bell from 3100 to 3200 Hz, moves the natural profile's
response by 0.06 dB and the studio profile's by 0.19 dB.

## The suppressor record

`suppressor/record.ts` drives the binary the browser is served,
`web/public/audio/speex.wasm` (assembled from the recipe's output, see
`artifacts/recipes/README.md`), through the worklet's own wrapper,
`capture/speex/preprocessor.ts`, one render quantum at a time, as the
processor does: `speech`, `speech-over-fan`, `fan-speech`, `fan`, `keyboard`,
`buzz`, `silence` and `clipping`. `records/suppressor/speex.txt` holds, for
each, a digest of the int16 samples the binary is given and of those it gives
back, and the gain per 10 ms and the peak in the capture record's notation;
its header holds the frame, the latency measured on the probe, and every
setting of the preprocessor as a new state reports it.

`records/suppressor/rnnoise.txt` is the same for `web/public/audio/rnnoise.wasm`
through `capture/rnnoise/denoiser.ts`, on the same fixtures, with two
differences: its output digest is taken over the float bits the binary
returns, not over int16 values, and its latency (1408 samples) is measured on
a talker, because RNNoise removes the probe's white noise. The fixtures are
synthetic speech, which the network takes for noise and attenuates by 20 to
40 dB at the top of the band, so the record pins what the binary does and
says nothing about how it treats a voice; `--quality` below does that.

`records/suppressor/gtcrn.txt` is the same for `web/public/audio/gtcrn.wasm`
through `capture/gtcrn/denoiser.ts`: float-bit output digests and a latency
measured on a talker (1530 samples), because GTCRN removes the probe's noise
as well. It is all float, so a sample past full scale goes in as it is, as it
did in the published worklet.

WebAssembly's arithmetic is the same on every machine, so the output is held
exactly: any change in what the binary puts out fails, however small, and the
gains and the peak say where and by how much. A new toolchain, a new SpeexDSP
commit or an edit to the wrapper that is meant to sound the same must pass
without re-recording. An input digest that moved means the fixture changed,
and is reported as that.

Speex runs as it always has here, odd parts included: 128-sample frames (2.7
ms at 48 kHz, where SpeexDSP's time constants assume 20 ms), denoise on and
every other setting at the library's default (the record's header lists
them), and samples moved to int16 as `x * 32767` stored into an `Int16Array`,
which truncates towards zero, and back as `/ 32767`. One thing was changed on
purpose: a sample past full scale is clamped to the int16 range before it is
stored, where the engine it replaced let the store wrap it to the other sign.
Only the `clipping` fixture reaches past full scale, and only its run moved
when the record was rewritten for the clamp.

## Comparing a suppressor with an earlier build

```sh
npm run bench:voice-suppressor -w stellarr-web -- --engine speex --before <git revision>
npm run bench:voice-suppressor -w stellarr-web -- --engine rnnoise \
  --before-worklet old/rnnoise-worklet.js --before-wasm old/rnnoise_simd.wasm \
  --quality --mixtures en-daniel-speech.fan10,en-whisper.quiet --write-outputs <dir>
```

The second form is how the RNNoise recipe was judged: `old/` held the
worklet and the SIMD binary of the prebuilt engine, taken from the revision
before the recipe with `git show`.

`suppressor/run.mjs` renders fixtures through one engine twice in Chrome's
`OfflineAudioContext`: as the app starts it now (`attachSuppressor`, the
worklet and the binary from `/audio/`), and as an earlier worklet and binary
started it, taken from a git revision's `artifacts/files/` through its
manifest or from two paths. It aligns the two by the latency each shows on the
probe and prints, per fixture, how many samples differ, the largest
difference, the RMS of the difference in dBFS and in dB against the earlier
output, and the first sample each side sounded on, which shows when an
earlier worklet that compiles its binary asynchronously had not loaded yet.
`--fixtures` picks any of the fixtures above, `--require-identical` fails on
any difference, `--write-outputs <dir>` writes each fixture's input and both
outputs there as 32-bit float WAV files to listen to, and `--out` keeps the
result as JSON.

With `--quality`, talkers (the synthetic ones of `fixtures.ts` and every WAV
in `recordings/`, which stays on the machine that made it) are set to -26
dBFS after two seconds of one of five rooms, mixed with the room, and each
side's output is measured against the clean talker (`suppressor/quality.ts`):
noise removed in the stretches where the talker is silent; SI-SDR, the level,
and the energy above 4 and 8 kHz where it speaks; the level of the first 50
ms of each phrase; and the latency, found by correlation with the talker
because a suppressor removes the probe's noise. `--mixtures` keeps only the
named `<talker>.<room>` mixtures. The recordings are voices a text-to-speech
system made, not people; a synthetic fixture can be taken for noise by a
network trained on real speech, which the printed tables show for RNNoise.

It also checks three things of the current engine: that a talker played
through `attachSuppressor` in a real-time context comes out as sound while
the render thread keeps its pace (and, for RNNoise and GTCRN, what their
construction costs it); that the "destroy" the app
sends when it lets a suppressor go silences the node; and that a 404 for the
binary makes `attachSuppressor` resolve to null. Chrome is started with
`--disable-audio-output`, without which a real-time context does not advance
on a headless Mac. The earlier side shows
whether it heard "destroy" too: the published GTCRN worklet, which GTCRN's
recipe replaced, never did.

Run against the revision before GTCRN was built here, GTCRN comes out
identical, sample for sample, on all eight fixtures, `clipping` included, in
Chrome 158, with a latency of 635 samples on the probe (Speex's is 128,
RNNoise's 1408).
The `fan` fixture, at -40 dBFS, leaves GTCRN at -67 dBFS, Speex at -49 and
the prebuilt RNNoise before its recipe at -72.

The current side needs the recipes built and the binaries assembled, as `npm
test` needs them. Run against the revision before Speex was built here, Speex
comes out identical, sample for sample, on every fixture within full scale:
the same output in Chrome 158 and in Node. On `clipping` the clamp changes
133 905 of 215 040 samples: the largest difference is 2.0, a peak that the
old engine turned over, and the difference is -13.6 dBFS RMS, 1.9 dB below
the old output. The state of the preprocessor carries the change past the
samples themselves, which is why most of the fixture differs a little.

## What the checks were tried against

Each change below was made alone in the product code and undone; the
records were left as they are. "Fixtures" counts the capture fixtures whose
record failed; "playback" is the playback check, where "cross-check" means
Chrome's AudioWorklet no longer matched the capture record.

| Change | Capture record | Playback check |
| --- | --- | --- |
| Hangover of the dial 25+20t → 28+20t frames | 10 fixtures | gated strip, cross-check |
| Gate release 90 → 100 ms | 12 fixtures | gated strip, cross-check |
| Gate attack 6 → 10 ms | 13 fixtures | gated strip, cross-check |
| Gate lookahead 80 → 70 ms | latency index, 14 fixtures | gated strip, cross-check |
| On-threshold of the dial 14-11t → 14.5-11t dB | 5 fixtures | passes |
| Absolute floor of the dial -45-23t → -46-23t dBFS | 6 fixtures | app sample, cross-check |
| Remote default on-threshold 7.5 → 8 dB | `speech-over-fan` only | passes |
| Remote default off-threshold 3.5 → 3 dB | 3 fixtures | passes |
| Remote default hangover 45 → 50 frames | 8 fixtures | passes |
| Remote default absolute floor -68 → -70 dBFS | `talker-quiet` only | passes |
| Voicing needed for an onset 0.6 → 0.62 | 8 fixtures | app sample, cross-check |
| Unvoiced limit 60 → 70 frames | `fan-speech`, `speech-over-fan`, `speech-crunching` | app sample |
| Stationary rule after 90 → 120 frames | `buzz` only | passes |
| A click closes a held gate after 8 → 12 quiet frames | 9 fixtures | gated strip, cross-check |
| Leveller target -20 → -19 dBFS | 10 fixtures | app sample, cross-check |
| Leveller rise 6 → 6.5 dB/s | 14 fixtures | app sample, cross-check |
| Leveller fall 40 → 30 dB/s | 7 fixtures | app sample, cross-check |
| Leveller boost limit 18 → 17 dB | 5 fixtures | app sample |
| Leveller peak ceiling 0.95 → 0.98 | 8 fixtures | cross-check |
| Order: leveller before the gate | 13 fixtures | app sample, cross-check |
| Meter posts every 10 → 12 frames | 15 fixtures | app sample, cross-check |
| Studio high-pass 76 → 80 Hz | passes | response 1.02 dB, envelope 0.90 dB, area 19.7 dB·ms |
| Compressor ratio 1+5a → 1+5.5a | passes | response 0.21 dB, curve 0.20 dB, area 12.8 dB·ms, overshoot |
| Compressor attack 12-9a → 15-9a ms | passes | envelope 3.40 dB, area 10.9 dB·ms, overshoot 0.37 dB, response, gains |
| Compressor release 140+160a → 150+160a ms | passes | area 40.6 dB·ms only |
| Presence bell 3100 → 3200 Hz | passes | response 0.48 dB, curve, area 17.7 dB·ms |
| Limiter threshold -1 → -1.5 dB | passes | response, curve, area 27.3 dB·ms, settling 6 ms, overshoot |
| Limiter attack 2 → 3 ms | passes | envelope 1.20 dB, response 0.17 dB |
| Limiter release 80 → 90 ms | passes | area 15.0 dB·ms, response 0.11 dB |
| Order: limiter before the boost | passes | every kind, by many times its tolerance |
| Playback gain 1.25 → 1.3 | passes | response 0.35 dB, curve 0.34 dB, area 22.7 dB·ms, gains |

The playback figures are against the cross-platform floors above. The
compressor's release is the case the area exists for: under the first floors
only the 2 ms settling tolerance caught it, and settling had to widen to 5 ms
when Linux moved the `off` strips' settling by 2 ms.

The remote meter's defaults were the one gap the first run found: no
fixture put speech close enough to its room for the on-threshold to matter,
which is why `speech-over-fan` exists.

## Real recordings

Put WAV files in `recordings/`. That folder is ignored by git apart from its
`.gitignore`, and so is everything the harness writes there: a voice in a
public repository is not something its owner can take back. Any WAV at 48 kHz
works (16, 24 or 32-bit integer or float, several channels are averaged); to
convert:

```sh
afconvert -f WAVE -d LEI16@48000 -c 1 in.m4a recordings/me.wav   # macOS
ffmpeg -i in.m4a -ac 1 -ar 48000 recordings/me.wav
```

When files are there, both checks run over them too:

- `npm run test:web` runs each one, and four versions made from it (24 dB
  quieter over a quiet room, 10 dB hotter into clipping, over a fan, with
  typing and breaths), through the default configurations. The first run
  writes `<name>.capture.txt` beside it and reports the test as skipped, not
  passed; later runs check against it. `<name>.summary.txt` says what the
  detector made of it: how much of the speech (taken from the recording's own
  envelope) it caught, how much the gate passed, and what happened to the
  first 100 ms after each pause. Delete a `.capture.txt` to record it again.
- the playback check plays each through every profile and keeps
  `<name>.playback.txt` beside it the same way.

A minute of ordinary talking with a few pauses, in the room and on the
microphone you use for calls, is what the record most lacks.

`node bench/voice/make-tts.mjs` makes five synthetic voices with macOS's `say`
and `afconvert` (Polish and English, a fast talker, short words, a whisper)
into the same folder. The system voices' licence does not allow their output
to be redistributed: neither the files nor anything made from their samples
may be committed.

## A real call

The records hold the processing; `call/` checks that a call carries it. Two
Chromes join one voice channel of a running instance on default settings,
each with a WAV file playing in a loop as its microphone, and each listens to
what it decodes from the other. It passes when both receivers decode sound,
and when at each receiver the other person's speaking ring is on for most of
the time sound arrives, goes out in the pauses, comes on again for the next
phrase, and is never on after a second of silence. Silence at a receiver is a
failure whatever the cause. Without `--owner` and `--guest` the microphones
play the `speech` and `speech-clicks` fixtures, each followed by two seconds of
a quiet room.

```sh
npm run build:web
web/bench/voice/call/start-container.sh <image> web/dist     # prints https://localhost:18743
node web/bench/voice/call/call.mjs --origin https://localhost:18743 --out result.json
docker rm -f stellarr-voice-call && docker volume rm stellarr-voice-call-data
```

`start-container.sh` builds nothing: it runs an existing image with the build
mounted over the web client the image carries, published on loopback only.
The first account founds the instance with the setup code the API logs at
start, which `call.mjs` reads with `docker logs stellarr-voice-call`
(`--container` names another container, `STELLARR_SETUP_CODE` gives the code
directly). `chrome.sh` adds the flags
a call needs (a fake camera and microphone, the WAV, no permission prompts)
to the Chrome `cdp.mjs` starts. A run takes about 40 s.

## Where the harness touches the implementation

A rewrite changes these files of the harness, not the records:

- `capture/worklet.ts`: that `capture/detector/processor.ts` registers one
  processor class, reads `sampleRate` from its global scope, takes
  `processorOptions`, and talks through `this.port`;
- `playback/run.mjs`: that the page builds the worklet with `workerBuild`
  from `web/worklets.ts`, as the app's build does, so the playback check's
  cross-check runs the minified bundle that ships;
- `capture/app.ts`: the functions the app builds its nodes with
  (`buildCaptureGraph`, `SpeechDetector.add`, `buildGateNode`) and
  `REMOTE_GATE_SENSITIVITY`;
- `playback/render.ts`: `RemoteVoiceMixer` with `attachElement` and
  `setGate`, and the two context methods it is given;
- `suppressor/record.ts`: `SpeexPreprocessor` and `instantiateSpeex` from
  `capture/speex/preprocessor.ts`, and the binary's `speex_preprocess_ctl`
  for the settings in the header; `RnnoiseDenoiser` and `instantiateRnnoise`
  from `capture/rnnoise/denoiser.ts`;
- `suppressor/main.ts`: `attachSuppressor` and
  `resetSuppressorCacheForTests` from `capture/noiseSuppression.ts`, and the
  options the earlier worklets read (`maxChannels`, `wasmBinary` and the compiled `module`).

Nothing reads a field of a processor or a node. The detector's frame-level
reasoning (the noise floor it has learned, the SNR, the voicing of a frame,
the gate's and the leveller's internal gains) is therefore not in the record:
only what reaches the output and the main thread is.
