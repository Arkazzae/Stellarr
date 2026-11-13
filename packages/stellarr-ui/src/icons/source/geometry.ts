/**
 * Geometry for drawing the Stellarr icon family.
 *
 * Glyphs are authored as SVG path data (absolute or relative M L H V C A Z)
 * and the helpers below. Everything they compute comes out as absolute
 * M / L / C / Z with two decimals. Corners, circles, the gaps of the broken
 * variant and the knock-outs around a slash are computed, which keeps one
 * measure across the family instead of numbers tuned by hand per glyph.
 *
 * Only `scripts/build-icons.mjs` runs this code; the apps read the static
 * table it writes to `../paths.ts`.
 */
export type IconPath = string;
export type IconVariant = "linear" | "broken";
/** A stroke drawn the same in both variants, or one with its own broken form. */
export type IconStroke = IconPath | { readonly linear: IconPath; readonly broken: IconPath };

type Pt = readonly [number, number];
type Seg = { p0: Pt; c1?: Pt; c2?: Pt; p: Pt };
type Sub = { segs: Seg[]; closed: boolean; start: Pt };

/** Corner softness: a corner's handles sit this fraction of its reach from the vertex. */
const SOFT = 0.3;
const KAPPA = 0.5523;
/** Path length a broken gap removes; round caps leave about 1.6 units open. */
export const GAP = 3.1;
/** Least distance, centre to centre, between a slash and what it knocks out. */
export const CLEAR = 2.5;

const fmt = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Math.abs(r) < 0.005 ? "0" : String(r);
};
const pt = (p: Pt) => `${fmt(p[0])} ${fmt(p[1])}`;
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function arcToCubics(p0: Pt, rx: number, ry: number, phiDeg: number, large: number, sweep: number, p: Pt): Seg[] {
  // SVG implementation notes F.6.5 (centre parameterisation), then pieces of at most 90°.
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0[0] - p[0]) / 2;
  const dy = (p0[1] - p[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let co = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) co = -co;
  const cx1 = (co * rx * y1) / ry;
  const cy1 = (-co * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (p0[1] + p[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-6));
  const step = dt / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const at = (t: number): Pt => [
    cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
  ];
  const der = (t: number): Pt => [
    -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin,
    -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos,
  ];
  const segs: Seg[] = [];
  let prev = p0;
  for (let i = 0; i < n; i++) {
    const a = t1 + i * step;
    const b = a + step;
    const da = der(a);
    const db = der(b);
    const end = i === n - 1 ? p : at(b);
    const pa = at(a);
    segs.push({ p0: prev, c1: [pa[0] + k * da[0], pa[1] + k * da[1]], c2: [end[0] - k * db[0], end[1] - k * db[1]], p: end });
    prev = end;
  }
  return segs;
}

export function parse(d: string): Sub[] {
  const tokens = d.match(/[MLHVCAZmlhvcaz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? [];
  const subs: Sub[] = [];
  let i = 0;
  let cmd = "";
  let cur: Pt = [0, 0];
  let sub: Sub | null = null;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i]!)) cmd = tokens[i++]!;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const off = (x: number, y: number): Pt => (rel ? [cur[0] + x, cur[1] + y] : [x, y]);
    if (C === "Z") {
      if (sub) {
        if (Math.hypot(cur[0] - sub.start[0], cur[1] - sub.start[1]) > 1e-6) sub.segs.push({ p0: cur, p: sub.start });
        sub.closed = true;
        cur = sub.start;
      }
      continue;
    }
    if (C === "M") {
      cur = off(num(), num());
      sub = { segs: [], closed: false, start: cur };
      subs.push(sub);
      cmd = rel ? "l" : "L";
      continue;
    }
    if (!sub) throw new Error(`path must start with M: ${d}`);
    let p: Pt;
    if (C === "L") {
      p = off(num(), num());
      sub.segs.push({ p0: cur, p });
    } else if (C === "H") {
      const x = num();
      p = [rel ? cur[0] + x : x, cur[1]];
      sub.segs.push({ p0: cur, p });
    } else if (C === "V") {
      const y = num();
      p = [cur[0], rel ? cur[1] + y : y];
      sub.segs.push({ p0: cur, p });
    } else if (C === "C") {
      const c1 = off(num(), num());
      const c2 = off(num(), num());
      p = off(num(), num());
      sub.segs.push({ p0: cur, c1, c2, p });
    } else if (C === "A") {
      const rx = num();
      const ry = num();
      const rot = num();
      const large = num();
      const sweep = num();
      p = off(num(), num());
      sub.segs.push(...arcToCubics(cur, rx, ry, rot, large, sweep, p));
    } else {
      throw new Error(`unsupported command ${cmd} in ${d}`);
    }
    cur = p;
  }
  return subs;
}

export function serialize(subs: readonly Sub[]): string {
  return subs
    .map((s) => {
      let out = `M${pt(s.start)}`;
      s.segs.forEach((g, i) => {
        if (s.closed && i === s.segs.length - 1 && !g.c1) return; // Z draws the closing line
        out += g.c1 && g.c2 ? `C${pt(g.c1)} ${pt(g.c2)} ${pt(g.p)}` : `L${pt(g.p)}`;
      });
      return s.closed ? `${out}Z` : out;
    })
    .join("");
}

/** Normalise authored path data to absolute M / L / C / Z. */
export const norm = (d: string) => serialize(parse(d));

/** Apply an affine matrix [a b c d e f], as SVG writes it, to every point. */
export function transform(d: string, [a, b, c, dd, e, f]: readonly [number, number, number, number, number, number]): string {
  const m = (p: Pt): Pt => [a * p[0] + c * p[1] + e, b * p[0] + dd * p[1] + f];
  return serialize(
    parse(d).map((s) => ({
      closed: s.closed,
      start: m(s.start),
      segs: s.segs.map((g) => ({ p0: m(g.p0), c1: g.c1 && m(g.c1), c2: g.c2 && m(g.c2), p: m(g.p) })),
    })),
  );
}
/** Rotate clockwise by `deg` about (cx, cy). */
export const rotate = (d: string, deg: number, cx = 12, cy = 12) => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return transform(d, [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]);
};
/** Mirror left to right about x = cx. */
export const mirror = (d: string, cx = 12) => transform(d, [-1, 0, 0, 1, 2 * cx, 0]);
export const move = (d: string, dx: number, dy: number) => transform(d, [1, 0, 0, 1, dx, dy]);
export const scale = (d: string, sx: number, sy = sx, cx = 12, cy = 12) =>
  transform(d, [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy]);

// ── Shapes ────────────────────────────────────────────────────────────────

/** Rectangle with soft corners of the given reach, clockwise from the top edge. */
export function rect(x1: number, y1: number, x2: number, y2: number, r: number): IconPath {
  r = Math.min(r, (x2 - x1) / 2, (y2 - y1) / 2);
  const h = r * SOFT;
  const L = (x: number, y: number) => `L${fmt(x)} ${fmt(y)}`;
  const C = (a: number, b: number, c: number, d: number, x: number, y: number) =>
    `C${fmt(a)} ${fmt(b)} ${fmt(c)} ${fmt(d)} ${fmt(x)} ${fmt(y)}`;
  return [
    `M${fmt(x1 + r)} ${fmt(y1)}`,
    L(x2 - r, y1),
    C(x2 - h, y1, x2, y1 + h, x2, y1 + r),
    L(x2, y2 - r),
    C(x2, y2 - h, x2 - h, y2, x2 - r, y2),
    L(x1 + r, y2),
    C(x1 + h, y2, x1, y2 - h, x1, y2 - r),
    L(x1, y1 + r),
    C(x1, y1 + h, x1 + h, y1, x1 + r, y1),
    "Z",
  ].join("");
}

/** Circle (or ellipse) as four cubics, clockwise from the top. */
export function circle(cx: number, cy: number, r: number, ry = r): IconPath {
  const k = KAPPA * r;
  const ky = KAPPA * ry;
  return norm(
    `M${cx} ${cy - ry}C${cx + k} ${cy - ry} ${cx + r} ${cy - ky} ${cx + r} ${cy}` +
      `C${cx + r} ${cy + ky} ${cx + k} ${cy + ry} ${cx} ${cy + ry}` +
      `C${cx - k} ${cy + ry} ${cx - r} ${cy + ky} ${cx - r} ${cy}` +
      `C${cx - r} ${cy - ky} ${cx - k} ${cy - ry} ${cx} ${cy - ry}Z`,
  );
}

/** Arc of a circle from angle a0 to a1, in degrees clockwise from 12 o'clock. */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number): IconPath {
  const p = (a: number): Pt => [cx + r * Math.sin((a * Math.PI) / 180), cy - r * Math.cos((a * Math.PI) / 180)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const sweep = a1 > a0 ? 1 : 0;
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return norm(`M${x0} ${y0}A${r} ${r} 0 ${large} ${sweep} ${x1} ${y1}`);
}

/**
 * Polygon, or polyline when `open`, through the points with every inner
 * corner softened to the given reach (one number, or one per point).
 */
export function poly(points: readonly Pt[], r: number | readonly number[], open = false): IconPath {
  const n = points.length;
  const at = (i: number) => points[((i % n) + n) % n]!;
  const reach = (i: number) => (typeof r === "number" ? r : (r[i] ?? 0));
  const corner = (i: number): [Pt, Pt, Pt, Pt] | null => {
    const P = at(i);
    const A = at(i - 1);
    const B = at(i + 1);
    const la = Math.hypot(A[0] - P[0], A[1] - P[1]);
    const lb = Math.hypot(B[0] - P[0], B[1] - P[1]);
    const rr = Math.min(reach(i), la / 2, lb / 2);
    if (rr <= 0) return null;
    const a = lerp(P, A, rr / la);
    const b = lerp(P, B, rr / lb);
    return [a, lerp(a, P, 1 - SOFT), lerp(b, P, 1 - SOFT), b];
  };
  const out: string[] = [];
  const c0 = corner(0);
  out.push(`M${pt(open || !c0 ? at(0) : c0[3])}`);
  for (let j = 1; j < n; j++) {
    const c = open && j === n - 1 ? null : corner(j);
    out.push(c ? `L${pt(c[0])}C${pt(c[1])} ${pt(c[2])} ${pt(c[3])}` : `L${pt(at(j))}`);
  }
  if (!open) {
    if (c0) out.push(`L${pt(c0[0])}C${pt(c0[1])} ${pt(c0[2])} ${pt(c0[3])}`);
    out.push("Z");
  }
  return norm(out.join(""));
}

// ── Gaps and knock-outs ───────────────────────────────────────────────────

/** A gap: the point on a contour it centres on, and its length (GAP by default). */
export type Gap = readonly [x: number, y: number, length?: number];

const evalSeg = (g: Seg, t: number): Pt => {
  if (!g.c1 || !g.c2) return lerp(g.p0, g.p, t);
  const u = 1 - t;
  return [
    u * u * u * g.p0[0] + 3 * u * u * t * g.c1[0] + 3 * u * t * t * g.c2[0] + t * t * t * g.p[0],
    u * u * u * g.p0[1] + 3 * u * u * t * g.c1[1] + 3 * u * t * t * g.c2[1] + t * t * t * g.p[1],
  ];
};

/** The part of a segment between t0 and t1. */
function sliceSeg(g: Seg, t0: number, t1: number): Seg {
  if (!g.c1 || !g.c2) return { p0: lerp(g.p0, g.p, t0), p: lerp(g.p0, g.p, t1) };
  const split = (s: Seg & { c1: Pt; c2: Pt }, t: number): [Seg & { c1: Pt; c2: Pt }, Seg & { c1: Pt; c2: Pt }] => {
    const a = lerp(s.p0, s.c1, t);
    const b = lerp(s.c1, s.c2, t);
    const c = lerp(s.c2, s.p, t);
    const ab = lerp(a, b, t);
    const bc = lerp(b, c, t);
    const m = lerp(ab, bc, t);
    return [
      { p0: s.p0, c1: a, c2: ab, p: m },
      { p0: m, c1: bc, c2: c, p: s.p },
    ];
  };
  let s = { p0: g.p0, c1: g.c1, c2: g.c2, p: g.p };
  if (t1 < 1) s = split(s, t1)[0];
  if (t0 > 0) s = split(s, t0 / t1)[1];
  return s;
}

/** Points along every contour of `d`, `steps` per segment. */
export function samples(d: string, steps = 60): Pt[][] {
  return parse(d).map((s) => {
    const out: Pt[] = [s.start];
    for (const g of s.segs) for (let k = 1; k <= steps; k++) out.push(evalSeg(g, k / steps));
    return out;
  });
}

/** Arc-length table of one contour. */
function measure(s: Sub, steps: number) {
  const rows: { seg: number; t: number; s: number; p: Pt }[] = [];
  let acc = 0;
  let prev = s.start;
  s.segs.forEach((g, si) => {
    for (let k = si === 0 ? 0 : 1; k <= steps; k++) {
      const t = k / steps;
      const p = evalSeg(g, t);
      acc += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      rows.push({ seg: si, t, s: acc, p });
      prev = p;
    }
  });
  return { rows, total: acc };
}

/** Cut gaps out of the contours of `d`; each gap snaps to the nearest contour. */
export function cut(d: string, gaps: readonly Gap[]): IconPath {
  const subs = parse(d);
  const tables = subs.map((s) => measure(s, 200));
  const cuts = new Map<number, { s0: number; s1: number }[]>();
  for (const [x, y, len = GAP] of gaps) {
    let best = { sub: -1, s: 0, dist: Infinity };
    tables.forEach((tb, si) => {
      for (const r of tb.rows) {
        const dist = Math.hypot(r.p[0] - x, r.p[1] - y);
        if (dist < best.dist) best = { sub: si, s: r.s, dist };
      }
    });
    if (best.dist > 1) throw new Error(`gap at ${x},${y} is ${best.dist.toFixed(2)} off the contour of ${d}`);
    const list = cuts.get(best.sub) ?? [];
    list.push({ s0: best.s - len / 2, s1: best.s + len / 2 });
    cuts.set(best.sub, list);
  }
  const out: Sub[] = [];
  subs.forEach((s, si) => {
    const list = cuts.get(si);
    if (!list) return void out.push(s);
    const { rows, total } = tables[si]!;
    const locate = (sv: number): { seg: number; t: number } => {
      if (s.closed) sv = ((sv % total) + total) % total;
      sv = Math.max(0, Math.min(total, sv));
      let lo = 0;
      let hi = rows.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (rows[mid]!.s < sv) lo = mid + 1;
        else hi = mid;
      }
      const r = rows[lo]!;
      const pr = lo > 0 ? rows[lo - 1]! : { seg: r.seg, t: 0, s: 0 };
      const f = r.s === pr.s ? 0 : (sv - pr.s) / (r.s - pr.s);
      return { seg: r.seg, t: pr.seg === r.seg ? pr.t + (r.t - pr.t) * f : r.t * f };
    };
    // Merge gaps that overlap, also across the seam of a closed contour.
    const merged: { s0: number; s1: number }[] = [];
    for (const c of [...list].sort((x, y) => x.s0 - y.s0)) {
      const last = merged[merged.length - 1];
      if (last && c.s0 <= last.s1) last.s1 = Math.max(last.s1, c.s1);
      else merged.push({ ...c });
    }
    const first = merged[0]!;
    const last = merged[merged.length - 1]!;
    if (s.closed && merged.length > 1 && last.s1 - total >= first.s0) {
      first.s0 = last.s0 - total;
      first.s1 = Math.max(first.s1, last.s1 - total);
      merged.pop();
    }
    // The runs of contour kept between consecutive gaps, in arc length.
    const runs: [number, number][] = [];
    if (s.closed) {
      merged.forEach((c, i) => {
        const next = merged[(i + 1) % merged.length]!;
        runs.push([c.s1, i + 1 < merged.length ? next.s0 : next.s0 + total]);
      });
    } else {
      let from = 0;
      for (const c of merged) {
        if (c.s0 > from) runs.push([from, c.s0]);
        from = c.s1;
      }
      if (from < total) runs.push([from, total]);
    }
    for (const [a, b] of runs) {
      const segs: Seg[] = [];
      const n = s.segs.length;
      const A = locate(a);
      const B = locate(b);
      const lapB = s.closed ? Math.floor(b / total) : 0;
      let seg = A.seg;
      let lap = s.closed ? Math.floor(a / total) : 0;
      let t0 = A.t;
      for (let guard = 0; ; guard++) {
        if (guard > n * 3) throw new Error(`gap walk did not close on ${d}`);
        const end = seg === B.seg && lap === lapB;
        const t1 = end ? B.t : 1;
        if (t1 > t0 + 1e-6) segs.push(sliceSeg(s.segs[seg]!, t0, t1));
        if (end) break;
        seg++;
        t0 = 0;
        if (seg >= n) {
          seg = 0;
          lap++;
        }
      }
      if (segs.length) out.push({ segs, closed: false, start: segs[0]!.p0 });
    }
  });
  return serialize(out);
}

/** A stroke whose broken variant loses the given gaps. */
export const brk = (d: string, ...gaps: Gap[]): IconStroke => ({ linear: norm(d), broken: cut(d, gaps) });

/** Apply a path transform to both variants of a stroke. */
export const mapStroke = (s: IconStroke, f: (d: string) => string): IconStroke =>
  typeof s === "string" ? f(s) : { linear: f(s.linear), broken: f(s.broken) };

const segDist = (p: Pt, a: Pt, b: Pt) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};

/**
 * Knock out every part of the contours of `d` that comes closer than `clear`
 * (centre to centre) to the obstacle: a slash, or any stroke laid over it.
 * A crossing and a near-parallel run are handled alike. Applies to both variants.
 */
export function knockNear(d: string, obstacle: string, clear = CLEAR): IconPath {
  const obs = samples(obstacle, 40);
  const near = (p: Pt) =>
    obs.some((line) =>
      line.length === 1
        ? Math.hypot(p[0] - line[0]![0], p[1] - line[0]![1]) < clear
        : line.some((q, i) => i > 0 && segDist(p, line[i - 1]!, q) < clear),
    );
  const gaps: Gap[] = [];
  for (const sub of parse(d)) {
    const { rows, total } = measure(sub, 120);
    const flags = rows.map((r) => near(r.p));
    const runs: [number, number][] = [];
    let start = -1;
    flags.forEach((f, i) => {
      if (f && start < 0) start = i;
      if ((!f || i === flags.length - 1) && start >= 0) {
        runs.push([rows[start]!.s, rows[f ? i : i - 1]!.s]);
        start = -1;
      }
    });
    if (sub.closed && runs.length > 1 && runs[0]![0] === 0 && runs[runs.length - 1]![1] === total) {
      const last = runs.pop()!;
      runs[0] = [last[0] - total, runs[0]![1]];
    }
    const at = (sv: number): Pt => {
      const v = ((sv % total) + total) % total;
      let best = rows[0]!;
      for (const r of rows) if (Math.abs(r.s - v) < Math.abs(best.s - v)) best = r;
      return best.p;
    };
    for (const [a, b] of runs) {
      const len = b - a;
      // A run that reaches an open end is cut slightly past it.
      if (!sub.closed && a <= 0.01) gaps.push([...at(len / 2 - 0.01), len + 0.02]);
      else if (!sub.closed && b >= total - 0.01) gaps.push([...at(a + len / 2 + 0.01), len + 0.02]);
      else gaps.push([...at(a + len / 2), len]);
    }
  }
  return gaps.length ? cut(d, gaps) : norm(d);
}

/** Knock the contours of `d` out around the straight slash from a to b. */
export const knockLine = (d: string, a: Pt, b: Pt, clear = CLEAR): IconPath =>
  knockNear(d, `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`, clear);

// ── Measuring and fitting ─────────────────────────────────────────────────

/** Bounding box of the centre line: [minX, minY, maxX, maxY]. */
export function bbox(d: string): [number, number, number, number] {
  const pts = samples(d).flat();
  return [
    Math.min(...pts.map((p) => p[0])),
    Math.min(...pts.map((p) => p[1])),
    Math.max(...pts.map((p) => p[0])),
    Math.max(...pts.map((p) => p[1])),
  ];
}

/** Scale and centre a group of strokes together so its larger side spans `size`. */
export function fitGroup(strokes: readonly IconStroke[], size: number): IconStroke[] {
  const b = bbox(strokes.map((s) => (typeof s === "string" ? s : s.linear)).join(""));
  const k = size / Math.max(b[2] - b[0], b[3] - b[1]);
  const cx = (b[0] + b[2]) / 2;
  const cy = (b[1] + b[3]) / 2;
  return strokes.map((s) => mapStroke(s, (d) => transform(d, [k, 0, 0, k, 12 - k * cx, 12 - k * cy])));
}

/** Shortest distance from a point to the centre line of `d`. */
export function distanceTo(d: string, x: number, y: number): number {
  let best = Infinity;
  for (const line of samples(d, 80)) for (const p of line) best = Math.min(best, Math.hypot(p[0] - x, p[1] - y));
  return best;
}

/** Dots along y from x0 to x1 every `step`, leaving out any that would crowd `curve`. */
export function dotsBeside(curve: string, y: number, x0: number, x1: number, step: number, clear = CLEAR): IconPath {
  let out = "";
  for (let x = x0; x <= x1 + 1e-6; x += step) if (distanceTo(curve, x, y) >= clear) out += `M${x} ${y}H${x + 0.01}`;
  return out;
}
