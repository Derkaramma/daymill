// Pure helpers for the house card editor: reading lines out of a config,
// writing changes back, cleaning the config before it goes to HA, undo
// history and layout import/export. No DOM here, so node tests can use it.

import { DEFAULT_LAYOUT, normalizeConfig } from "../cards/house/layout.js";

export const LINE_KEYS = ["home", "grid", "battery"];
export const CHIP_KEYS = ["solar", "home", "grid", "battery", "rate", "today"];
export const ROLES = ["presence_entity", "charging_entity", "power_entity", "battery_entity", "plugged_entity", "limit_entity"];
// keys that make up a layout export
export const LAYOUT_KEYS = ["image_day", "image_night", "image_aspect", "night_dim", "layout", "cars", "colors"];

export const r4 = (v) => Math.round(v * 1e4) / 1e4;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const TOKENS = /[MLHVCSQTAZmlhvcsqtaz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

// SVG path string (0-1 units) -> {pts, curved}. Curves keep their end
// points only, which is close enough to start editing from.
export function pathPoints(d) {
  const toks = String(d).match(TOKENS) || [];
  const pts = [];
  let cur = [0, 0];
  let first = null;
  let curved = false;
  let i = 0;
  let cmd = "";
  while (i < toks.length) {
    if (/^[a-z]$/i.test(toks[i])) cmd = toks[i++];
    if (!cmd) break;
    const up = cmd.toUpperCase();
    const rel = cmd !== up;
    if (up === "Z") {
      if (first) {
        pts.push([...first]);
        cur = [...first];
      }
      cmd = "";
      continue;
    }
    const n = ARGS[up];
    const a = toks.slice(i, i + n).map(Number);
    if (a.length < n || a.some((v) => !Number.isFinite(v))) break;
    i += n;
    let next;
    if (up === "H") next = [rel ? cur[0] + a[0] : a[0], cur[1]];
    else if (up === "V") next = [cur[0], rel ? cur[1] + a[0] : a[0]];
    else {
      const ex = a[n - 2];
      const ey = a[n - 1];
      next = rel ? [cur[0] + ex, cur[1] + ey] : [ex, ey];
    }
    if (!"MLHV".includes(up)) curved = true;
    pts.push(next);
    cur = next;
    if (up === "M") {
      first = next;
      cmd = rel ? "l" : "L"; // extra pairs after M are line-tos
    }
  }
  return { pts, curved };
}

// Any line value from a config -> {pts, curved} (pts may be empty).
export function toPoints(v) {
  if (v === undefined || v === null || v === false) return { pts: [], curved: false };
  if (typeof v === "string") return pathPoints(v);
  if (typeof v === "object" && !Array.isArray(v)) return toPoints(v.d ?? v.points);
  if (!Array.isArray(v)) return { pts: [], curved: false };
  const pts = v
    .map((p) => (Array.isArray(p) ? [+p[0], +p[1]] : p && typeof p === "object" ? [+p.x, +p.y] : null))
    .filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  return { pts, curved: false };
}

export const roundPts = (pts) => pts.map(([x, y]) => [r4(x), r4(y)]);

// ---- reading the effective layout ----

// Lines as the card will draw them (defaults filled in), as point lists.
// Keys: solar0, solar1, ..., home, grid, battery.
export function effectiveLines(config) {
  const src = config?.layout?.lines || {};
  const out = {};
  let solar = src.solar === undefined ? DEFAULT_LAYOUT.lines.solar : src.solar;
  if (solar && !Array.isArray(solar)) solar = [solar];
  if (Array.isArray(solar) && solar.length && Array.isArray(solar[0]) && Number.isFinite(+solar[0][0])) solar = [solar];
  (solar || []).forEach((l, i) => (out[`solar${i}`] = toPoints(l)));
  for (const k of LINE_KEYS) out[k] = toPoints(src[k] === undefined ? DEFAULT_LAYOUT.lines[k] : src[k]);
  return out;
}

export const solarCount = (config) => Object.keys(effectiveLines(config)).filter((k) => k.startsWith("solar")).length;

// Normalized config, or null when the config is broken.
export function normalized(config) {
  try {
    return normalizeConfig(clean(config));
  } catch {
    return null;
  }
}

// ---- writing ----

// Immutable set at a path. Missing objects on the way are created.
export function setIn(obj, path, value) {
  const [k, ...rest] = path;
  const base = Array.isArray(obj) ? [...obj] : { ...(obj || {}) };
  if (!rest.length) {
    if (value === undefined) {
      if (Array.isArray(base)) base.splice(k, 1);
      else delete base[k];
    } else base[k] = value;
    return base;
  }
  base[k] = setIn(base[k], rest, value);
  return base;
}

export function getIn(obj, path) {
  return path.reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);
}

// Write one line back as points. Solar lines are a list, so every solar
// line is written out once one of them changes.
export function setLine(config, key, pts) {
  const value = pts ? roundPts(pts) : false;
  if (key.startsWith("solar")) {
    const i = Number(key.slice(5));
    const lines = effectiveLines(config);
    const list = Object.keys(lines)
      .filter((k) => k.startsWith("solar"))
      .map((k) => rawSolar(config, Number(k.slice(5))) ?? roundPts(lines[k].pts));
    list[i] = value === false ? [] : value;
    return setIn(config, ["layout", "lines", "solar"], list);
  }
  return setIn(config, ["layout", "lines", key], value);
}

// The solar line as written in the config (kept as-is when not edited).
function rawSolar(config, i) {
  const src = config?.layout?.lines?.solar;
  if (src === undefined) return undefined;
  if (Array.isArray(src) && src.length && Array.isArray(src[0]) && Number.isFinite(+src[0][0])) return i === 0 ? src : undefined;
  return Array.isArray(src) ? src[i] : i === 0 ? src : undefined;
}

export function addSolarLine(config) {
  const n = solarCount(config);
  return setLine(config, `solar${n}`, []);
}

export function removeSolarLine(config, i) {
  const lines = effectiveLines(config);
  const list = Object.keys(lines)
    .filter((k) => k.startsWith("solar"))
    .map((k) => rawSolar(config, Number(k.slice(5))) ?? roundPts(lines[k].pts));
  list.splice(i, 1);
  return setIn(config, ["layout", "lines", "solar"], list);
}

// Cars as an editable list. With no cars in the config the card shows the
// cars SunFlow found; editing turns them into config entries linked by slug.
export function carsFor(config, known = []) {
  if (Array.isArray(config?.cars)) return config.cars;
  return known.map((k, i) => ({ sunflow: k.slug || undefined, name: k.name || "", ...(i % 2 ? { flip: true } : {}) }));
}

export function setCar(config, known, i, patch) {
  const cars = carsFor(config, known).map((c) => ({ ...c }));
  cars[i] = { ...cars[i], ...patch };
  for (const [k, v] of Object.entries(cars[i])) if (v === undefined || v === null || v === "") delete cars[i][k];
  return { ...config, cars };
}

// ---- cleaning ----

// What gets sent to HA: lines with fewer than two points are dropped
// (or turned off), empty objects removed.
export function clean(config) {
  const out = clone(config) || {};
  const lines = out.layout?.lines;
  if (lines) {
    if (Array.isArray(lines.solar)) {
      const single = lines.solar.length && Array.isArray(lines.solar[0]) && Number.isFinite(+lines.solar[0][0]);
      if (!single) lines.solar = lines.solar.filter((l) => typeof l === "string" || (l && typeof l === "object" && !Array.isArray(l)) || (Array.isArray(l) && l.length >= 2));
    }
    for (const k of LINE_KEYS) if (Array.isArray(lines[k]) && lines[k].length < 2) lines[k] = false;
  }
  for (const c of out.cars || []) {
    if (Array.isArray(c.cable) && c.cable.length < 2) delete c.cable;
  }
  return prune(out);
}

function prune(v) {
  if (Array.isArray(v)) return v.map(prune);
  if (!v || typeof v !== "object") return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (x === undefined) continue;
    const p = prune(x);
    if (p && typeof p === "object" && !Array.isArray(p) && !Object.keys(p).length && k !== "entities") continue;
    out[k] = p;
  }
  return out;
}

// ---- geometry ----

// Closest segment of a polyline to p, in pixels. Returns {index, dist, t}.
export function nearestSegment(pts, p) {
  let best = { index: -1, dist: Infinity, t: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2, 0, 1) : 0;
    const d = Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
    if (d < best.dist) best = { index: i, dist: d, t };
  }
  return best;
}

// Snap a pixel point to the nearest target within tol, else line it up
// with a neighbor on either axis. Returns the snapped point.
export function snap(p, targets = [], neighbors = [], tol = 8) {
  let best = null;
  let bestD = tol;
  for (const t of targets) {
    const d = Math.hypot(t[0] - p[0], t[1] - p[1]);
    if (d <= bestD) {
      best = t;
      bestD = d;
    }
  }
  if (best) return [best[0], best[1]];
  const out = [p[0], p[1]];
  let dx = tol * 0.75;
  let dy = tol * 0.75;
  for (const n of neighbors) {
    if (Math.abs(n[0] - p[0]) < dx) {
      dx = Math.abs(n[0] - p[0]);
      out[0] = n[0];
    }
    if (Math.abs(n[1] - p[1]) < dy) {
      dy = Math.abs(n[1] - p[1]);
      out[1] = n[1];
    }
  }
  return out;
}

// ---- undo ----

export class History {
  constructor(limit = 100) {
    this.limit = limit;
    this.past = [];
    this.future = [];
  }

  push(snapshot) {
    const s = clone(snapshot);
    if (this.past.length && same(this.past.at(-1), s)) return;
    this.past.push(s);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current) {
    if (!this.past.length) return undefined;
    this.future.push(clone(current));
    return this.past.pop();
  }

  redo(current) {
    if (!this.future.length) return undefined;
    this.past.push(clone(current));
    return this.future.pop();
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }
}

// ---- import / export ----

export function exportLayout(config) {
  const out = { sunflow_layout: 1 };
  for (const k of LAYOUT_KEYS) if (config?.[k] !== undefined) out[k] = clone(config[k]);
  return out;
}

// Merge a layout export into a config. Throws a readable error if the JSON
// is not a layout or would break the card.
export function importLayout(config, text) {
  let data;
  try {
    data = typeof text === "string" ? JSON.parse(text) : text;
  } catch {
    throw new Error("bad_json");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("bad_json");
  const picked = {};
  for (const k of LAYOUT_KEYS) if (data[k] !== undefined) picked[k] = data[k];
  if (!Object.keys(picked).length) throw new Error("no_layout");
  const next = { ...config, ...picked };
  normalizeConfig(clean(next)); // throws on a broken layout
  return next;
}
