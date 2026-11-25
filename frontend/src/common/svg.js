// Small SVG builders: scales, line/area paths, arcs and donuts.

import { s } from "./dom.js";

export { s as svgEl } from "./dom.js";

const r2 = (n) => Math.round(n * 100) / 100;

// <svg viewBox="0 0 w h">
export function svgRoot(w, h, props = {}) {
  return s("svg", { viewBox: `0 0 ${w} ${h}`, ...props });
}

export function path(d, props = {}) {
  return s("path", { d, ...props });
}

// Linear scale: scale([0, 10], [0, 200])(5) -> 100.
export function scale([d0, d1], [r0, r1]) {
  const span = d1 - d0 || 1;
  const f = (v) => r0 + ((v - d0) / span) * (r1 - r0);
  f.domain = [d0, d1];
  f.range = [r0, r1];
  return f;
}

// [min, max] of values, padded so a flat series still gets a range.
export function extent(values, { zero = false, pad = 0 } = {}) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === Infinity) return [0, 1];
  if (zero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (lo === hi) hi = lo + 1;
  const p = (hi - lo) * pad;
  return [zero && lo === 0 ? 0 : lo - p, hi + p];
}

// "Nice" axis ticks, about `count` of them.
export function ticks(lo, hi, count = 4) {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(r2(v));
  return out;
}

// Points [[x, y], ...] -> "M..L.." path.
export function linePath(points) {
  return points.map(([x, y], i) => `${i ? "L" : "M"}${r2(x)},${r2(y)}`).join("");
}

// Step line: value holds until the next point (how HA history looks).
export function stepPath(points) {
  let d = "";
  points.forEach(([x, y], i) => {
    if (!i) d += `M${r2(x)},${r2(y)}`;
    else d += `H${r2(x)}V${r2(y)}`;
  });
  return d;
}

// Closed area between the line and baseline y.
export function areaPath(points, baseY, step = false) {
  if (!points.length) return "";
  const line = step ? stepPath(points) : linePath(points);
  const first = points[0];
  const last = points[points.length - 1];
  return `${line}L${r2(last[0])},${r2(baseY)}L${r2(first[0])},${r2(baseY)}Z`;
}

// Series [{t, v}] -> points with the given x/y scales.
export function project(series, x, y) {
  return series.map((p) => [x(p.t), y(p.v)]);
}

// Point on a circle, angle in degrees with 0 at 12 o'clock, clockwise.
export function polar(cx, cy, r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

// Arc along a circle from a0 to a1 degrees (clockwise).
export function arcPath(cx, cy, r, a0, a1) {
  const sweep = Math.min(Math.max(a1 - a0, 0), 359.999);
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a0 + sweep);
  return `M${r2(x0)},${r2(y0)}A${r2(r)},${r2(r)} 0 ${sweep > 180 ? 1 : 0} 1 ${r2(x1)},${r2(y1)}`;
}

// Donut made of stroked arcs. segments: [{value, color, class}]. gap is in
// degrees between segments (skipped when only one segment is non-zero).
export function donut({ size = 100, width = 10, segments = [], gap = 4, track } = {}) {
  const c = size / 2;
  const r = c - width / 2;
  const root = svgRoot(size, size);
  if (track) root.append(s("circle", { cx: c, cy: c, r, fill: "none", stroke: track, "stroke-width": width }));
  const live = segments.filter((seg) => seg.value > 0);
  const total = live.reduce((a, seg) => a + seg.value, 0);
  if (!total) return root;
  const g = live.length > 1 ? gap : 0;
  let a = 0;
  for (const seg of live) {
    const sweep = (seg.value / total) * 360;
    const props = {
      fill: "none",
      stroke: seg.color || "currentColor",
      "stroke-width": width,
      "stroke-linecap": "butt",
    };
    if (seg.class) props.class = seg.class;
    if (sweep >= 359.999) root.append(s("circle", { cx: c, cy: c, r, ...props }));
    else root.append(path(arcPath(c, c, r, a + g / 2, a + sweep - g / 2), props));
    a += sweep;
  }
  return root;
}
