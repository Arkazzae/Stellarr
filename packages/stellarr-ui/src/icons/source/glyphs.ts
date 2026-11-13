/**
 * The Stellarr icon family as drawn: one geometry per glyph, two variants.
 *
 * - linear: every contour closed and continuous;
 * - broken: the same contours, each main one opened by a single gap.
 *
 * A plain string is the same in both variants; `brk(d, gap)` names the point
 * where the broken variant opens the contour. `scripts/build-icons.mjs` turns
 * this file into the static table in `../paths.ts` and the SVGs in
 * `branding/icons/`. The rules are in `../README.md`.
 */
import {
  arc,
  brk,
  circle,
  dotsBeside,
  fitGroup,
  knockLine,
  knockNear,
  mapStroke,
  mirror,
  move,
  norm,
  poly,
  rect,
  rotate,
  scale,
  type IconPath,
  type IconStroke,
} from "./geometry.ts";

// ── Shared parts ──────────────────────────────────────────────────────────

/** A full-size container and its broken gap, upper right. */
const frameD = rect(2.5, 2.5, 21.5, 21.5, 6);
const frame = brk(frameD, [21.5, 8.5]);
/** A full-size ring reaches 2–22: a circle looks smaller than a square as wide. */
const ringD = circle(12, 12, 10);
const ring = brk(ringD, [19.07, 4.93]);

/** The slash of a disabled state, and the other diagonal where that one would hide the subject. */
const slash = "M20.5 3.5L3.5 20.5";
const slashA = [20.5, 3.5] as const;
const slashB = [3.5, 20.5] as const;
const backA = [3.5, 3.5] as const;
const backB = [20.5, 20.5] as const;

const speakerD =
  "M14 7V17C14 19.3 12.7 20.1 10.9 18.9L8.1 17.1C7.5 16.7 7 16.5 6.3 16.5H5C3.3 16.5 2.5 15.7 2.5 14V10C2.5 8.3 3.3 7.5 5 7.5H6.3C7 7.5 7.5 7.3 8.1 6.9L10.9 5.1C12.7 3.9 14 4.7 14 7Z";
const speaker = brk(speakerD, [14, 10]);
const waveNear = "M17.5 9C18.6 10.8 18.6 13.2 17.5 15";

const capsuleD = rect(8.5, 2.5, 15.5, 15, 3.5);
const micArc = "M5 10.5V11.5C5 15.4 8.1 18.5 12 18.5C15.9 18.5 19 15.4 19 11.5V10.5";

const headBand = "M2.5 13.5V12C2.5 6.75 6.75 2.5 12 2.5C17.25 2.5 21.5 6.75 21.5 12V13.5";
const cupL = rect(2.5, 12, 8, 21, 2.5);
const cupR = rect(16, 12, 21.5, 21, 2.5);

const phoneD =
  "M8.2 3.9L9.9 6.6C10.4 7.4 10.3 8.4 9.6 9.1L8.4 10.3C9.6 12.7 11.3 14.4 13.7 15.6L14.9 14.4C15.6 13.7 16.6 13.6 17.4 14.1L20.1 15.8C21 16.4 21.5 17.2 21.4 18.1C21.2 20.1 19.4 21.5 17.3 21.5C9.7 21.5 2.5 14.3 2.5 6.7C2.5 4.6 3.9 2.8 5.9 2.6C6.8 2.5 7.6 3 8.2 3.9Z";

const cameraBodyD = rect(2.5, 5, 15.5, 19, 4.5);
const cameraBody = brk(cameraBodyD, [11, 5]);
const cameraLens = "M15.5 9.75L18.7 7.5C19.9 6.7 21.5 7.2 21.5 8.7V15.3C21.5 16.8 19.9 17.3 18.7 16.5L15.5 14.25";

const screenD = "M2.5 9.5V8.5C2.5 5 4 3.5 7.5 3.5H16.5C20 3.5 21.5 5 21.5 8.5V14.5C21.5 18 20 19.5 16.5 19.5H12.5";
const castFar = "M2.5 12.5C6.37 12.5 9.5 15.63 9.5 19.5";
const castNear = "M2.5 16C4.43 16 6 17.57 6 19.5";
const castDot = "M2.5 19.5H2.51";

const bellD = move(
  "M12 2.75C8.55 2.75 5.75 5.55 5.75 9V11.2C5.75 12 5.5 12.8 5.1 13.5L4.1 15.2C3.3 16.6 4 18 5.5 18.4C9.75 19.5 14.25 19.5 18.5 18.4C20 18 20.7 16.6 19.9 15.2L18.9 13.5C18.5 12.8 18.25 12 18.25 11.2V9C18.25 5.55 15.45 2.75 12 2.75Z",
  0,
  -0.5,
);
const clapper = "M9.75 21.5C10.3 22 11.1 22.25 12 22.25C12.9 22.25 13.7 22 14.25 21.5";

const eyeD =
  "M21.4 10.4C19 6.4 15.7 4.25 12 4.25C8.3 4.25 5 6.4 2.6 10.4C2 11.4 2 12.6 2.6 13.6C5 17.6 8.3 19.75 12 19.75C15.7 19.75 19 17.6 21.4 13.6C22 12.6 22 11.4 21.4 10.4Z";
const pupilD = circle(12, 12, 3.5);

const smileEyes = "M8.5 9.5H8.51M15.5 9.5H15.51";
const smileMouth = "M7.75 14C8.6 15.9 10.1 17 12 17C13.9 17 15.4 15.9 16.25 14";

const caretD = "M5.5 9L10.94 14.44C11.53 15.03 12.47 15.03 13.06 14.44L18.5 9";
const arrowRightD = ["M4 12H20", "M14 6L20 12L14 18"];
const replyStrokes: IconStroke[] = [
  "M9.5 5.5L3.5 11.5L9.5 17.5",
  brk("M3.5 11.5H13.5C18 11.5 20.5 14 20.5 18.5V19.5", [11.25, 11.5]),
];
const trayD = "M3 15V16.5C3 19.5 4.5 21 7.5 21H16.5C19.5 21 21 19.5 21 16.5V15";
const fileD = poly(
  [
    [4, 2.5],
    [14, 2.5],
    [20, 8.5],
    [20, 21.5],
    [4, 21.5],
  ],
  [3.5, 1, 1, 3.5, 3.5],
);
const fileFold = "M14 2.5V6C14 7.66 14.84 8.5 16.5 8.5H20";
const hash = ["M9.5 3.5L7.5 20.5M16.5 3.5L14.5 20.5", "M3.5 8.5H20.5M3.5 15.5H20.5"];
const userBody =
  "M4.5 18.75C4.5 15.9 7.9 14 12 14C16.1 14 19.5 15.9 19.5 18.75C19.5 20.6 18.4 21.5 16.5 21.5H7.5C5.6 21.5 4.5 20.6 4.5 18.75Z";
const userHeadLeft = brk(circle(10, 7, 4.25), [13, 4]);
const userBodyLeft = "M12.5 21.5H5.5C3.6 21.5 2.5 20.4 2.5 18.8C2.5 16.1 5.9 14 10 14C11.3 14 12.6 14.2 13.6 14.6";
const smallTileTopRight = brk(rect(13.5, 2.5, 21.5, 10.5, 3.5), [20.62, 3.38, 2.6]);

/** Four-point sparkle centred on (cx, cy) with the given reach. */
const sparkleStar = (cx: number, cy: number, r: number) => {
  const a = r * 0.075;
  const b = r * 0.6;
  return norm(
    `M${cx} ${cy - r}C${cx + a} ${cy - b} ${cx + b} ${cy - a} ${cx + r} ${cy}` +
      `C${cx + b} ${cy + a} ${cx + a} ${cy + b} ${cx} ${cy + r}` +
      `C${cx - a} ${cy + b} ${cx - b} ${cy + a} ${cx - r} ${cy}` +
      `C${cx - b} ${cy - a} ${cx - a} ${cy - b} ${cx} ${cy - r}Z`,
  );
};
const sparkle = [brk(sparkleStar(10.5, 13.5, 8), [7.15, 17]), sparkleStar(18, 6, 3.5)];

/** Five-point star with soft tips. */
const star5 = (cx: number, cy: number, ro: number, ri: number) => {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = ((-90 + i * 36) * Math.PI) / 180;
    const r = i % 2 ? ri : ro;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return poly(
    pts,
    pts.map((_, i) => (i % 2 ? 0.7 : 1.5)),
  );
};

/** Gear with soft teeth around the centre of the canvas. */
const gear = (teeth: number, ro: number, ri: number, top: number, root: number) => {
  const pts: [number, number][] = [];
  const at = (deg: number, r: number): [number, number] => [
    12 + r * Math.sin((deg * Math.PI) / 180),
    12 - r * Math.cos((deg * Math.PI) / 180),
  ];
  for (let i = 0; i < teeth; i++) {
    const c = (i * 360) / teeth;
    pts.push(at(c - root, ri), at(c - top, ro), at(c + top, ro), at(c + root, ri));
  }
  return poly(pts, 1.1);
};

/** Short rays around a centre, every `step` degrees. */
const rays = (cx: number, cy: number, r0: number, r1: number, step: number) => {
  let d = "";
  for (let a = 0; a < 360 - 1e-6; a += step) {
    const s = Math.sin((a * Math.PI) / 180);
    const c = Math.cos((a * Math.PI) / 180);
    d += `M${cx + r0 * s} ${cy - r0 * c}L${cx + r1 * s} ${cy - r1 * c}`;
  }
  return norm(d);
};

/** An EQ curve over the 0 dB line, which is dotted and gives way where the curve leaves it. */
const eq = (curve: string): IconPath[] => {
  const dots = dotsBeside(curve, 12, 3, 21, 3);
  return dots ? [dots, curve] : [curve];
};

/** The audio bars that Off, RNNoise and GTCRN share; a badge beside them names the mode. */
const noiseBars = "M3.25 10V14M6.75 6.5V17.5M10.25 9V15";

const paperclipV =
  "M16 7.5V16.5C16 18.71 14.21 20.5 12 20.5C9.79 20.5 8 18.71 8 16.5V5.75C8 4.51 9.01 3.5 10.25 3.5C11.49 3.5 12.5 4.51 12.5 5.75V15";
const pencilV = "M9 6.5V16.75L12 21.25L15 16.75V6.5C15 4.84 13.66 3.5 12 3.5C10.34 3.5 9 4.84 9 6.5Z";
const linkH = [
  "M10 15.5H6C4.07 15.5 2.5 13.93 2.5 12C2.5 10.07 4.07 8.5 6 8.5H10",
  "M14 8.5H18C19.93 8.5 21.5 10.07 21.5 12C21.5 13.93 19.93 15.5 18 15.5H14",
  "M8 12H16",
];
const nextTriangle = brk(
  poly(
    [
      [4.5, 5],
      [16, 12],
      [4.5, 19],
    ],
    2.75,
  ),
  [11.2, 9.1],
);

// ── Glyphs ────────────────────────────────────────────────────────────────

export const GLYPHS = {
  // Voice, calls and screen
  mic: [brk(capsuleD, [15.5, 7.25]), micArc, "M12 18.5V21.5"],
  micSlash: [knockLine(capsuleD, slashA, slashB), knockLine(micArc, slashA, slashB), "M12 18.5V21.5", slash],
  headphones: [brk(headBand, [18.72, 5.28]), cupL, cupR],
  /** Deafen. */
  headphonesSlash: [knockLine(headBand, slashA, slashB), knockLine(cupL, slashA, slashB), cupR, slash],
  speaker: [speaker, waveNear, "M20 6.5C22 9.8 22 14.2 20 17.5"],
  volumeLow: [speaker, waveNear],
  volumeCross: [speaker, "M17 9.75L21.5 14.25M21.5 9.75L17 14.25"],
  sound: ["M3 10V14M7.5 7V17M12 3.5V20.5M16.5 7V17M21 10V14"],
  wave: [frame, "M7.5 10V14M10.5 7.5V16.5M13.5 9V15M16.5 10.5V13.5"],
  phone: [brk(phoneD, [3.74, 12.22])],
  /** Hang up: the call handset, struck through. */
  phoneX: [knockLine(phoneD, slashA, slashB, 2.7), slash],
  camera: [cameraBody, cameraLens],
  video: [cameraBody, cameraLens],
  cameraSlash: [knockLine(cameraBodyD, slashA, slashB), knockLine(cameraLens, slashA, slashB), slash],
  screencast: [brk(screenD, [21.5, 9.5]), castFar, castNear, castDot],
  /** Stop sharing; the slash runs the other way so the cast waves stay whole. */
  screencastOff: [knockLine(screenD, backA, backB), knockLine(castFar, backA, backB), castNear, castDot, "M3.5 3.5L20.5 20.5"],
  monitor: [brk(rect(2.5, 3.5, 21.5, 16.5, 4.5), [21.5, 8]), "M12 16.5V20.5M8 20.5H16"],
  record: [ring, circle(12, 12, 4)],
  stop: [brk(rect(5, 5, 19, 19, 4.5), [19, 9])],
  play: [
    brk(
      poly(
        [
          [7, 3.75],
          [20.25, 12],
          [7, 20.25],
        ],
        3,
      ),
      [14.95, 8.7],
    ),
  ],
  pause: [rect(4.5, 3.5, 10, 20.5, 2.5), brk(rect(14, 3.5, 19.5, 20.5, 2.5), [19.5, 7.5])],
  next: [nextTriangle, "M19.5 5V19"],
  prev: [mapStroke(nextTriangle, (d) => mirror(d)), "M4.5 5V19"],
  /** Soundboard: a beamed pair of notes. */
  board: [
    brk(circle(6.5, 17.5, 3.5), [8.97, 15.03]),
    brk(circle(17.5, 15.5, 3.5), [19.97, 13.03]),
    "M10 17.5V7.6C10 6.6 10.6 5.8 11.6 5.5L18.6 3.4C20.2 2.9 21 3.6 21 5.2V15.5",
    "M10 10.5L21 7.5",
  ],
  cinema: ["M14 10L21 3M15.5 3H21V8.5", "M10 14L3 21M3 15.5V21H8.5"],
  cinemaOff: ["M21 3L14 10M14 4.5V10H19.5", "M3 21L10 14M4.5 14H10V19.5"],
  expand: ["M3 9V7C3 4.5 4.5 3 7 3H9M15 3H17C19.5 3 21 4.5 21 7V9M21 15V17C21 19.5 19.5 21 17 21H15M9 21H7C4.5 21 3 19.5 3 17V15"],
  collapse: ["M9 3V6C9 7.9 7.9 9 6 9H3M21 9H18C16.1 9 15 7.9 15 6V3M15 21V18C15 16.1 16.1 15 18 15H21M3 15H6C7.9 15 9 16.1 9 18V21"],
  signal: ["M4 20V16M9.33 20V12.5M14.67 20V8.5M20 20V4"],
  wifi: [arc(12, 18.5, 13, -48, 48), arc(12, 18.5, 8.75, -48, 48), arc(12, 18.5, 4.5, -48, 48), "M12 18.5H12.01"],
  /** On air: a source with waves to both sides. */
  broadcast: [
    circle(12, 12, 2),
    arc(12, 12, 5.5, 50, 130),
    arc(12, 12, 5.5, 230, 310),
    brk(arc(12, 12, 9.5, 50, 130), [21.36, 10.35]),
    brk(arc(12, 12, 9.5, 230, 310), [2.64, 13.65]),
  ],

  // Noise suppression: Off, RNNoise and GTCRN are the same bars with a badge
  // (a ban sign, a small network, a sparkle); Speex is the signal smoothed by
  // a classic filter; the browser cleans it inside its window.
  noiseOff: [noiseBars, brk(circle(17.5, 12, 4.25), [20.5, 9]), "M14.5 9L20.5 15"],
  noiseBrowser: [
    brk(rect(2.5, 3.5, 21.5, 20.5, 5.5), [21.5, 11.5]),
    "M2.5 8.5H21.5",
    "M6 15C7.2 12.6 8.3 11.5 9.5 11.5C11.3 11.5 12.7 17 14.5 17C15.7 17 16.8 15.9 18 13.5",
  ],
  noiseSpeex: [
    norm(
      poly(
        [
          [2.5, 12],
          [4.25, 7.5],
          [6.25, 16.5],
          [8.25, 9.5],
          [9.75, 12],
        ],
        0.6,
        true,
      ) + "C10.9 9.9 12 8.5 13.5 8.5C16.25 8.5 16.75 15.5 19.25 15.5C20.3 15.5 21 14.4 21.5 13",
    ),
  ],
  noiseRnnoise: [
    noiseBars,
    circle(15.25, 7.5, 1.75),
    circle(15.25, 16.5, 1.75),
    circle(20, 12, 1.75),
    "M16.5 8.75L18.75 10.75M16.5 15.25L18.75 13.25",
  ],
  noiseGtcrn: [noiseBars, brk(sparkleStar(17.5, 12, 4.5), [15.45, 14.05])],

  // The playback equaliser and dynamics
  /** Three faders at different heights; sliders is the horizontal pair for settings. */
  equalizer: [
    "M5.5 3V12.75M5.5 17.25V21M12 3V5.75M12 10.25V21M18.5 3V10.75M18.5 15.25V21",
    circle(5.5, 15, 2.25),
    circle(12, 8, 2.25),
    circle(18.5, 13, 2.25),
  ],
  /** Warmth, 160 Hz: a low shelf lifted over the 0 dB line. */
  eqWarmth: eq("M2.5 7.5H5.5C8.5 7.5 9 12 12 12H21.5"),
  /** Low mids, 360 Hz: a dip that controls boom. */
  eqMud: eq("M2.5 12H5.5C8 12 8.5 17.5 10.5 17.5C12.5 17.5 13 12 15.5 12H21.5"),
  /** Presence, 3.1 kHz: a bell that brings speech forward. */
  eqPresence: eq("M2.5 12H8.5C11 12 11.5 6.5 13.5 6.5C15.5 6.5 16 12 18.5 12H21.5"),
  /** Air, 8 kHz: a high shelf. */
  eqAir: eq("M2.5 12H12C15 12 15.5 7.5 18.5 7.5H21.5"),
  /** Level squeezed from both sides. */
  compressor: [
    "M3 12C4.5 10 6 10 7.5 12C9 14 10.5 14 12 12C13.5 10 15 10 16.5 12C18 14 19.5 14 21 12",
    "M12 2.5V7.5M9.5 5L12 7.5L14.5 5",
    "M12 21.5V16.5M9.5 19L12 16.5L14.5 19",
  ],
  sliders: ["M2.5 7H7M13 7H21.5M2.5 17H11M17 17H21.5", circle(10, 7, 3), circle(14, 17, 3)],

  // Messages and files
  send: [
    brk(
      poly(
        [
          [21.25, 2.75],
          [14.6, 20.8],
          [11.1, 12.9],
          [3.2, 9.4],
        ],
        [2, 2.2, 0.6, 2.2],
      ),
      [17.9, 11.8],
    ),
    "M11.1 12.9L15.75 8.25",
  ],
  reply: replyStrokes,
  forward: replyStrokes.map((st) => mapStroke(st, (d) => mirror(d))),
  thread: [
    brk(
      "M8 18.5H7.5C4 18.5 2.5 17 2.5 13.5V8C2.5 4.5 4 3 7.5 3H16.5C20 3 21.5 4.5 21.5 8V13.5C21.5 17 20 18.5 16.5 18.5H12.5L9.2 21.2C8.6 21.7 8 21.4 8 20.6V18.5Z",
      [21.5, 10.75],
    ),
    "M7.5 9H16.5M7.5 13H13",
  ],
  quote: [
    brk(rect(3.5, 11, 10.5, 18, 2.5), [10.5, 14.5]),
    "M3.5 14.5V11.5C3.5 8.3 5.2 6.4 8.5 5.75",
    rect(13.5, 11, 20.5, 18, 2.5),
    "M13.5 14.5V11.5C13.5 8.3 15.2 6.4 18.5 5.75",
  ],
  at: [
    circle(12, 12, 4),
    brk(
      "M16 8V13.25C16 14.8 17 15.75 18.5 15.75C20.5 15.75 21.5 14 21.5 12C21.5 6.75 17.25 2.5 12 2.5C6.75 2.5 2.5 6.75 2.5 12C2.5 17.25 6.75 21.5 12 21.5C14 21.5 15.8 20.9 17.25 19.9",
      [5.3, 5.3],
    ),
  ],
  hash,
  hash2: hash,
  smiley: [ring, smileEyes, smileMouth],
  /** Add a reaction: the ring gives way around the plus. */
  smileyAdd: [knockNear(ringD, "M19.25 2V7.5M16.5 4.75H22"), smileEyes, smileMouth, "M19.25 2V7.5M16.5 4.75H22"],
  sticker: [
    brk("M13 21.5H8.5C4.5 21.5 2.5 19.5 2.5 15.5V8.5C2.5 4.5 4.5 2.5 8.5 2.5H15.5C19.5 2.5 21.5 4.5 21.5 8.5V13L13 21.5Z", [21.5, 7.5]),
    "M13 21.5V17C13 14.6 14.6 13 17 13H21.5",
  ],
  image: [
    frame,
    circle(9, 8.5, 2),
    "M2.75 17.5L7.2 13.6C8 12.9 9.2 12.9 10 13.6L11.7 15.1M10.6 14.1L15.3 10C16.1 9.3 17.3 9.3 18.1 10L21.5 13",
  ],
  paperclip: [mapStroke(brk(paperclipV, [8, 11]), (d) => rotate(scale(d, 1.08), 45))],
  link: linkH.map((d, i) => (i === 0 ? mapStroke(brk(d, [5, 15.5]), (x) => rotate(x, -45)) : rotate(d, -45))),
  pin: [
    brk(
      poly(
        [
          [8.5, 3],
          [15.5, 3],
          [14.5, 9.5],
          [18.5, 14.5],
          [5.5, 14.5],
          [9.5, 9.5],
        ],
        [1.5, 1.5, 1.5, 2, 2, 1.5],
      ),
      [15, 6.25],
    ),
    "M12 14.5V21.5",
  ],
  bookmark: [
    brk(
      "M6 5.5C6 3.6 7 2.5 9 2.5H15C17 2.5 18 3.6 18 5.5V19.6C18 21 16.9 21.6 15.8 20.9L12.9 19C12.3 18.6 11.7 18.6 11.1 19L8.2 20.9C7.1 21.6 6 21 6 19.6V5.5Z",
      [18, 10],
    ),
  ],
  inbox: [
    brk(rect(2.5, 3.5, 21.5, 20.5, 5.5), [21.5, 8.5]),
    "M2.5 13H7.4C8.2 13 8.9 13.5 9.2 14.2L9.6 15.3C9.9 16 10.6 16.5 11.4 16.5H12.6C13.4 16.5 14.1 16 14.4 15.3L14.8 14.2C15.1 13.5 15.8 13 16.6 13H21.5",
  ],
  mail: [brk(rect(2.5, 4.5, 21.5, 19.5, 5), [21.5, 13.5]), "M7 9L10.9 11.9C11.6 12.4 12.4 12.4 13.1 11.9L17 9"],
  bell: [brk(bellD, [16.4, 4.1]), clapper],
  bellSlash: [knockLine(bellD, slashA, slashB), clapper, slash],
  search: [brk(circle(11, 11, 8.5), [17.01, 4.99]), "M19 19L21.5 21.5"],
  copy: [
    "M8.5 5.75C8.75 3.5 10.1 2.5 13 2.5H17C20.3 2.5 21.5 3.7 21.5 7V11C21.5 14.1 20.4 15.3 18.25 15.5",
    brk(rect(2.5, 8.5, 15.5, 21.5, 4.5), [15.5, 13]),
  ],
  edit: [mapStroke(brk(pencilV, [15, 11]), (d) => rotate(d, 45)), rotate("M9 8.5H15", 45), "M13.5 21.5H21"],
  trash: [
    "M3.5 6H20.5",
    "M9 6V4.5C9 3.4 9.9 2.5 11 2.5H13C14.1 2.5 15 3.4 15 4.5V6",
    brk("M5.5 9L6.3 18.4C6.5 20.4 7.6 21.5 9.6 21.5H14.4C16.4 21.5 17.5 20.4 17.7 18.4L18.5 9", [18.1, 13.5]),
    "M10 11V17M14 11V17",
  ],
  dropTray: [
    "M12 2.5V13",
    "M8.5 9.5L12 13L15.5 9.5",
    brk(
      "M8 6.5H7.5C4 6.5 2.5 8 2.5 11.5V16.5C2.5 20 4 21.5 7.5 21.5H16.5C20 21.5 21.5 20 21.5 16.5V11.5C21.5 8 20 6.5 16.5 6.5H16",
      [21.5, 12],
    ),
  ],
  upload: ["M12 14.5V3", "M8.5 6.5L12 3L15.5 6.5", brk(trayD, [16.5, 21])],
  download: ["M12 3V14.5", "M8.5 11L12 14.5L15.5 11", brk(trayD, [16.5, 21])],
  file: [brk(fileD, [20, 14]), fileFold],
  fileText: [brk(fileD, [20, 14]), fileFold, "M8 13H16M8 17H12.5"],

  // Formatting and type
  textFormat: ["M5.5 17L10.6 4.9C11.1 3.7 12.9 3.7 13.4 4.9L18.5 17M7.6 12.5H16.4", "M3.5 21H20.5"],
  /** Aa, for type settings. */
  typography: [
    brk("M2.25 19.5L7.05 6.3C7.35 5.5 8.45 5.5 8.75 6.3L13.55 19.5", [4.95, 12.5]),
    "M3.95 15H11.85",
    circle(18.25, 16, 3),
    "M21.25 12.75V19.5",
  ],
  bold: [
    brk(
      "M6.5 3.5H12.5C15.3 3.5 17 5 17 7.5C17 10 15.3 11.5 12.5 11.5H6.5V3.5ZM6.5 11.5H13.5C16.5 11.5 18 13.1 18 16C18 18.9 16.5 20.5 13.5 20.5H6.5V11.5Z",
      [16.6, 6],
    ),
  ],
  italic: ["M10 3.5H18.5M5.5 20.5H14M14.25 3.5L9.75 20.5"],
  strike: [
    "M17.5 6C16.5 4.4 14.8 3.5 12.5 3.5C9 3.5 7 5.1 7 7.5C7 10.1 9.3 11.1 12 11.9C14.9 12.8 17 13.9 17 16.8C17 19.3 15 20.5 12 20.5C9.4 20.5 7.4 19.5 6 18",
    "M3 12H21",
  ],
  spoiler: [knockLine(eyeD, [21, 3], [3, 21]), knockLine(pupilD, [21, 3], [3, 21]), "M21 3L3 21"],
  inlineCode: ["M7 7L2.5 12L7 17M17 7L21.5 12L17 17M14 4.5L10 19.5"],
  code: [frame, "M8.5 9.5L6 12L8.5 14.5M15.5 9.5L18 12L15.5 14.5M13 8.5L11 15.5"],
  language: [
    "M2.5 5.5H13.5M8 2.5V5.5M5.5 5.5C6 9 8.2 11.8 11.5 13.5M10.5 5.5C9.8 9.6 7 12.9 3 14.5",
    "M14 21.5L16.9 13C17.2 12.1 18.3 12.1 18.6 13L21.5 21.5M15 18.5H20.5",
  ],

  // People and access
  user: [brk(circle(12, 7, 4.5), [15.18, 3.82]), brk(userBody, [17.8, 15.3])],
  users: [
    brk(circle(9, 7, 4), [11.83, 4.17]),
    brk(
      "M2.5 18.5C2.5 15.8 5.4 14 9 14C12.6 14 15.5 15.8 15.5 18.5C15.5 20.4 14.4 21.5 12.5 21.5H5.5C3.6 21.5 2.5 20.4 2.5 18.5Z",
      [14.3, 15.9],
    ),
    "M16.5 3.2C18.5 3.5 20 5.1 20 7C20 8.9 18.5 10.5 16.5 10.8",
    "M18.5 14.3C20.4 14.8 21.5 16.1 21.5 18C21.5 19.8 20.6 20.9 19 21.3",
  ],
  userAdd: [userHeadLeft, userBodyLeft, "M18.5 15.5V21.5M15.5 18.5H21.5"],
  userMinus: [userHeadLeft, userBodyLeft, "M15.5 18.5H21.5"],
  crown: [
    brk(
      poly(
        [
          [3, 7],
          [8, 11.5],
          [12, 4.5],
          [16, 11.5],
          [21, 7],
          [19.25, 18],
          [4.75, 18],
        ],
        [1.2, 0.8, 1.2, 0.8, 1.2, 1.5, 1.5],
      ),
      [20.3, 12.5],
    ),
    "M5 21H19",
  ],
  shield: [
    brk(
      "M10.6 2.9L5.2 4.9C4 5.4 3.5 6.2 3.5 7.5V12C3.5 16.4 6.8 19.7 10.8 21.3C11.6 21.6 12.4 21.6 13.2 21.3C17.2 19.7 20.5 16.4 20.5 12V7.5C20.5 6.2 20 5.4 18.8 4.9L13.4 2.9C12.5 2.6 11.5 2.6 10.6 2.9Z",
      [20.5, 9.75],
    ),
    "M8.75 12L11 14.25L15.25 10",
  ],
  tag: [
    brk(
      poly(
        [
          [3, 3],
          [11.5, 3],
          [21, 12.5],
          [12.5, 21],
          [3, 11.5],
        ],
        [2.5, 1.5, 2, 2, 1.5],
      ),
      [16.25, 7.75],
    ),
    circle(7.75, 7.75, 1.5),
  ],
  medal: [
    brk(circle(12, 9.5, 7), [16.95, 4.55]),
    "M8.25 15.3L7 21.1C6.9 21.6 7.3 21.9 7.7 21.7L12 19.75L16.3 21.7C16.7 21.9 17.1 21.6 17 21.1L15.75 15.3",
    circle(12, 9.5, 3),
  ],
  ban: [ring, "M5 5L19 19"],
  key: [brk(circle(8, 16, 4.5), [4.82, 19.18]), "M11.2 12.8L20.5 3.5", "M17.5 6.5L19.5 8.5M15 9L16.5 10.5"],
  lock: ["M6.5 10V8C6.5 4.7 8.5 2.5 12 2.5C15.5 2.5 17.5 4.7 17.5 8V10", brk(rect(3, 10, 21, 21.5, 4.5), [21, 14]), "M12 14.5V17"],
  unlock: ["M6.5 10V8C6.5 4.7 8.5 2.5 12 2.5C14.8 2.5 16.7 3.9 17.3 6.2", brk(rect(3, 10, 21, 21.5, 4.5), [21, 14]), "M12 14.5V17"],
  login: [brk("M14 2.5H16C19.5 2.5 21.5 4.5 21.5 8V16C21.5 19.5 19.5 21.5 16 21.5H14", [21.5, 10]), "M3 12H14.5", "M11 8.5L14.5 12L11 15.5"],
  signout: [brk("M10 2.5H8C4.5 2.5 2.5 4.5 2.5 8V16C2.5 19.5 4.5 21.5 8 21.5H10", [2.5, 10]), "M9.5 12H20.5", "M17 8.5L20.5 12L17 15.5"],
  bot: [
    brk(rect(3.5, 7.5, 20.5, 20.5, 5), [20.5, 11.5]),
    "M12 7.5V4.5",
    circle(12, 3.25, 1.25),
    "M9 13H9.01M15 13H15.01",
    "M9.5 17H14.5",
    "M3.5 12.5H2.5M20.5 12.5H21.5",
  ],
  qrCode: [
    rect(2.5, 2.5, 10, 10, 2.5),
    rect(14, 2.5, 21.5, 10, 2.5),
    rect(2.5, 14, 10, 21.5, 2.5),
    "M14 14H14.01M17.75 14H17.76M21.5 14H21.51M14 17.75H14.01M17.75 17.75H17.76M14 21.5H14.01M17.75 21.5H17.76M21.5 21.5H21.51M21.5 17.75H21.51",
  ],

  // Navigation and layout
  caret: [caretD],
  caretUp: [rotate(caretD, 180)],
  caretL: [rotate(caretD, 90)],
  caretR: [rotate(caretD, -90)],
  arrowUp: arrowRightD.map((d) => rotate(d, -90)),
  arrowDown: arrowRightD.map((d) => rotate(d, 90)),
  arrowLeft: arrowRightD.map((d) => rotate(d, 180)),
  arrowRight: arrowRightD,
  x: ["M6.5 6.5L17.5 17.5M17.5 6.5L6.5 17.5"],
  plus: ["M5.5 12H18.5M12 5.5V18.5"],
  minimize: ["M5.5 12H18.5"],
  maximize: [brk(rect(4.5, 4.5, 19.5, 19.5, 4.5), [19.5, 9.5])],
  restore: [
    "M8.5 6C8.7 4.2 9.8 3.5 12 3.5H16.5C19.5 3.5 20.5 4.5 20.5 7.5V12C20.5 14.2 19.8 15.3 18 15.5",
    brk(rect(3.5, 8.5, 15.5, 20.5, 4), [15.5, 12.5]),
  ],
  popout: [brk("M11 3.5H8C4.5 3.5 3 5 3 8.5V16C3 19.5 4.5 21 8 21H15.5C19 21 20.5 19.5 20.5 16V13", [3, 12]), "M13.5 10.5L21 3", "M15.5 3H21V8.5"],
  sidebar: [frame, "M9 2.5V21.5"],
  channelPanel: [frame, "M15 2.5V21.5"],
  list: ["M3.5 6H20.5M3.5 12H15.5M3.5 18H20.5"],
  grip: ["M9 5H9.01M15 5H15.01M9 12H9.01M15 12H15.01M9 19H9.01M15 19H15.01"],
  dots: [circle(5, 12, 1.5), circle(12, 12, 1.5), circle(19, 12, 1.5)],
  sort: ["M7 4V20M3.5 7.5L7 4L10.5 7.5", "M17 20V4M13.5 16.5L17 20L20.5 16.5"],
  filter: [
    brk(
      poly(
        [
          [3, 4],
          [21, 4],
          [14, 12.5],
          [14, 18.5],
          [10, 20.5],
          [10, 12.5],
        ],
        [2, 2, 1.2, 1, 1, 1.2],
      ),
      [17.5, 4],
    ),
  ],
  /** Two arcs of the ring's radius chasing each other, with corner heads. */
  refresh: [arc(12, 12, 9.5, -90, 60), "M20.25 3V7.25H16", arc(12, 12, 9.5, 90, 240), "M3.75 21V16.75H8"],
  history: [arc(12, 12, 9.5, -90, 225), "M2.25 8V12H6.25", "M12 7.5V12L15 14"],
  home: [
    brk(
      poly(
        [
          [3, 10],
          [12, 2.75],
          [21, 10],
          [21, 21.25],
          [3, 21.25],
        ],
        [2, 2, 2, 3.5, 3.5],
      ),
      [21, 13],
    ),
    "M9.5 21.25V17C9.5 15.6 10.6 14.5 12 14.5C13.4 14.5 14.5 15.6 14.5 17V21.25",
  ],
  dashboard: [rect(2.5, 2.5, 10.5, 12.5, 3), brk(rect(13.5, 2.5, 21.5, 8.5, 3), [20.62, 3.38, 2.6]), rect(13.5, 11.5, 21.5, 21.5, 3), rect(2.5, 15.5, 10.5, 21.5, 3)],
  apps: [rect(2.5, 2.5, 10.5, 10.5, 3.5), smallTileTopRight, rect(2.5, 13.5, 10.5, 21.5, 3.5), rect(13.5, 13.5, 21.5, 21.5, 3.5)],
  launcher: [circle(6.5, 6.5, 4), smallTileTopRight, rect(2.5, 13.5, 10.5, 21.5, 3.5), circle(17.5, 17.5, 4)],

  // Status and marks
  tick: [ring, "M7.75 12.25L10.6 15L16.25 9.25"],
  check: ["M5 12.5L9.5 17L19 7.5"],
  xCircle: [ring, "M9 9L15 15M15 9L9 15"],
  info: [ring, "M12 11V16.5M12 7.75H12.01"],
  help: [ring, "M9.5 9.5C9.5 8 10.6 7 12 7C13.4 7 14.5 8 14.5 9.3C14.5 10.4 13.8 11 13 11.5C12.4 11.9 12 12.4 12 13.2V13.5", "M12 16.75H12.01"],
  warning: [
    brk(
      poly(
        [
          [12, 3],
          [21.75, 19.75],
          [2.25, 19.75],
        ],
        2.75,
      ),
      [16.4, 9.8],
    ),
    "M12 9V13.5M12 16.5H12.01",
  ],
  clock: [ring, "M12 7.5V12L15 14"],
  calendar: [
    brk(rect(3, 4.5, 21, 21.5, 5), [21, 14]),
    "M3 9.5H21",
    "M8 2.5V6.5M16 2.5V6.5",
    "M8 13.75H8.01M12 13.75H12.01M16 13.75H16.01M8 17.25H8.01M12 17.25H12.01",
  ],
  eye: [brk(eyeD, [17.2, 6.1]), pupilD],
  star: [brk(star5(12, 12.6, 10, 4.6), [18.2, 9.3])],
  heart: [
    brk(
      "M12 20.5C11.6 20.5 11.2 20.4 10.9 20.1C6 16.2 2.5 13 2.5 8.9C2.5 5.9 4.8 3.5 7.75 3.5C9.5 3.5 11 4.4 12 5.8C13 4.4 14.5 3.5 16.25 3.5C19.2 3.5 21.5 5.9 21.5 8.9C21.5 13 18 16.2 13.1 20.1C12.8 20.4 12.4 20.5 12 20.5Z",
      [20.6, 6],
    ),
  ],
  flag: ["M5 21.5V3", brk("M5 4H17.2C18.5 4 19.2 5.4 18.4 6.4L16.6 8.7C16.2 9.2 16.2 9.8 16.6 10.3L18.4 12.6C19.2 13.6 18.5 15 17.2 15H5", [11, 4])],
  sparkle,
  fx: sparkle,
  bolt: [
    brk(
      poly(
        [
          [13.5, 2.5],
          [4.5, 13.5],
          [11, 13.5],
          [10.5, 21.5],
          [19.5, 10.5],
          [13, 10.5],
        ],
        1,
      ),
      [8.6, 8.5],
    ),
  ],

  // System and appearance
  gear: [gear(8, 9.75, 7.4, 8.5, 14), brk(circle(12, 12, 3.25), [14.3, 9.7])],
  cpu: [
    brk(rect(5.5, 5.5, 18.5, 18.5, 3.5), [18.5, 12]),
    rect(9.25, 9.25, 14.75, 14.75, 1.5),
    "M9 2.5V5.5M15 2.5V5.5M9 18.5V21.5M15 18.5V21.5M2.5 9H5.5M2.5 15H5.5M18.5 9H21.5M18.5 15H21.5",
  ],
  memory: [
    brk(rect(2.5, 5.5, 21.5, 15.5, 3.5), [21.5, 10.5]),
    rect(6.5, 8.75, 10.5, 12.25, 1),
    rect(13.5, 8.75, 17.5, 12.25, 1),
    "M6.5 15.5V18.5M10 15.5V18.5M14 15.5V18.5M17.5 15.5V18.5",
  ],
  database: [
    brk(circle(12, 5.5, 8, 3), [18.2, 3.6]),
    "M4 5.5V18.5C4 20.2 7.6 21.5 12 21.5C16.4 21.5 20 20.2 20 18.5V5.5",
    "M4 12C4 13.7 7.6 15 12 15C16.4 15 20 13.7 20 12",
  ],
  server: [brk(rect(3, 2.5, 21, 21.5, 5), [21, 7.25]), "M3 12H21", "M7 7.25H7.01M7 16.75H7.01", "M11 7.25H17M11 16.75H17"],
  cloud: [
    brk(
      "M6.5 19.5C4.3 19.5 2.5 17.7 2.5 15.5C2.5 13.4 4.1 11.7 6.1 11.5C6.6 8 9.3 5.5 12.5 5.5C16 5.5 18.8 8.2 19 11.7C20.5 12.3 21.5 13.8 21.5 15.5C21.5 17.7 19.7 19.5 17.5 19.5H6.5Z",
      [16.9, 7.2],
    ),
  ],
  archive: [brk(rect(2.5, 3, 21.5, 8, 2), [17, 3]), "M4 8V17.5C4 20.2 5.3 21.5 8 21.5H16C18.7 21.5 20 20.2 20 17.5V8", "M10 12H14"],
  folder: [
    brk(
      "M21.5 11.5V16.5C21.5 20 20 21.5 16.5 21.5H7.5C4 21.5 2.5 20 2.5 16.5V7.5C2.5 4 4 2.5 7.5 2.5H8.8C10 2.5 10.6 2.9 11.3 3.8L12.6 5.6C13.1 6.2 13.4 6.5 14.3 6.5H16.5C20 6.5 21.5 8 21.5 11.5Z",
      [21.5, 13.5],
    ),
  ],
  plug: [
    "M9 2.5V6.5M15 2.5V6.5",
    brk("M7 6.5H17C17.6 6.5 18 6.9 18 7.5V10.5C18 13.8 15.3 16.5 12 16.5C8.7 16.5 6 13.8 6 10.5V7.5C6 6.9 6.4 6.5 7 6.5Z", [18, 9]),
    "M12 16.5V21.5",
  ],
  terminal: [frame, "M7 9L10 12L7 15", "M12.5 15H17"],
  /** Columns in the frame, for a chart's title; unlike signal they do not climb. */
  chart: [frame, "M7.5 17V13.5M12 17V7.5M16.5 17V11"],
  pulse: [
    poly(
      [
        [2.5, 12],
        [6, 12],
        [8.5, 6],
        [13, 18.5],
        [15.5, 12],
        [21.5, 12],
      ],
      0.7,
      true,
    ),
  ],
  keyboard: [
    brk(rect(2, 5, 22, 19, 4.5), [22, 9.5]),
    "M6.5 9H6.51M10 9H10.01M14 9H14.01M17.5 9H17.51M6.5 12.25H6.51M10 12.25H10.01M14 12.25H14.01M17.5 12.25H17.51",
    "M8 15.5H16",
  ],
  globe: [ring, circle(12, 12, 4, 10), "M2 12H22"],
  palette: [
    brk(
      "M12 21.5C6.75 21.5 2.5 17.25 2.5 12C2.5 6.75 6.75 2.5 12 2.5C17.25 2.5 21.5 6.4 21.5 11.2C21.5 14.3 19 16.5 16 16.5H14.4C13.5 16.5 12.9 17.2 12.9 18C12.9 18.4 13.1 18.7 13.3 19C13.6 19.4 13.8 19.8 13.8 20.2C13.8 21 13.1 21.5 12 21.5Z",
      [4.2, 16.6],
    ),
    circle(7.5, 12.5, 1),
    circle(9.25, 7.75, 1),
    circle(14.25, 7, 1),
    circle(17.75, 10.5, 1),
  ],
  sun: [brk(circle(12, 12, 4.5), [15.18, 8.82]), rays(12, 12, 7.75, 9.75, 45)],
  moon: [
    brk(
      "M20.9 14.6C19.7 15.2 18.4 15.5 17 15.5C12.3 15.5 8.5 11.7 8.5 7C8.5 5.6 8.8 4.3 9.4 3.1C5.5 4.2 2.5 7.8 2.5 12.1C2.5 17.3 6.7 21.5 11.9 21.5C16.2 21.5 19.8 18.5 20.9 14.6Z",
      [3.3, 15.8],
    ),
  ],
  /** An artist's brush on the diagonal: slim tapered handle, ferrule, a tuft that flicks to a point. */
  brush: fitGroup(
    [
      "M10.9 11L11.4 3C11.45 2.4 12.55 2.4 12.6 3L13.1 11",
      rect(9.5, 11, 14.5, 14, 1),
      brk("M9.5 14C8.9 15.6 8.7 17.5 9 19.3C9.2 20.5 8.9 21.4 8 22C11 22.4 13.9 21.1 14.6 18.4C14.9 17 14.9 15.5 14.5 14", [14.75, 16.5]),
    ].map((st) => mapStroke(st, (d) => rotate(d, 45))),
    19,
  ),
  mobile: [brk(rect(5, 2.5, 19, 21.5, 4.5), [19, 9]), "M10 18.5H14"],
  game: [
    brk(
      scale(
        "M7.5 6.5H16.5C19.5 6.5 21.3 8.3 21.8 11.3L22.4 15.3C22.8 18 21.2 19.5 19.2 19.5C18 19.5 17.1 18.9 16.5 17.9L15.6 16.5C15.2 15.9 14.6 15.5 13.8 15.5H10.2C9.4 15.5 8.8 15.9 8.4 16.5L7.5 17.9C6.9 18.9 6 19.5 4.8 19.5C2.8 19.5 1.2 18 1.6 15.3L2.2 11.3C2.7 8.3 4.5 6.5 7.5 6.5Z",
        0.95,
        1,
      ),
      [15, 6.5],
    ),
    "M6.75 11.5H10.25M8.5 9.75V13.25",
    "M15.5 10.5H15.51M17.5 12.5H17.51",
  ],
  clipboard: [
    brk("M8 4.5H7.5C4.5 4.5 3.5 6 3.5 8.5V17C3.5 20 5 21.5 8 21.5H16C19 21.5 20.5 20 20.5 17V8.5C20.5 6 19.5 4.5 16.5 4.5H16", [20.5, 11]),
    rect(8, 2.5, 16, 6.5, 2),
    "M7.5 11.5H16.5M7.5 15.5H13",
  ],
} satisfies Record<string, readonly IconStroke[]>;
