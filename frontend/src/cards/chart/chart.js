// Native SVG charts: a time chart (area, line, step) and a grouped column
// chart. Both draw at the element's real pixel width so text stays crisp,
// redraw on resize, and show a tooltip on hover or with the arrow keys.
// Colors are CSS values (usually var(--sf-...)) set through the CSSOM.

import { h, s, setStyle } from "../../common/dom.js";
import { areaPath, linePath, scale, stepPath } from "../../common/svg.js";

let seq = 0;
const r1 = (n) => Math.round(n * 10) / 10;

// Decimals needed to print multiples of `step`.
export function stepDigits(step) {
  for (let d = 0; d < 4; d++) if (Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) < 1e-6) return d;
  return 4;
}

// Ticks on round numbers that cover [lo, hi]; the domain is widened to them.
export function niceAxis(lo, hi, count = 4) {
  if (!(hi > lo)) hi = lo + 1;
  const mag = 10 ** Math.floor(Math.log10((hi - lo) / count));
  let best;
  // smallest covering range with at most count + 1 intervals
  for (const m of [0.5, 1, 2, 2.5, 5, 10, 20]) {
    const step = m * mag;
    const a = Math.floor(lo / step + 1e-9) * step;
    const b = Math.ceil(hi / step - 1e-9) * step;
    const n = Math.round((b - a) / step);
    if (n > count + 1 || n < Math.min(3, count)) continue;
    const span = b - a;
    const old = best ? best.hi - best.lo : Infinity;
    if (span < old - 1e-9 || (Math.abs(span - old) < 1e-9 && n < best.n)) best = { lo: a, hi: b, step, n };
  }
  best ||= { lo, hi, step: (hi - lo) / count };
  const ticks = [];
  for (let v = best.lo; v <= best.hi + best.step * 1e-6; v += best.step) ticks.push(Math.round(v / best.step) * best.step);
  return { lo: best.lo, hi: best.hi, step: best.step, ticks };
}

function valuesOf(series) {
  const out = [];
  for (const sr of series) for (const p of sr.data || []) if (Number.isFinite(p.v)) out.push(p.v);
  return out;
}

class BaseChart {
  constructor(opts = {}) {
    this.opts = { height: 180, ...opts };
    this.id = `ct${++seq}`;
    this.svgHost = h("div");
    this.tip = h("div", { class: "ct-tip", role: "status", "aria-live": "polite" });
    this.el = h("div", { class: "ct-chart", tabindex: 0 }, this.svgHost, this.tip);
    this.width = 0;
    this.index = -1;
    this.data = undefined;
    this.el.addEventListener("pointermove", (ev) => this._pointer(ev));
    this.el.addEventListener("pointerdown", (ev) => this._pointer(ev));
    this.el.addEventListener("pointerleave", () => this.hover(-1));
    this.el.addEventListener("blur", () => this.hover(-1));
    this.el.addEventListener("keydown", (ev) => this._key(ev));
    if (typeof ResizeObserver === "function") {
      this._ro = new ResizeObserver((entries) => {
        const w = Math.round(entries[0].contentRect.width);
        if (w && w !== this.width) {
          this.width = w;
          this.draw();
        }
      });
      this._ro.observe(this.el);
    }
  }

  setHeight(px) {
    this.opts.height = px;
    this.draw();
  }

  update(data) {
    this.data = data;
    this.draw();
  }

  get w() {
    return this.width || this.el.getBoundingClientRect().width || 400;
  }

  draw() {
    const data = this.data;
    if (!data) return;
    const W = Math.max(160, this.w);
    const H = this.opts.height;
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img" });
    if (data.label) svg.setAttribute("aria-label", data.label);
    this.svgHost.replaceChildren(svg);
    this._layout = this.render(svg, W, H, data);
    this.hover(this.index, true);
  }

  // Axis lines and labels for y. fmt gets (value, step, isTopTick).
  yAxis(svg, axis, y, W, fmt, left) {
    const g = s("g", { class: "axis" });
    const last = axis.ticks.length - 1;
    for (const [i, v] of axis.ticks.entries()) {
      const yy = Math.round(y(v)) + 0.5;
      g.append(s("line", { class: Math.abs(v) < axis.step * 1e-6 ? "zero" : "gridline", x1: left, x2: W, y1: yy, y2: yy }));
      g.append(s("text", { x: left - 6, y: yy + 3.5, "text-anchor": "end" }, fmt(v, axis.step, i === last)));
    }
    svg.append(g);
  }

  marginFor(axis, fmt) {
    const last = axis.ticks.length - 1;
    const longest = Math.max(...axis.ticks.map((v, i) => String(fmt(v, axis.step, i === last)).length));
    return Math.max(26, Math.ceil(longest * 6.1) + 10);
  }

  empty(svg, W, H, text) {
    svg.append(s("text", { class: "empty", x: W / 2, y: H / 2, "text-anchor": "middle" }, text));
  }

  // Subclasses: index under pointer x, number of hover slots, tooltip content.
  indexAt(_x) {
    return -1;
  }

  slots() {
    return 0;
  }

  _pointer(ev) {
    if (!this._layout) return;
    const box = this.el.getBoundingClientRect();
    this.hover(this.indexAt(ev.clientX - box.left));
  }

  _key(ev) {
    const n = this.slots();
    if (!n) return;
    let i = this.index;
    if (ev.key === "ArrowLeft") i = i < 0 ? n - 1 : Math.max(0, i - 1);
    else if (ev.key === "ArrowRight") i = i < 0 ? n - 1 : Math.min(n - 1, i + 1);
    else if (ev.key === "Home") i = 0;
    else if (ev.key === "End") i = n - 1;
    else if (ev.key === "Escape") i = -1;
    else return;
    ev.preventDefault();
    this.hover(i);
  }

  hover(i, redraw = false) {
    if (i === this.index && !redraw) return;
    this.index = i;
    this._marks?.remove();
    this._marks = undefined;
    if (i < 0 || !this._layout || i >= this.slots()) {
      this.tip.classList.remove("on");
      return;
    }
    const { x, rows, when, marks } = this.hoverAt(i);
    if (marks) {
      this._marks = marks;
      this.svgHost.firstChild?.append(marks);
    }
    this.tip.replaceChildren(
      h("div", { class: "when", text: when }),
      ...rows.map((r) =>
        h("div", { class: "row" }, h("span", { class: "sf-dot", style: { background: r.color } }), h("span", { text: r.label }), h("span", { class: "v", text: r.value })),
      ),
    );
    // keep the tooltip inside the chart
    const W = this.w;
    const tw = this.tip.offsetWidth || 140;
    const left = Math.min(Math.max(x + 12, 0), W - tw);
    const flip = x + 12 + tw > W;
    setStyle(this.tip, { transform: `translate(${Math.round(flip ? Math.max(0, x - tw - 12) : left)}px, 4px)` });
    this.tip.classList.add("on");
  }
}

// ---- time chart ----

// update({series, from, to, yFormat, tipTime, label, empty})
// series: [{key, label, color, type: "area"|"line"|"step", data: [{t, v}],
//           format(v), colorBelowZero?}]
export class TimeChart extends BaseChart {
  render(svg, W, H, d) {
    const series = d.series.filter((sr) => sr.data?.length);
    const top = 6;
    const bottom = 20;
    if (!series.length) {
      this.empty(svg, W, H, d.empty || "");
      return undefined;
    }
    const vals = valuesOf(series);
    let lo = Math.min(0, ...vals);
    let hi = Math.max(0, ...vals);
    if (d.zero === false) {
      lo = Math.min(...vals);
      hi = Math.max(...vals);
      const pad = (hi - lo || Math.abs(hi) || 1) * 0.1;
      lo -= pad;
      hi += pad;
    }
    const axis = niceAxis(lo, hi, H < 150 ? 3 : 4);
    const yFmt = d.yFormat || ((v) => String(v));
    const left = this.marginFor(axis, yFmt);
    const right = 6;
    const x = scale([d.from, d.to], [left, W - right]);
    const y = scale([axis.lo, axis.hi], [H - bottom, top]);
    this.yAxis(svg, axis, y, W - right, yFmt, left);
    this.xAxis(svg, x, d.from, d.to, W - left - right, H - bottom);

    const defs = s("defs");
    svg.append(defs);
    const zeroY = y(0);
    const clipId = `${this.id}-clip`;
    defs.append(s("clipPath", { id: clipId }, s("rect", { x: left, y: 0, width: W - left - right, height: H - bottom + 1 })));
    const plot = s("g", { "clip-path": `url(#${clipId})` });
    svg.append(plot);

    // draw order: z, else list order (legend keeps list order)
    const order = series.map((sr, n) => [sr, n]).sort((a, b) => (a[0].z ?? a[1]) - (b[0].z ?? b[1]));
    order.forEach(([sr, n]) => {
      const pts = sr.data.map((p) => [x(p.t), y(p.v)]);
      const step = sr.type === "step";
      const stroke = this.strokeFor(defs, sr, n, zeroY, H);
      if (sr.type === "area") {
        const gid = `${this.id}-a${n}`;
        const grad = s("linearGradient", { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
        grad.append(s("stop", { offset: 0, style: { stopColor: sr.color, stopOpacity: 0.42 } }));
        grad.append(s("stop", { offset: 1, style: { stopColor: sr.color, stopOpacity: 0.03 } }));
        defs.append(grad);
        plot.append(s("path", { d: areaPath(pts, zeroY), style: { fill: `url(#${gid})` } }));
        plot.append(s("path", { class: "series-area-line", d: linePath(pts), style: { stroke } }));
      } else {
        plot.append(s("path", { class: "series-line", d: step ? stepPath(pts) : linePath(pts), style: { stroke, strokeWidth: sr.width } }));
      }
    });

    // hover slots: every distinct time across series
    const times = [...new Set(series.flatMap((sr) => sr.data.map((p) => p.t)))].sort((a, b) => a - b);
    const overlay = s("rect", { class: "overlay", x: left, y: 0, width: W - left - right, height: H - bottom });
    svg.append(overlay);
    return { x, y, series, times, H, bottom, top, d };
  }

  // Lines that change color at zero (grid: import above, export below).
  strokeFor(defs, sr, n, zeroY, H) {
    if (!sr.colorBelowZero) return sr.color;
    const gid = `${this.id}-z${n}`;
    const f = Math.min(1, Math.max(0, zeroY / H));
    const grad = s("linearGradient", { id: gid, gradientUnits: "userSpaceOnUse", x1: 0, y1: 0, x2: 0, y2: H });
    grad.append(s("stop", { offset: f, style: { stopColor: sr.color } }));
    grad.append(s("stop", { offset: f, style: { stopColor: sr.colorBelowZero } }));
    defs.append(grad);
    return `url(#${gid})`;
  }

  xAxis(svg, x, from, to, width, baseY) {
    const g = s("g", { class: "axis" });
    const hours = (to - from) / 3_600_000;
    const room = Math.max(2, Math.floor(width / 64));
    const step = [1, 2, 3, 4, 6, 8, 12, 24].find((st) => hours / st <= room) || 24;
    const d = new Date(from);
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    while (d.getHours() % step) d.setHours(d.getHours() + 1);
    const fmt = this.data.xFormat || ((dt) => String(dt.getHours()));
    for (; d.getTime() < to; d.setHours(d.getHours() + step)) {
      const xx = x(d.getTime());
      if (xx < x(from) + 12 || xx > x(to) - 12) continue;
      g.append(s("text", { x: r1(xx), y: baseY + 14, "text-anchor": "middle" }, fmt(new Date(d))));
    }
    svg.append(g);
  }

  slots() {
    return this._layout?.times.length || 0;
  }

  indexAt(px) {
    const L = this._layout;
    if (!L) return -1;
    let best = -1;
    let dist = Infinity;
    L.times.forEach((t, i) => {
      const dd = Math.abs(L.x(t) - px);
      if (dd < dist) {
        dist = dd;
        best = i;
      }
    });
    return best;
  }

  hoverAt(i) {
    const L = this._layout;
    const t = L.times[i];
    const xx = r1(L.x(t));
    const marks = s("g");
    marks.append(s("line", { class: "cross", x1: xx, x2: xx, y1: L.top, y2: L.H - L.bottom }));
    const rows = [];
    for (const sr of L.series) {
      const p = valueAt(sr.data, t, sr.type === "step");
      if (!p) continue;
      const color = sr.colorBelowZero && p.v < 0 ? sr.colorBelowZero : sr.color;
      marks.append(s("circle", { class: "hover-dot", cx: r1(L.x(p.t === t || sr.type === "step" ? t : p.t)), cy: r1(L.y(p.v)), r: 3.5, style: { fill: color } }));
      rows.push({ label: sr.label, value: sr.format ? sr.format(p.v) : String(p.v), color });
    }
    return { x: xx, rows, when: L.d.tipTime ? L.d.tipTime(new Date(t)) : new Date(t).toLocaleString(), marks };
  }
}

// Point of a series at time t: for steps the last one at or before t,
// otherwise the nearest one.
export function valueAt(data, t, step) {
  if (!data?.length) return undefined;
  let lo = 0;
  let hi = data.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (data[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  if (step) return data[lo].t <= t ? data[lo] : undefined;
  const a = data[lo];
  const b = data[lo + 1];
  if (!b) return a;
  return Math.abs(a.t - t) <= Math.abs(b.t - t) ? a : b;
}

// ---- column chart ----

// update({categories: [{label, tip}], series: [{key, label, color, values, format}],
//         yFormat, label, empty})
export class BarChart extends BaseChart {
  render(svg, W, H, d) {
    const n = d.categories.length;
    const series = d.series.filter((sr) => sr.values?.some((v) => Number.isFinite(v)));
    const top = 6;
    const bottom = 20;
    if (!n || !series.length) {
      this.empty(svg, W, H, d.empty || "");
      return undefined;
    }
    const vals = series.flatMap((sr) => sr.values.filter((v) => Number.isFinite(v)));
    const axis = niceAxis(Math.min(0, ...vals), Math.max(0, ...vals), H < 150 ? 3 : 4);
    const yFmt = d.yFormat || ((v) => String(v));
    const left = this.marginFor(axis, yFmt);
    const right = 4;
    const y = scale([axis.lo, axis.hi], [H - bottom, top]);
    this.yAxis(svg, axis, y, W - right, yFmt, left);

    const band = (W - left - right) / n;
    const inner = band * (n > 14 ? 0.8 : 0.72);
    const barW = Math.max(1, inner / series.length);
    const gap = series.length > 1 && barW > 4 ? 1 : 0;
    const zeroY = y(0);
    const g = s("g");
    const labels = s("g", { class: "axis" });
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - left) / 46))));
    d.categories.forEach((c, i) => {
      const x0 = left + band * i + (band - inner) / 2;
      series.forEach((sr, k) => {
        const v = sr.values[i];
        if (!Number.isFinite(v) || v === 0) return;
        const yy = y(v);
        const hgt = Math.max(1, Math.abs(yy - zeroY));
        g.append(
          s("rect", {
            class: "bar",
            x: r1(x0 + k * barW + gap / 2),
            y: r1(Math.min(yy, zeroY)),
            width: r1(Math.max(1, barW - gap)),
            height: r1(hgt),
            rx: Math.min(2, barW / 3),
            style: { fill: sr.color },
          }),
        );
      });
      // label every few bars, always the newest one
      if ((n - 1 - i) % every === 0) {
        labels.append(s("text", { x: r1(left + band * (i + 0.5)), y: H - bottom + 14, "text-anchor": "middle" }, c.label));
      }
    });
    svg.append(g, labels);
    svg.append(s("rect", { class: "overlay", x: left, y: 0, width: W - left - right, height: H - bottom }));
    return { left, band, n, series, d, y, H, bottom, top };
  }

  slots() {
    return this._layout?.n || 0;
  }

  indexAt(px) {
    const L = this._layout;
    if (!L) return -1;
    return Math.min(L.n - 1, Math.max(0, Math.floor((px - L.left) / L.band)));
  }

  hoverAt(i) {
    const L = this._layout;
    const marks = s("g");
    const bandRect = s("rect", { class: "band", x: r1(L.left + L.band * i), y: L.top, width: r1(L.band), height: L.H - L.bottom - L.top, rx: 3 });
    marks.append(bandRect);
    // band goes under the bars
    const rows = L.series.map((sr) => ({
      label: sr.label,
      value: sr.format ? sr.format(sr.values[i]) : String(sr.values[i]),
      color: sr.color,
    }));
    const cat = L.d.categories[i];
    return { x: L.left + L.band * (i + 0.5), rows, when: cat.tip || cat.label, marks };
  }

  hover(i, redraw = false) {
    super.hover(i, redraw);
    // keep the highlight band behind the bars
    const svg = this.svgHost.firstChild;
    if (this._marks && svg) svg.insertBefore(this._marks, svg.firstChild);
  }
}

// Legend row. items: [{label, color, type: "area"|"line"|"bar", value?}]
export function legend(items) {
  return h(
    "div",
    { class: "ct-legend" },
    items.map((it) =>
      h(
        "span",
        { class: "item" },
        h("span", { class: ["swatch", it.type === "area" ? "area" : it.type === "bar" ? "bar" : ""], style: { background: it.color } }),
        h("span", { text: it.label }),
        it.value !== undefined ? h("b", { text: it.value }) : null,
      ),
    ),
  );
}
