// Card config -> a normalized layout the house card draws from.
//
// Every position is a 0-1 fraction of the picture (x of its width, y of its
// height), so any photo size works and an editor only has to move numbers.
// Lines are either a list of points [[x, y], ...] or an SVG path string in
// the same 0-1 units (absolute or relative M/L/H/V/C/S/Q/T/Z commands).
//
// layout:
//   panel:    {x, y, w, h, skew, show, style: meter|box}
//   junction: [x, y] (default: on the panel face) or {x, y, show}
//   lines:    {solar: [line, ...], home: line, grid: line, battery: line}
//   battery:  {x, y, w, h, skew, show, image, image_night}
//             image: a picture of your battery (transparent PNG) drawn in the
//             box instead of the built-in one; image_night is optional
//   chips:    {solar|home|grid|battery|rate|today: {x, y, align, show}}
//             today stacks under rate unless it has its own x/y.
//   round_corners: true, or a radius as a fraction of the width
// cars: [{name, image, slot: {x, y, w}, flip, port: [x, y],
//         image: a picture URL, or builtin / builtin:suv / builtin:truck
//         cable: line, cable_start: [x, y], cable_sag (extra drop, 0-1 of car height),
//         chip: {x, y, align, show}, daymill: <slug>,
//         presence_entity, charging_entity, power_entity, battery_entity,
//         plugged_entity, limit_entity, charging_states: [...],
//         cable_behind: [car index, ...]   cars that hide the cable where they stand in front of it
//         cable_reveal: [[x, y, r], ...]   spots where the cable always shows, e.g. where it plugs in
//         charger_glow: [x, y]   where the charger glows while charging (default: cable start)}]
// Any chip can take tether: [x, y], a thin line from the chip to that spot.

// Internal drawing width. Height follows the picture's aspect ratio.
export const VW = 1600;
export const DEFAULT_ASPECT = 1.6;

// Layout that matches the built-in house drawing.
export const DEFAULT_LAYOUT = {
  panel: { x: 0.2063, y: 0.47, w: 0.0163, h: 0.076, skew: 0, show: true, style: "meter" },
  junction: null,
  lines: {
    solar: [[[0.2688, 0.298], [0.2144, 0.298], [0.2144, 0.47]]],
    home: [[0.2144, 0.514], [0.28, 0.514]],
    grid: [[0.2144, 0.514], [0.1875, 0.514], [0.1875, 0.66], [0, 0.66]],
    battery: [[0.2144, 0.514], [0.2144, 0.596], [0.2325, 0.596]],
  },
  battery: { x: 0.2325, y: 0.556, w: 0.021, h: 0.08, skew: 0, show: true },
  chips: {
    solar: { x: 0.35, y: 0.025, align: "center" },
    home: { x: 0.295, y: 0.39, align: "left" },
    grid: { x: 0.015, y: 0.7, align: "left" },
    battery: { x: 0.262, y: 0.655, align: "left" },
    rate: { x: 0.98, y: 0.03, align: "right" },
    today: { stack: true },
  },
};

// Car slots on the built-in driveway; more cars keep going right.
export function defaultSlot(i) {
  return { x: 0.52 + i * 0.15, y: 0.6, w: 0.135 };
}

const CAR_RATIO = 0.625;
export const ROUND_DEFAULT = 0.008;

// "builtin", "builtin:suv" ... -> the drawing to use, else "".
export const CAR_KINDS = ["sedan", "suv", "truck"];
export function builtinCar(image) {
  const m = /^builtin(?::(\w+))?$/.exec(String(image || ""));
  if (!m) return "";
  return CAR_KINDS.includes(m[1]) ? m[1] : "sedan";
} // height / width of a car picture (800x500 cutouts)

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function fail(msg) {
  throw new Error(`daymill-house-card: ${msg}`);
}

function point(v, where) {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v) && v.length >= 2 && isNum(+v[0]) && isNum(+v[1])) return [+v[0], +v[1]];
  if (typeof v === "object" && isNum(+v.x) && isNum(+v.y)) return [+v.x, +v.y];
  fail(`${where} must be [x, y]`);
}

// A line: list of points or a path string. Returns {pts} | {d} | null.
export function line(v, where) {
  if (v === undefined || v === null || v === false) return null;
  if (typeof v === "string") {
    if (!/^[\s\d.,eE+\-MLHVCSQTZmlhvcsqtz]+$/.test(v)) fail(`${where}: unsupported path`);
    return { d: v };
  }
  if (typeof v === "object" && !Array.isArray(v)) return line(v.d ?? v.points, where);
  if (!Array.isArray(v)) fail(`${where} must be a list of points`);
  const pts = v.map((p, i) => point(p, `${where}[${i}]`));
  if (pts.length < 2) fail(`${where} needs at least 2 points`);
  return { pts };
}

// optional picture links on a box: strings, or dropped when empty
function pictureKeys(b, where) {
  for (const k of ["image", "image_night"]) {
    if (b[k] === undefined || b[k] === null || b[k] === "") delete b[k];
    else if (typeof b[k] !== "string") fail(`${where}.${k} must be a picture link`);
  }
  if (!b.image) delete b.image_night;
  return b;
}

function box(v, base, where) {
  if (v === false) return { ...base, show: false };
  if (v === undefined || v === null) return { ...base };
  if (typeof v !== "object") fail(`${where} must be an object`);
  const out = { ...base, ...v };
  for (const k of ["x", "y", "w", "h", "skew"]) {
    out[k] = +out[k];
    if (!isNum(out[k])) fail(`${where}.${k} must be a number`);
  }
  out.show = out.show !== false;
  return out;
}

function chip(v, base, where) {
  if (v === false) return { ...base, show: false };
  const out = { align: "center", show: true, ...base, ...(v && typeof v === "object" ? v : {}) };
  if (v && typeof v === "object" && (v.x !== undefined || v.y !== undefined)) out.stack = false;
  if (!out.stack) {
    out.x = +out.x;
    out.y = +out.y;
    if (!isNum(out.x) || !isNum(out.y)) fail(`${where} needs x and y`);
  }
  if (!["left", "center", "right"].includes(out.align)) out.align = "center";
  out.show = out.show !== false;
  out.tether = out.tether === undefined || out.tether === null ? null : point(out.tether, `${where}.tether`);
  return out;
}

function lines(v) {
  const d = DEFAULT_LAYOUT.lines;
  const src = v || {};
  let solar = src.solar === undefined ? d.solar : src.solar;
  if (solar && !Array.isArray(solar)) solar = [solar];
  // one plain list of points is a single line, not a list of lines
  if (Array.isArray(solar) && solar.length && Array.isArray(solar[0]) && isNum(+solar[0][0])) solar = [solar];
  return {
    solar: (solar || []).map((l, i) => line(l, `layout.lines.solar[${i}]`)).filter(Boolean),
    home: line(src.home === undefined ? d.home : src.home, "layout.lines.home"),
    grid: line(src.grid === undefined ? d.grid : src.grid, "layout.lines.grid"),
    battery: line(src.battery === undefined ? d.battery : src.battery, "layout.lines.battery"),
  };
}

function nonNeg(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function aspectOf(v) {
  if (isNum(v) && v > 0) return v;
  if (typeof v === "string") {
    const m = v.match(/^\s*([\d.]+)\s*[/:x]\s*([\d.]+)\s*$/);
    if (m && +m[2] > 0) return +m[1] / +m[2];
    const n = Number(v);
    if (n > 0) return n;
  }
  return undefined;
}

function carChip(v, where) {
  if (v === false) return { show: false, auto: true, align: "center" };
  if (v && typeof v === "object" && v.x !== undefined) return chip(v, {}, where);
  const align = v && ["left", "center", "right"].includes(v.align) ? v.align : "center";
  return { show: !(v && v.show === false), auto: true, align };
}

const ROLES = ["presence_entity", "charging_entity", "power_entity", "battery_entity", "plugged_entity", "limit_entity"];

function car(c, i, where) {
  if (!c || typeof c !== "object") fail(`${where} must be an object`);
  const slot = box(c.slot, { ...defaultSlot(i), h: 0, skew: 0 }, `${where}.slot`);
  const ratio = nonNeg(c.image_ratio, CAR_RATIO) || CAR_RATIO;
  const out = {
    index: i,
    name: c.name ? String(c.name) : "",
    image: c.image ? String(c.image) : "",
    slot,
    ratio,
    flip: !!c.flip,
    port: point(c.port, `${where}.port`),
    cable: line(c.cable ?? c.cable_path, `${where}.cable`),
    cableStart: point(c.cable_start, `${where}.cable_start`),
    sag: nonNeg(c.cable_sag, 0),
    chip: carChip(c.chip, `${where}.chip`),
    daymill: c.daymill ? String(c.daymill) : "",
    chargingStates: Array.isArray(c.charging_states) ? c.charging_states.map((s) => String(s).toLowerCase()) : null,
    showCable: c.show_cable !== false,
    chargerGlow: point(c.charger_glow, `${where}.charger_glow`),
    cableBehind: Array.isArray(c.cable_behind) ? c.cable_behind.map(Number).filter((n) => Number.isInteger(n) && n >= 0) : [],
    cableReveal: Array.isArray(c.cable_reveal)
      ? c.cable_reveal.map((r, j) => {
          if (!Array.isArray(r) || r.length < 3 || r.some((v) => !isNum(+v))) fail(`${where}.cable_reveal[${j}] must be [x, y, r]`);
          return [+r[0], +r[1], +r[2]];
        })
      : [],
  };
  for (const r of ROLES) out[r] = typeof c[r] === "string" && c[r] ? c[r] : "";
  return out;
}

// Fill in positions that depend on the picture's aspect ratio.
export function placeCar(c, aspect) {
  const { x, y, w } = c.slot;
  const h = w * c.ratio * aspect; // slot height as a fraction of picture height
  // port at the rear corner, level with the tail lights; cable from the wall
  // beside the car, about charger height
  const port = c.port || [c.flip ? x + w * 0.9 : x + w * 0.1, y + h * 0.5];
  const start = c.cableStart || [c.flip ? x + w * 1.025 : x - w * 0.025, y - h * 0.25];
  // default chip: centered just below the car
  const chipPos = c.chip.auto ? { ...c.chip, x: x + w / 2, y: y + h * 1.1 } : c.chip;
  return { ...c, h, portPt: port, startPt: start, chipPos };
}

// Default cable: from beside the car (out of the garage), down onto the
// ground along the car's side, across behind the bumper and up into the port.
export function autoCable(c) {
  const { slot, h, portPt: P, startPt: S, flip, sag } = c;
  const { x, w } = slot;
  const dir = flip ? -1 : 1;
  const ex = (f) => (flip ? x + w - w * f : x + w * f); // x along the car from its cable side
  const B = slot.y + h * (1.04 + sag); // ground just behind the bumper
  const r = (v) => Math.round(v * 1e5) / 1e5;
  return `M${r(S[0])},${r(S[1])} C${r(S[0] - dir * w * 0.03)},${r(S[1] + (B - S[1]) * 0.6)} ${r(ex(-0.03))},${r(B)} ${r(ex(0.06))},${r(B)}`
    + ` C${r(ex(0.2))},${r(B)} ${r(ex(0.2))},${r(P[1] + (B - P[1]) * 0.45)} ${r(P[0])},${r(P[1])}`;
}

export function normalizeConfig(cfg) {
  if (cfg.cars !== undefined && cfg.cars !== null && !Array.isArray(cfg.cars)) fail("cars must be a list");
  const L = cfg.layout || {};
  if (typeof L !== "object") fail("layout must be an object");
  const panel = box(L.panel, DEFAULT_LAYOUT.panel, "layout.panel");
  if (!["meter", "box"].includes(panel.style)) panel.style = "meter";
  let junction = { show: true, at: null };
  if (L.junction === false) junction.show = false;
  else if (Array.isArray(L.junction)) junction.at = point(L.junction, "layout.junction");
  else if (L.junction && typeof L.junction === "object") {
    junction = { show: L.junction.show !== false, at: L.junction.x !== undefined ? point(L.junction, "layout.junction") : null };
  }
  const chips = {};
  const LC = L.chips || {};
  for (const [k, base] of Object.entries(DEFAULT_LAYOUT.chips)) chips[k] = chip(LC[k], base, `layout.chips.${k}`);

  const anim = cfg.animation;
  const thresholds = { solar: 0.02, grid: 0.03, home: 0.02, car: 0.05, battery: 0.03, ...(cfg.thresholds || {}) };
  for (const k of Object.keys(thresholds)) thresholds[k] = nonNeg(thresholds[k], 0);

  return {
    imageDay: cfg.image_day ? String(cfg.image_day) : "",
    imageNight: cfg.image_night ? String(cfg.image_night) : "",
    aspect: aspectOf(cfg.image_aspect),
    sunEntity: cfg.sun_entity === undefined ? "sun.sun" : cfg.sun_entity || "",
    nightDim: clamp(nonNeg(cfg.night_dim, 0.5), 0.05, 1),
    showFooter: cfg.show_footer !== false,
    showUnconfiguredCars: !!cfg.show_unconfigured_cars,
    thresholds,
    animate: anim !== false && anim !== "off" && !(anim && anim.enabled === false),
    speed: clamp(nonNeg(anim && anim.speed_scale, 1) || 1, 0.1, 10),
    layout: {
      panel,
      junction,
      lines: lines(L.lines),
      round: L.round_corners === true ? ROUND_DEFAULT : clamp(nonNeg(L.round_corners, 0), 0, 0.05),
      battery: pictureKeys(box(L.battery, DEFAULT_LAYOUT.battery, "layout.battery"), "layout.battery"),
      chips,
    },
    cars: cfg.cars === undefined || cfg.cars === null ? null : cfg.cars.map((c, i) => car(c, i, `cars[${i}]`)),
    autoCar: (c, i) => car(c, i, `cars[${i}]`),
  };
}

// ---- path helpers ----

const TOKENS = /[MLHVCSQTZmlhvcsqtz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

// Scale a 0-1 path string to drawing units. Returns {d, start: [x, y]}.
export function scalePath(d, sx, sy) {
  const toks = d.match(TOKENS) || [];
  let out = "";
  let cmd = "";
  let n = 0;
  let start = null;
  const r = (v) => Math.round(v * 100) / 100;
  for (const tk of toks) {
    if (/^[a-z]$/i.test(tk)) {
      cmd = tk;
      n = 0;
      out += tk;
      continue;
    }
    const v = +tk;
    const up = cmd.toUpperCase();
    let val;
    if (up === "H") val = v * sx;
    else if (up === "V") val = v * sy;
    else val = n % 2 === 0 ? v * sx : v * sy;
    if (up === "M" && n < 2 && (n === 0 ? !start : start.length === 1)) {
      if (n === 0) start = [val];
      else start.push(val);
    }
    out += (n ? "," : "") + r(val);
    n++;
  }
  return { d: out, start: start?.length === 2 ? start : [0, 0] };
}

// Line (from line()) -> {d, start, end} in drawing units. With a radius,
// corners between point segments are rounded off.
export function linePath(l, sx, sy, radius = 0) {
  if (!l) return null;
  if (l.d) return scalePath(l.d, sx, sy);
  const pts = l.pts.map(([x, y]) => [x * sx, y * sy]);
  const r = (v) => Math.round(v * 100) / 100;
  const start = pts[0];
  const end = pts.at(-1);
  if (!(radius > 0) || pts.length < 3) {
    return { d: pts.map(([x, y], i) => `${i ? "L" : "M"}${r(x)},${r(y)}`).join(""), start, end };
  }
  let d = `M${r(start[0])},${r(start[1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
    const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const k = Math.min(radius, l1 / 2, l2 / 2);
    if (!(k > 0.01)) {
      d += `L${r(b[0])},${r(b[1])}`;
      continue;
    }
    const p1 = [b[0] + ((a[0] - b[0]) * k) / l1, b[1] + ((a[1] - b[1]) * k) / l1];
    const p2 = [b[0] + ((c[0] - b[0]) * k) / l2, b[1] + ((c[1] - b[1]) * k) / l2];
    d += `L${r(p1[0])},${r(p1[1])}Q${r(b[0])},${r(b[1])} ${r(p2[0])},${r(p2[1])}`;
  }
  d += `L${r(end[0])},${r(end[1])}`;
  return { d, start, end };
}

// Smooth path through points (Catmull-Rom), for cables drawn as points.
export function smoothPath(l, sx, sy) {
  if (!l) return null;
  if (l.d) return scalePath(l.d, sx, sy);
  const p = l.pts.map(([x, y]) => [x * sx, y * sy]);
  const r = (v) => Math.round(v * 100) / 100;
  let d = `M${r(p[0][0])},${r(p[0][1])}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${r(c1[0])},${r(c1[1])} ${r(c2[0])},${r(c2[1])} ${r(p2[0])},${r(p2[1])}`;
  }
  return { d, start: p[0] };
}
