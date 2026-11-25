// Series helpers for the charts. A series is [{t: ms, v: number}] sorted by t.

import { offset as zoneOffset } from "./zone.js";

// Time-weighted average per bucket. History only stores changes, so each
// value holds until the next one. Buckets line up with the local clock
// in tz (10 min buckets start at :00, :10, ...; default: the browser's zone).
// Returns one point per bucket that has data, placed in the middle of the
// bucket (clipped to from/to).
export function bucketAverage(series, from, to, minutes, tz) {
  const step = Math.max(1, minutes) * 60_000;
  const out = [];
  if (!series?.length || !(to > from)) return out;
  const off = tz ? zoneOffset(from, tz) : -new Date(from).getTimezoneOffset() * 60_000;
  const first = Math.floor((from + off) / step) * step - off;
  let i = 0;
  for (let b0 = first; b0 < to; b0 += step) {
    const lo = Math.max(b0, from);
    const hi = Math.min(b0 + step, to);
    // last point at or before the bucket start carries in
    while (i < series.length - 1 && series[i + 1].t <= lo) i++;
    if (series[i].t > hi) continue;
    let area = 0;
    let covered = 0;
    for (let j = i; j < series.length && series[j].t < hi; j++) {
      const segStart = Math.max(lo, series[j].t);
      const segEnd = j + 1 < series.length ? Math.min(series[j + 1].t, hi) : hi;
      if (segEnd > segStart) {
        area += series[j].v * (segEnd - segStart);
        covered += segEnd - segStart;
      }
    }
    if (covered > 0) out.push({ t: (lo + hi) / 2, v: area / covered });
  }
  return out;
}

// Keep points inside [from, to], plus the one just before `from` so a step
// line starts at the left edge.
export function clip(series, from, to = Infinity) {
  if (!series?.length) return [];
  let i = 0;
  while (i < series.length - 1 && series[i + 1].t <= from) i++;
  return series.slice(i).filter((p) => p.t <= to);
}

// Add a live reading to a raw series if it's newer than the last point.
export function appendLive(series, t, v) {
  if (!Number.isFinite(t) || !Number.isFinite(v)) return false;
  const last = series[series.length - 1];
  if (last && t <= last.t) return false;
  if (last && last.v === v) return false;
  series.push({ t, v });
  return true;
}

// For a step line: extend the last value to `to`.
export function holdUntil(series, to) {
  if (!series.length) return series;
  const last = series[series.length - 1];
  return last.t < to ? [...series, { t: to, v: last.v }] : series;
}
