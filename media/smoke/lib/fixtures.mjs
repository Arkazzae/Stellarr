// The fake capture devices of each browser.
//
// Chromium's fake devices can play a WAV file as the microphone and a Y4M file
// as the camera. Every person in the smoke test gets a tone and a colour of
// their own, so a receiver can tell from the media alone whose track arrived
// on a section, and the directory can be checked against that instead of
// against itself.

import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** The people of the smoke test. The tones share no harmonics. */
export const IDENTITIES = [
  { name: "A", toneHz: 500, rgb: [220, 40, 40] },
  { name: "B", toneHz: 1100, rgb: [40, 200, 60] },
  { name: "C", toneHz: 1700, rgb: [40, 60, 220] },
];

const SAMPLE_RATE = 48_000;
const SECONDS = 2;

/** A mono 16-bit WAV of a sine. Whole cycles fit the file, so the loop is seamless. */
function wav(toneHz) {
  const samples = SAMPLE_RATE * SECONDS;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    const value = Math.sin((2 * Math.PI * toneHz * i) / SAMPLE_RATE) * 0.3;
    data.writeInt16LE(Math.round(value * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const WIDTH = 320;
const HEIGHT = 240;
const FPS = 30;

function yuv([r, g, b]) {
  // BT.601 full range, which is what C420jpeg declares.
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return [
    clamp(0.299 * r + 0.587 * g + 0.114 * b),
    clamp(128 - 0.168736 * r - 0.331264 * g + 0.5 * b),
    clamp(128 + 0.5 * r - 0.418688 * g - 0.081312 * b),
  ];
}

/**
 * A Y4M of a solid colour with a small square moving across it. The square
 * keeps the encoder producing real frames; it is too small to move the
 * average colour a receiver measures.
 */
function y4m(rgb) {
  const [y, u, v] = yuv(rgb);
  const frames = FPS * SECONDS;
  const ySize = WIDTH * HEIGHT;
  const cSize = (WIDTH / 2) * (HEIGHT / 2);
  const parts = [Buffer.from(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F${FPS}:1 Ip A1:1 C420jpeg\n`)];

  for (let f = 0; f < frames; f += 1) {
    const plane = Buffer.alloc(ySize + 2 * cSize);
    plane.fill(y, 0, ySize);
    plane.fill(u, ySize, ySize + cSize);
    plane.fill(v, ySize + cSize);

    const size = 24;
    const left = Math.floor(((WIDTH - size) * f) / frames);
    const top = (HEIGHT - size) / 2;
    for (let row = top; row < top + size; row += 1) {
      plane.fill(Math.min(255, y + 60), row * WIDTH + left, row * WIDTH + left + size);
    }

    parts.push(Buffer.from("FRAME\n"), plane);
  }
  return Buffer.concat(parts);
}

/** Writes the WAV and the Y4M of every identity and returns their paths. */
export function writeFixtures(dir) {
  return IDENTITIES.map((identity) => {
    const audio = join(dir, `${identity.name}.wav`);
    const video = join(dir, `${identity.name}.y4m`);
    writeFileSync(audio, wav(identity.toneHz));
    writeFileSync(video, y4m(identity.rgb));
    return { ...identity, audio, video };
  });
}

/** The identity whose colour is nearest to a measured one, with the distance. */
export function nearestColour(rgb) {
  let best = null;
  for (const identity of IDENTITIES) {
    const distance = Math.hypot(...identity.rgb.map((c, i) => c - rgb[i]));
    if (!best || distance < best.distance) best = { name: identity.name, distance };
  }
  return best;
}

/** The identity whose tone is nearest to a measured frequency, with the error in Hz. */
export function nearestTone(hz) {
  let best = null;
  for (const identity of IDENTITIES) {
    const error = Math.abs(identity.toneHz - hz);
    if (!best || error < best.error) best = { name: identity.name, error };
  }
  return best;
}
