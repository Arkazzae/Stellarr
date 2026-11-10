/**
 * Generates the built-in avatar and banner pairs that accounts without uploaded
 * artwork fall back to (see `src/design/identity.ts`).
 *
 *   node scripts/generate-identity-art.mjs <public-dir>
 *
 * writes `<public-dir>/identity/defaults/NN/avatar.svg` and `banner.svg`, where
 * NN runs from 01 to the pair count. The output is committed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outputRoot = process.argv[2];
if (outputRoot === undefined) {
  console.error("usage: node scripts/generate-identity-art.mjs <public-dir>");
  process.exit(1);
}

/**
 * One composition per pair, drawn over the surface's gradient. `{light}`,
 * `{accent}` and `{dark}` stand for the colours of the pair's palette.
 */
const MOTIFS = [
  {
    avatar:
      `<circle cx="128" cy="128" r="78" fill="none" stroke="{light}" stroke-width="18" opacity=".28"/><circle cx="128" cy="128" r="28" fill="{accent}" opacity=".76"/><circle cx="190" cy="72" r="13" fill="{light}" opacity=".82"/>`,
    banner:
      `<ellipse cx="314" cy="92" rx="214" ry="104" fill="none" stroke="{light}" stroke-width="22" opacity=".18"/><circle cx="482" cy="54" r="34" fill="{accent}" opacity=".68"/><circle cx="98" cy="140" r="92" fill="{dark}" opacity=".32"/>`,
  },
  {
    avatar:
      `<path d="M-16 210 256 42v214H-16Z" fill="{dark}" opacity=".38"/><path d="m16 204 214-132" stroke="{light}" stroke-width="28" opacity=".42"/>`,
    banner:
      `<path d="M-30 190 670 8v190H-30Z" fill="{dark}" opacity=".42"/><path d="M-20 166 646 0" stroke="{light}" stroke-width="26" opacity=".28"/>`,
  },
  {
    avatar:
      `<path d="M45 214V126a83 83 0 0 1 166 0v88h-34v-86a49 49 0 0 0-98 0v86Z" fill="{light}" opacity=".28"/><circle cx="128" cy="164" r="25" fill="{accent}" opacity=".7"/>`,
    banner:
      `<path d="M104 190V92a106 106 0 0 1 212 0v98h-42V94a64 64 0 0 0-128 0v96Z" fill="{light}" opacity=".2"/><circle cx="446" cy="88" r="70" fill="{accent}" opacity=".28"/>`,
  },
  {
    avatar:
      `<circle cx="94" cy="128" r="72" fill="{light}" opacity=".26"/><circle cx="174" cy="128" r="72" fill="{accent}" opacity=".38"/>`,
    banner:
      `<circle cx="246" cy="88" r="132" fill="{light}" opacity=".18"/><circle cx="398" cy="88" r="132" fill="{accent}" opacity=".26"/>`,
  },
  {
    avatar:
      `<circle cx="128" cy="116" r="62" fill="{light}" opacity=".54"/><path d="M0 146h256v110H0Z" fill="{dark}" opacity=".5"/><path d="M0 164h256" stroke="{light}" stroke-width="8" opacity=".32"/>`,
    banner:
      `<circle cx="320" cy="82" r="86" fill="{light}" opacity=".36"/><path d="M0 106h640v70H0Z" fill="{dark}" opacity=".48"/><path d="M0 125h640" stroke="{light}" stroke-width="7" opacity=".22"/>`,
  },
  {
    avatar:
      `<path d="M-20 82c58-44 98 44 156 0s98 44 156 0v42c-58 44-98-44-156 0s-98-44-156 0Z" fill="{light}" opacity=".28"/><path d="M-20 160c58-44 98 44 156 0s98 44 156 0" fill="none" stroke="{accent}" stroke-width="22" opacity=".54"/>`,
    banner:
      `<path d="M-40 62c110-64 178 64 288 0s178 64 288 0 178 64 288 0v46c-110 64-178-64-288 0s-178-64-288 0-178-64-288 0Z" fill="{light}" opacity=".18"/><path d="M-20 142c110-62 178 62 288 0s178 62 288 0 178 62 288 0" fill="none" stroke="{accent}" stroke-width="19" opacity=".34"/>`,
  },
  {
    avatar:
      `<rect x="84" y="34" width="88" height="188" rx="44" fill="{dark}" opacity=".42"/><rect x="104" y="58" width="48" height="140" rx="24" fill="{light}" opacity=".44"/>`,
    banner:
      `<rect x="276" y="-46" width="112" height="268" rx="56" fill="{dark}" opacity=".44"/><rect x="302" y="-18" width="60" height="212" rx="30" fill="{light}" opacity=".3"/>`,
  },
  {
    avatar:
      `<path d="m128 28 100 100-100 100L28 128Z" fill="{light}" opacity=".22"/><path d="m128 74 54 54-54 54-54-54Z" fill="{accent}" opacity=".68"/>`,
    banner:
      `<path d="m320-84 172 172-172 172L148 88Z" fill="{light}" opacity=".18"/><path d="m320 12 76 76-76 76-76-76Z" fill="{accent}" opacity=".52"/>`,
  },
  {
    avatar:
      `<circle cx="128" cy="128" r="92" fill="none" stroke="{light}" stroke-width="10" opacity=".18"/><circle cx="128" cy="128" r="64" fill="none" stroke="{light}" stroke-width="12" opacity=".3"/><circle cx="128" cy="128" r="30" fill="{accent}" opacity=".66"/>`,
    banner:
      `<ellipse cx="320" cy="88" rx="250" ry="134" fill="none" stroke="{light}" stroke-width="12" opacity=".14"/><ellipse cx="320" cy="88" rx="176" ry="92" fill="none" stroke="{light}" stroke-width="16" opacity=".22"/><ellipse cx="320" cy="88" rx="74" ry="42" fill="{accent}" opacity=".4"/>`,
  },
  {
    avatar:
      `<path d="m48 188 58-86 36 40 66-88" fill="none" stroke="{light}" stroke-width="10" stroke-linecap="round" opacity=".4"/><circle cx="48" cy="188" r="13" fill="{accent}"/><circle cx="106" cy="102" r="10" fill="{light}"/><circle cx="142" cy="142" r="8" fill="{accent}"/><circle cx="208" cy="54" r="14" fill="{light}"/>`,
    banner:
      `<path d="m52 140 134-78 118 68 126-92 158 74" fill="none" stroke="{light}" stroke-width="9" stroke-linecap="round" opacity=".28"/><g fill="{accent}"><circle cx="52" cy="140" r="13"/><circle cx="304" cy="130" r="10"/><circle cx="588" cy="112" r="15"/></g><g fill="{light}"><circle cx="186" cy="62" r="11"/><circle cx="430" cy="38" r="13"/></g>`,
  },
  {
    avatar:
      `<path d="M20 30h108v196H20Z" fill="{light}" opacity=".22"/><path d="M128 30h108v196H128Z" fill="{dark}" opacity=".4"/><circle cx="128" cy="128" r="34" fill="{light}" opacity=".66"/>`,
    banner:
      `<path d="M0 0h320v176H0Z" fill="{light}" opacity=".18"/><path d="M320 0h320v176H320Z" fill="{dark}" opacity=".4"/><circle cx="320" cy="88" r="52" fill="{light}" opacity=".5"/>`,
  },
  {
    avatar:
      `<g fill="{light}" opacity=".26"><ellipse cx="128" cy="76" rx="42" ry="66"/><ellipse cx="180" cy="128" rx="66" ry="42"/><ellipse cx="128" cy="180" rx="42" ry="66"/><ellipse cx="76" cy="128" rx="66" ry="42"/></g><circle cx="128" cy="128" r="31" fill="{accent}" opacity=".72"/>`,
    banner:
      `<g fill="{light}" opacity=".18"><ellipse cx="320" cy="22" rx="72" ry="112"/><ellipse cx="412" cy="88" rx="118" ry="64"/><ellipse cx="320" cy="154" rx="72" ry="112"/><ellipse cx="228" cy="88" rx="118" ry="64"/></g><circle cx="320" cy="88" r="42" fill="{accent}" opacity=".54"/>`,
  },
  {
    avatar:
      `<g fill="none" stroke="{light}" stroke-width="8" opacity=".3"><path d="M42 72h172M42 128h172M42 184h172"/><path d="M72 42v172M128 42v172M184 42v172"/></g><circle cx="128" cy="128" r="32" fill="{accent}" opacity=".74"/>`,
    banner:
      `<g fill="none" stroke="{light}" stroke-width="7" opacity=".18"><path d="M0 44h640M0 88h640M0 132h640"/><path d="M112 0v176M216 0v176M320 0v176M424 0v176M528 0v176"/></g><circle cx="424" cy="88" r="38" fill="{accent}" opacity=".52"/>`,
  },
  {
    avatar:
      `<rect x="36" y="36" width="184" height="184" rx="22" fill="none" stroke="{light}" stroke-width="12" opacity=".2"/><rect x="70" y="70" width="116" height="116" rx="18" fill="none" stroke="{light}" stroke-width="15" opacity=".32"/><rect x="108" y="108" width="40" height="40" rx="12" fill="{accent}" opacity=".76"/>`,
    banner:
      `<rect x="166" y="-66" width="308" height="308" rx="42" fill="none" stroke="{light}" stroke-width="16" opacity=".16"/><rect x="226" y="-6" width="188" height="188" rx="32" fill="none" stroke="{light}" stroke-width="19" opacity=".24"/><rect x="292" y="60" width="56" height="56" rx="15" fill="{accent}" opacity=".58"/>`,
  },
  {
    avatar:
      `<path d="m28 198 150-150" stroke="{light}" stroke-width="24" stroke-linecap="round" opacity=".28"/><path d="m148 78 44-14-14 44" fill="none" stroke="{accent}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/><circle cx="68" cy="188" r="18" fill="{light}" opacity=".62"/>`,
    banner:
      `<path d="M44 154 468 22" stroke="{light}" stroke-width="28" stroke-linecap="round" opacity=".2"/><path d="m454 22 66 14-42 52" fill="none" stroke="{accent}" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/><circle cx="124" cy="130" r="24" fill="{light}" opacity=".48"/>`,
  },
  {
    avatar:
      `<ellipse cx="128" cy="128" rx="82" ry="102" fill="{dark}" opacity=".36"/><ellipse cx="128" cy="128" rx="52" ry="72" fill="none" stroke="{light}" stroke-width="18" opacity=".34"/><ellipse cx="128" cy="128" rx="18" ry="34" fill="{accent}" opacity=".72"/>`,
    banner:
      `<ellipse cx="320" cy="88" rx="166" ry="142" fill="{dark}" opacity=".38"/><ellipse cx="320" cy="88" rx="104" ry="96" fill="none" stroke="{light}" stroke-width="22" opacity=".26"/><ellipse cx="320" cy="88" rx="38" ry="56" fill="{accent}" opacity=".5"/>`,
  },
  {
    avatar:
      `<rect x="38" y="76" width="180" height="48" rx="24" fill="{light}" opacity=".28"/><rect x="72" y="132" width="146" height="48" rx="24" fill="{accent}" opacity=".42"/><circle cx="62" cy="156" r="24" fill="{light}" opacity=".64"/>`,
    banner:
      `<rect x="62" y="36" width="456" height="42" rx="21" fill="{light}" opacity=".2"/><rect x="128" y="98" width="450" height="42" rx="21" fill="{accent}" opacity=".3"/><circle cx="552" cy="57" r="30" fill="{light}" opacity=".5"/>`,
  },
  {
    avatar:
      `<path d="M38 214h180v-36H74v-36h116v-36H108V70h54V34" fill="none" stroke="{light}" stroke-width="18" stroke-linejoin="round" opacity=".34"/><circle cx="162" cy="34" r="16" fill="{accent}"/>`,
    banner:
      `<path d="M42 150h556v-32H118V86h390V54H204V22h216" fill="none" stroke="{light}" stroke-width="16" stroke-linejoin="round" opacity=".24"/><circle cx="420" cy="22" r="17" fill="{accent}"/>`,
  },
  {
    avatar:
      `<path d="M18 202c36-74 66-112 110-112s74 38 110 112" fill="none" stroke="{light}" stroke-width="18" opacity=".22"/><path d="M42 202c26-50 50-76 86-76s60 26 86 76" fill="none" stroke="{accent}" stroke-width="20" opacity=".52"/><circle cx="128" cy="78" r="22" fill="{light}" opacity=".64"/>`,
    banner:
      `<path d="M-30 184C70 28 178 28 278 184M210 184C310 28 418 28 518 184M450 184C550 28 658 28 758 184" fill="none" stroke="{light}" stroke-width="18" opacity=".18"/><path d="M62 184C132 70 202 70 272 184" fill="none" stroke="{accent}" stroke-width="20" opacity=".34"/>`,
  },
  {
    avatar:
      `<path d="m128 24 27 70 75 5-58 48 19 73-63-41-63 41 19-73-58-48 75-5Z" fill="{dark}" opacity=".34"/><path d="m128 70 16 39 42 3-32 27 10 41-36-23-36 23 10-41-32-27 42-3Z" fill="{light}" opacity=".32"/><circle cx="128" cy="128" r="18" fill="{accent}"/>`,
    banner:
      `<path d="m320-76 54 126 136 10-104 88 32 132-118-74-118 74 32-132-104-88 136-10Z" fill="{dark}" opacity=".34"/><path d="m320 2 30 70 76 6-58 48 18 74-66-42-66 42 18-74-58-48 76-6Z" fill="{light}" opacity=".24"/><circle cx="320" cy="88" r="22" fill="{accent}"/>`,
  },
];

/** The two shapes of artwork. Gradient stops are [lightness, chroma, hue shift]. */
const SURFACES = {
  avatar: {
    width: 256,
    height: 256,
    from: [0.65, 0.18, 14],
    to: [0.33, 0.12, -18],
    vignette: { cx: "28%", cy: "20%", r: "88%", white: ".1", black: ".16" },
  },
  banner: {
    width: 640,
    height: 176,
    from: [0.54, 0.16, 18],
    to: [0.24, 0.09, -24],
    vignette: { cx: "26%", cy: "14%", r: "95%", white: ".08", black: ".18" },
  },
};

const oklch = (lightness, chroma, hue) =>
  `oklch(${lightness} ${chroma} ${((hue % 360) + 360) % 360})`;

/**
 * A golden-angle walk spreads neighbouring pairs around the colour wheel, so
 * the folder does not read as twenty nearby shades.
 */
function paletteFor(index) {
  const hue = (277 + index * 137.508) % 360;
  return {
    hue,
    light: oklch(0.9, 0.09, hue - 28),
    accent: oklch(0.78, 0.16, hue + 46),
    dark: oklch(0.22, 0.07, hue - 42),
  };
}

function render(kind, index) {
  const { width, height, from, to, vignette } = SURFACES[kind];
  const palette = paletteFor(index);
  const motif = MOTIFS[index][kind].replace(
    /\{(light|accent|dark)\}/g,
    (_, role) => palette[role],
  );
  const stop = (offset, [lightness, chroma, shift]) =>
    `<stop offset="${offset}" stop-color="${oklch(lightness, chroma, palette.hue + shift)}"/>`;
  const defs =
    `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">${stop(0, from)}${stop(1, to)}</linearGradient>` +
    `<radialGradient id="v" cx="${vignette.cx}" cy="${vignette.cy}" r="${vignette.r}">` +
    `<stop offset="0" stop-color="white" stop-opacity="${vignette.white}"/>` +
    `<stop offset="1" stop-color="black" stop-opacity="${vignette.black}"/></radialGradient>`;
  const cover = (fill) => `<rect width="${width}" height="${height}" fill="${fill}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    `<defs>${defs}</defs>${cover("url(#g)")}${motif}${cover("url(#v)")}</svg>\n`
  );
}

MOTIFS.forEach((_, index) => {
  const directory = join(
    outputRoot,
    "identity",
    "defaults",
    String(index + 1).padStart(2, "0"),
  );
  mkdirSync(directory, { recursive: true });
  for (const kind of Object.keys(SURFACES)) {
    writeFileSync(join(directory, `${kind}.svg`), render(kind, index));
  }
});

console.log(`default: ${MOTIFS.length} matching avatar/banner pairs`);
