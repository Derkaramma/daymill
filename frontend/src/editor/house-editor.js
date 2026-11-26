// daymill-house-card-editor: the visual editor for daymill-house-card.
//
// A live preview of the real card sits on top with handles drawn over it.
// Below it: scenario buttons (simulated data, never written to HA) and one
// tab per part of the layout. Every change is kept in an undo history and
// sent to HA as a "config-changed" event, debounced.

import { defineElement } from "../common/define.js";
import { adopt, h, s, setStyle } from "../common/dom.js";
import { baseStyles, COLORS } from "../common/theme.js";
import { setLanguage, t } from "../common/format.js";
import { daymillCars } from "../common/entities.js";
import { SCENARIOS } from "../common/simulator.js";
import { aspectOf, builtinCar } from "../cards/house/layout.js";
import "../cards/house-card.js";
import * as M from "./model.js";
import { previewCars, previewHass } from "./preview-hass.js";
import { hasAlpha, imageSize, reencode, upload } from "./upload.js";
import { editorStyles } from "./styles.js";
import "./strings.js";

const TABS = ["photo", "panel", "lines", "cars", "battery", "labels", "colors", "backup"];
const EMIT_MS = 300;
const COLOR_KEYS = ["solar", "import", "export", "home", "battery_charge", "battery_use", "ev", "dot_car"];
const ROLE_DOMAINS = {
  presence_entity: ["device_tracker", "person", "binary_sensor"],
  charging_entity: ["binary_sensor", "sensor", "switch"],
  power_entity: ["sensor"],
  battery_entity: ["sensor"],
  plugged_entity: ["binary_sensor", "sensor"],
  limit_entity: ["sensor", "number"],
};
const DEG = Math.PI / 180;

const fmt = (v, d = 3) => String(Math.round(v * 10 ** d) / 10 ** d);

class HouseCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    adopt(this.shadowRoot, baseStyles, editorStyles);
    this._config = { type: "custom:daymill-house-card" };
    this._tab = "photo";
    this._scenario = "normal";
    this._time = "day";
    this._line = "solar0";
    this._car = 0;
    this._sel = null;
    this._drag = null;
    this._history = new M.History();
    this._msgs = {};
    this._sizes = {};
    this._alpha = {};
    this._onKey = (e) => this._keydown(e);
  }

  // ---- HA editor API ----

  setConfig(config) {
    const next = { type: "custom:daymill-house-card", ...M.clone(config || {}) };
    if (this._lastEmitted && M.same(M.clean(next), this._lastEmitted)) return;
    if (this._built && !M.same(next, this._config)) this._history.push(this._config);
    this._config = next;
    if (this._built) this._refresh();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (hass) setLanguage(hass.locale?.language || hass.language);
    if (!this._built) this._build();
    else if (first) this._refresh();
    else this._updatePreview();
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    if (!this._built) this._build();
    this.addEventListener("keydown", this._onKey);
    this._ro ??= new ResizeObserver(() => this._queueOverlay());
    this._ro.observe(this.$pv);
  }

  disconnectedCallback() {
    this.removeEventListener("keydown", this._onKey);
    this._ro?.disconnect();
    if (this._emitTimer) this._emit();
  }

  // ---- state changes ----

  // A finished change: remember the old config for undo, then update.
  _commit(next, before = this._config) {
    if (M.same(next, this._config)) return;
    this._history.push(before);
    this._config = next;
    this._refresh();
    this._scheduleEmit();
  }

  // Change while a slider or drag is moving: preview only, no undo step yet.
  _live(next) {
    this._gesture ??= M.clone(this._config);
    this._config = next;
    this._updatePreview();
  }

  _endGesture() {
    const before = this._gesture;
    this._gesture = undefined;
    if (!before || M.same(before, this._config)) return;
    this._history.push(before);
    this._refresh();
    this._scheduleEmit();
  }

  _undo() {
    const prev = this._history.undo(this._config);
    if (prev === undefined) return;
    this._config = prev;
    this._sel = null;
    this._refresh();
    this._scheduleEmit();
  }

  _redo() {
    const next = this._history.redo(this._config);
    if (next === undefined) return;
    this._config = next;
    this._sel = null;
    this._refresh();
    this._scheduleEmit();
  }

  _scheduleEmit() {
    clearTimeout(this._emitTimer);
    this._emitTimer = setTimeout(() => this._emit(), EMIT_MS);
  }

  _emit() {
    clearTimeout(this._emitTimer);
    this._emitTimer = undefined;
    const config = M.clean(this._config);
    if (this._lastEmitted && M.same(config, this._lastEmitted)) return;
    this._lastEmitted = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }

  // ---- derived data ----

  get _known() {
    return daymillCars(this._hass);
  }

  get _cars() {
    return M.carsFor(this._config, this._known);
  }

  get _n() {
    const n = M.normalized(this._config);
    if (n) this._lastN = n;
    return this._lastN || M.normalized({});
  }

  _editingLine() {
    if (this._tab === "battery") return "battery";
    if (this._tab === "lines") return this._line;
    if (this._tab === "cars" && this._cableMode() === "draw") return `cable${this._car}`;
    return null;
  }

  _cableMode(i = this._car) {
    const c = this._cars[i];
    if (!c) return "auto";
    if (c.show_cable === false) return "none";
    return c.cable !== undefined && c.cable !== null ? "draw" : "auto";
  }

  _pathGet(key, config = this._config) {
    if (key.startsWith("cable")) {
      const c = M.carsFor(config, this._known)[Number(key.slice(5))];
      return M.toPoints(c?.cable ?? c?.cable_path);
    }
    return M.effectiveLines(config)[key] || { pts: [], curved: false };
  }

  _pathSet(config, key, pts) {
    if (key.startsWith("cable")) return M.setCar(config, this._known, Number(key.slice(5)), { cable: M.roundPts(pts), cable_path: undefined });
    return M.setLine(config, key, pts);
  }

  // ---- build ----

  _build() {
    this._built = true;
    this.$card = document.createElement("daymill-house-card");
    this.$card.editMode = true;
    this.$card.inert = true;
    this.$card.addEventListener("daymill-rendered", () => this._queueOverlay());
    this.$svg = s("svg", { "aria-label": t("ed_preview") });
    this.$ov = h("div", { class: "edov" }, this.$svg);
    this.$ov.addEventListener("pointerdown", (e) => this._down(e));
    this.$ov.addEventListener("pointermove", (e) => this._move(e));
    this.$ov.addEventListener("pointerup", (e) => this._up(e));
    this.$ov.addEventListener("pointercancel", (e) => this._up(e, true));
    this.$ov.addEventListener("focusin", (e) => {
      const id = e.target.closest?.("[data-id]")?.dataset.id;
      if (id && id !== this._sel) this._select(id);
    });
    this.$pv = h("div", { class: "pv" }, this.$card, this.$ov);
    this.$scen = h("div", { class: "scen", role: "group", "aria-label": t("ed_preview") });
    this.$bar = h("div", { class: "bar" });
    this.$hint = h("div", { class: "hint", "aria-live": "polite" });
    this.$tabs = h("div", { class: "tabs", role: "tablist" });
    this.$body = h("div", { class: "body", role: "tabpanel", id: "panel" });
    this.shadowRoot.replaceChildren(h("div", { class: "ed" }, this.$pv, this.$scen, this.$bar, this.$tabs, this.$hint, this.$body));
    this._renderTabs();
    if (this._hass) this._refresh();
  }

  // Everything after a committed change.
  _refresh() {
    if (!this._built) return;
    this._updatePreview();
    this._renderScenarios();
    this._renderBar();
    this._renderHint();
    this._renderBody();
    this._queueOverlay();
  }

  // ---- preview ----

  _previewConfig() {
    const cfg = M.clean(this._config);
    if (this._scenario === "live") return cfg;
    return { ...cfg, cars: previewCars(M.carsFor(cfg, this._known)) };
  }

  _updatePreview() {
    if (!this._hass || !this.$card) return;
    let cfg = this._previewConfig();
    if (!M.normalized(cfg)) cfg = M.clean(this._good || {});
    else this._good = this._config;
    const key = JSON.stringify(cfg);
    if (key !== this._pvKey) {
      this._pvKey = key;
      try {
        this.$card.setConfig(cfg);
      } catch {
        // the card shows its own error
      }
    }
    let hass = this._hass;
    if (this._scenario !== "live") {
      const battery = this._tab === "battery";
      const sig = [this._hass.entities, this._scenario, this._time, battery, JSON.stringify(cfg.cars), JSON.stringify(cfg.entities)];
      if (!this._pvSig || sig.some((v, i) => v !== this._pvSig[i])) {
        this._pvSig = sig;
        this._pvHass = previewHass(this._hass, { scenario: this._scenario, time: this._time, overrides: cfg.entities, cars: cfg.cars, battery }).hass;
      }
      hass = this._pvHass;
    }
    if (this.$card.hass !== hass) this.$card.hass = hass;
  }

  _renderScenarios() {
    const live = this._scenario === "live";
    const btn = (id, label) =>
      h("button", {
        type: "button",
        "aria-pressed": String(this._scenario === id),
        onclick: () => {
          this._scenario = id;
          this._refresh();
        },
        text: label,
      });
    const time = (id) =>
      h("button", {
        type: "button",
        "aria-pressed": String(!live && this._time === id),
        disabled: live,
        onclick: () => {
          this._time = id;
          this._refresh();
        },
        text: t(`ed_${id}`),
      });
    this.$scen.replaceChildren(
      h("span", { class: "lbl", text: t("ed_preview") }),
      h("span", { class: "seg-group" }, time("day"), time("night")),
      btn("live", t("ed_live")),
      ...SCENARIOS.map((id) => btn(id, t(`ed_sc_${id}`))),
      h("span", { class: "note", text: t("ed_preview_note") }),
    );
  }

  _renderBar() {
    this.$bar.replaceChildren(
      h("button", { type: "button", disabled: !this._history.canUndo, onclick: () => this._undo(), "aria-keyshortcuts": "Control+Z", text: `↶ ${t("ed_undo")}` }),
      h("button", { type: "button", disabled: !this._history.canRedo, onclick: () => this._redo(), "aria-keyshortcuts": "Control+Shift+Z", text: `↷ ${t("ed_redo")}` }),
    );
  }

  _renderTabs() {
    const tabs = TABS.map((id) => {
      const b = h(
        "button",
        {
          type: "button",
          role: "tab",
          id: `tab-${id}`,
          "aria-controls": "panel",
          "aria-selected": String(this._tab === id),
          tabindex: this._tab === id ? "0" : "-1",
          onclick: () => this._setTab(id),
        },
        t(`ed_tab_${id}`),
        id === "battery" ? h("span", { class: "beta", text: t("ed_beta") }) : null,
      );
      b.addEventListener("keydown", (e) => {
        const i = TABS.indexOf(id);
        const j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : null;
        if (j === null) return;
        e.preventDefault();
        const next = TABS[(j + TABS.length) % TABS.length];
        this._setTab(next);
        this.shadowRoot.getElementById(`tab-${next}`)?.focus();
      });
      return b;
    });
    this.$tabs.replaceChildren(...tabs);
    this.$body.setAttribute("aria-labelledby", `tab-${this._tab}`);
  }

  _setTab(id) {
    if (id === this._tab) return;
    this._tab = id;
    this._sel = null;
    this._renderTabs();
    this._refresh();
  }

  _renderHint() {
    const key = this._tab === "cars" && this._cableMode() === "draw" ? "ed_hint_cable" : `ed_hint_${this._tab}`;
    this.$hint.textContent = t(key);
  }

  // ---- overlay ----

  _queueOverlay() {
    cancelAnimationFrame(this._ovRaf);
    this._ovRaf = requestAnimationFrame(() => this._drawOverlay());
  }

  _geom() {
    const scene = this.$card.sceneElement;
    if (!scene?.isConnected) return null;
    const r = scene.getBoundingClientRect();
    const p = this.$pv.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { left: r.left - p.left, top: r.top - p.top, W: r.width, H: r.height, scene: r };
  }

  _drawOverlay() {
    const g = this._geom();
    this.$ov.hidden = !g;
    if (!g) return;
    setStyle(this.$ov, { left: `${g.left}px`, top: `${g.top}px`, width: `${g.W}px`, height: `${g.H}px` });
    this._W = g.W;
    this._H = g.H;
    const focused = this.shadowRoot.activeElement?.closest?.("[data-id]")?.dataset.id;
    const parts = [];
    const n = this._n;
    const L = n.layout;
    const tab = this._tab;
    if (tab === "panel") {
      if (L.panel.show) parts.push(this._boxHandles("panel", L.panel, t("ed_tab_panel")));
      if (L.junction.show && L.junction.at) parts.push(this._handle("junction", "junction", this._junctionPx(), t("ed_junction"), "end"));
      else if (L.junction.show) {
        const j = this._junctionPx();
        parts.push(s("circle", { class: "snapmark", cx: j[0], cy: j[1], r: 7 }));
      }
    }
    if (tab === "lines" || tab === "battery") {
      const lines = M.effectiveLines(this._config);
      for (const [k, l] of Object.entries(lines)) if (k !== this._editingLine() && l.pts.length > 1) parts.push(s("polyline", { class: "guide", points: this._ptsAttr(l.pts) }));
      const j = this._junctionPx();
      parts.push(s("circle", { class: "snapmark", cx: j[0], cy: j[1], r: 10 }));
    }
    if (tab === "cars") parts.push(...this._carHandles());
    if (tab === "labels") parts.push(...this._chipHandles(g));
    // line segments, then the battery box, then points on top
    const edit = this._editingLine();
    const path = edit ? this._pathHandles(edit) : { under: [], over: [] };
    parts.push(...path.under);
    if (tab === "battery") parts.push(this._boxHandles("battery", L.battery, t("ed_tab_battery")));
    parts.push(...path.over);
    this.$svg.replaceChildren(...parts);
    this.$svg.setAttribute("viewBox", `0 0 ${g.W} ${g.H}`);
    this.$ov.classList.toggle("add", !!edit);
    if (focused) this.$svg.querySelector(`[data-id="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  }

  _px([x, y]) {
    return [x * this._W, y * this._H];
  }

  _frac([x, y]) {
    return [M.clamp(x / this._W, -0.05, 1.05), M.clamp(y / this._H, -0.05, 1.05)];
  }

  _ptsAttr(pts) {
    return pts.map((p) => this._px(p).map((v) => v.toFixed(1)).join(",")).join(" ");
  }

  _junctionPx() {
    const L = this._n.layout;
    if (L.junction.at) return this._px(L.junction.at);
    return this._px([L.panel.x + L.panel.w / 2, L.panel.y + L.panel.h * 0.58]);
  }

  // A focusable handle group: big invisible hit area plus the visible dot.
  _handle(id, kind, [x, y], label, cls = "", data = {}) {
    const g = s("g", { "data-kind": kind, "data-id": id, tabindex: "0", role: "button", "aria-label": label, class: this._sel === id ? "sel" : null });
    Object.assign(g.dataset, data);
    g.append(s("circle", { class: "hit", cx: x, cy: y, r: 11 }), s("circle", { class: ["dot", cls], cx: x, cy: y, r: 6.5 }));
    return g;
  }

  // Corners of a skewed box in pixels, plus where its handles go.
  _box(b) {
    const x = b.x * this._W;
    const y = b.y * this._H;
    const w = b.w * this._W;
    const hh = b.h * this._H;
    const cx = x + w / 2;
    const tn = Math.tan((b.skew || 0) * DEG);
    const P = (px, py) => [px, py + tn * (px - cx)];
    // handles keep some distance from the middle so a small box stays grabbable
    const arm = Math.max(w / 2, 24);
    const corner = P(x + w, y + hh);
    return {
      corners: [P(x, y), P(x + w, y), P(x + w, y + hh), P(x, y + hh)],
      size: [corner[0] + Math.max(0, 12 - w / 2), corner[1] + 10],
      skew: [cx + arm, y + hh / 2 + tn * arm],
      arm,
      cx,
      cy: y + hh / 2,
      w,
      h: hh,
    };
  }

  _boxHandles(name, b, label) {
    const bx = this._box(b);
    const g = s("g");
    const body = s("g", { "data-kind": `${name}-move`, "data-id": `${name}-move`, tabindex: "0", role: "button", "aria-label": label, class: this._sel === `${name}-move` ? "sel" : null });
    const hw = Math.max(bx.w, 28);
    const hh = Math.max(bx.h, 28);
    body.append(
      s("rect", { class: "hit", x: bx.cx - hw / 2, y: bx.cy - hh / 2, width: hw, height: hh }),
      s("polygon", { class: "box", points: bx.corners.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ") }),
    );
    g.append(body);
    g.append(this._handle(`${name}-size`, `${name}-size`, bx.size, `${label}: ${t("ed_width")} / ${t("ed_height")}`, "end"));
    g.append(this._handle(`${name}-skew`, `${name}-skew`, bx.skew, `${label}: ${t("ed_tilt")}`, "start"));
    return g;
  }

  _pathHandles(key) {
    const out = [];
    const over = [];
    const { pts } = this._pathGet(key);
    if (pts.length > 1) {
      out.push(s("polyline", { class: "path", points: this._ptsAttr(pts) }));
      pts.slice(0, -1).forEach((p, i) => {
        const [a, b] = [this._px(p), this._px(pts[i + 1])];
        out.push(s("line", { class: "seg", "data-kind": "seg", "data-key": key, "data-idx": String(i), x1: a[0], y1: a[1], x2: b[0], y2: b[1] }));
      });
    }
    const name = this._lineName(key);
    pts.forEach((p, i) => {
      const id = `pt|${key}|${i}`;
      over.push(this._handle(id, "pt", this._px(p), t("ed_point", { line: name, n: i + 1 }), i === 0 || i === pts.length - 1 ? "end" : "", { key, idx: String(i) }));
    });
    return { under: out, over };
  }

  _lineName(key) {
    if (key.startsWith("solar")) return t("ed_line_solar", { n: Number(key.slice(5)) + 1 });
    if (key.startsWith("cable")) return t("ed_cable");
    return t(`ed_line_${key}`);
  }

  _carHandles() {
    const out = [];
    const placed = this.$card.placedCars;
    placed.forEach((c) => {
      const i = c.index;
      const x = c.slot.x * this._W;
      const y = c.slot.y * this._H;
      const w = c.slot.w * this._W;
      const hh = c.h * this._H;
      const id = `car-move|${i}`;
      const name = c.name || t("ed_car_n", { n: i + 1 });
      // while drawing a cable, clicks on the cars add cable points
      const drawing = this._cableMode() === "draw";
      const body = drawing
        ? s("g", { class: "still" })
        : s("g", { "data-kind": "car-move", "data-id": id, "data-idx": String(i), tabindex: "0", role: "button", "aria-label": name, class: this._sel === id ? "sel" : null });
      body.append(s("rect", { class: ["box", i !== this._car && "soft", i === this._car && "sel"], x, y, width: w, height: hh, rx: 4 }));
      body.append(s("text", { class: "tag", x: x + 4, y: y + 14, text: name }));
      out.push(body);
      if (i !== this._car) return;
      if (!drawing) out.push(this._handle(`car-size|${i}`, "car-size", [x + w, y + hh], `${name}: ${t("ed_car_size")}`, "end", { idx: String(i) }));
      const mode = this._cableMode(i);
      if (mode !== "none") out.push(this._handle(`port|${i}`, "port", this._px(c.portPt), `${name}: ${t("ed_port")}`, "port", { idx: String(i) }));
      if (mode === "auto") out.push(this._handle(`cstart|${i}`, "cstart", this._px(c.startPt), `${name}: ${t("ed_cable_start")}`, "start", { idx: String(i) }));
    });
    return out;
  }

  _chipHandles(g) {
    const out = [];
    const root = this.$card.shadowRoot;
    for (const el of root.querySelectorAll(".chip[data-k]")) {
      if (el.hidden || !el.isConnected) continue;
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      const k = el.dataset.k;
      const id = `chip|${k}`;
      const x = r.left - g.scene.left;
      const y = r.top - g.scene.top;
      const grp = s("g", { "data-kind": "chip", "data-id": id, "data-key": k, tabindex: "0", role: "button", "aria-label": this._chipName(k), class: this._sel === id ? "sel" : null });
      grp.append(s("rect", { class: "box", x: x - 2, y: y - 2, width: r.width + 4, height: r.height + 4, rx: 8 }));
      out.push(grp);
    }
    return out;
  }

  _chipName(k) {
    const car = /^car(\d+)$/.exec(k);
    if (car) return this._cars[+car[1]]?.name || t("ed_car_n", { n: +car[1] + 1 });
    return t(`ed_chip_${k}`);
  }

  _select(id) {
    this._sel = id;
    for (const el of this.$svg.querySelectorAll("[data-id]")) el.classList.toggle("sel", el.dataset.id === id);
    this._renderBody();
  }

  // ---- pointer ----

  _pos(e) {
    const r = this.$ov.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  _down(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const pos = this._pos(e);
    const el = e.composedPath().find((x) => x instanceof Element && x.dataset?.kind);
    let drag = null;
    if (el) drag = this._startDrag(el.dataset, pos);
    else {
      const key = this._editingLine();
      if (!key) return;
      // empty spot: add a point at the end of the line being edited
      const before = M.clone(this._config);
      const { pts } = this._pathGet(key);
      const p = this._snapPt(pos, key, pts.length ? [this._px(pts.at(-1))] : []);
      const next = [...pts, this._frac(p)];
      this._config = this._pathSet(this._config, key, next);
      drag = { kind: "pt", key, idx: next.length - 1, start: pos, origPx: p, before, moved: true };
    }
    if (!drag) return;
    e.preventDefault();
    this._drag = drag;
    this._sel = drag.id || (drag.kind === "pt" ? `pt|${drag.key}|${drag.idx}` : this._sel);
    try {
      this.$ov.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events have no real pointer to capture
    }
    this.$ov.classList.add("dragging");
    if (drag.moved) this._updatePreview();
  }

  _startDrag(d, pos) {
    const n = this._n;
    const L = n.layout;
    const base = { kind: d.kind, id: d.id, start: pos, before: M.clone(this._config) };
    const idx = d.idx !== undefined ? Number(d.idx) : undefined;
    switch (d.kind) {
      case "panel-move":
      case "panel-size":
      case "panel-skew":
        return { ...base, box: { ...L.panel }, target: "panel", skewY: this._box(L.panel).skew[1] };
      case "battery-move":
      case "battery-size":
      case "battery-skew":
        return { ...base, box: { ...L.battery }, target: "battery", skewY: this._box(L.battery).skew[1] };
      case "junction":
        return { ...base, origPx: this._junctionPx() };
      case "pt": {
        const p = this._pathGet(d.key).pts[idx];
        return { ...base, key: d.key, idx, origPx: this._px(p) };
      }
      case "seg": {
        const key = d.key;
        const { pts } = this._pathGet(key);
        const at = idx + 1;
        const next = [...pts];
        next.splice(at, 0, this._frac(pos));
        this._config = this._pathSet(this._config, key, next);
        return { ...base, kind: "pt", id: `pt|${key}|${at}`, key, idx: at, origPx: pos, moved: true };
      }
      case "car-move":
      case "car-size":
      case "port":
      case "cstart": {
        this._car = idx;
        const c = this.$card.placedCars.find((x) => x.index === idx);
        if (!c) return null;
        const raw = this._cars[idx] || {};
        return { ...base, idx, slot: { ...c.slot }, port: raw.port ? [...c.portPt] : null, origPx: this._px(d.kind === "port" ? c.portPt : c.startPt) };
      }
      case "chip":
        return { ...base, key: d.key, anchor: this._chipAnchor(d.key) };
      default:
        return null;
    }
  }

  // Where a chip is anchored now, as {x, y, align} fractions.
  _chipAnchor(k) {
    const L = this._n.layout;
    const car = /^car(\d+)$/.exec(k);
    if (car) {
      const c = this.$card.placedCars.find((x) => x.index === +car[1]);
      return c ? { x: c.chipPos.x, y: c.chipPos.y, align: c.chipPos.align || "center" } : { x: 0.5, y: 0.5, align: "center" };
    }
    const chip = L.chips[k];
    if (k === "today" && chip.stack) {
      const el = this.$card.shadowRoot.querySelector('.chip[data-k="today"]');
      const g = this._geom();
      const align = L.chips.rate.align;
      if (el && g) {
        const r = el.getBoundingClientRect();
        const x = align === "left" ? r.left : align === "right" ? r.right : r.left + r.width / 2;
        return { x: (x - g.scene.left) / g.W, y: (r.top - g.scene.top) / g.H, align };
      }
      return { x: L.chips.rate.x, y: L.chips.rate.y + 0.12, align };
    }
    return { x: chip.x, y: chip.y, align: chip.align };
  }

  _move(e) {
    const d = this._drag;
    if (!d) return;
    e.preventDefault();
    this._applyDrag(d, this._pos(e), e.shiftKey);
    d.moved = true;
    cancelAnimationFrame(this._pvRaf);
    this._pvRaf = requestAnimationFrame(() => this._updatePreview());
  }

  _up(e, cancel = false) {
    const d = this._drag;
    if (!d) return;
    this._drag = null;
    try {
      this.$ov.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
    this.$ov.classList.remove("dragging");
    if (cancel) {
      this._config = d.before;
      this._refresh();
      return;
    }
    if (d.moved && !M.same(d.before, this._config)) {
      this._history.push(d.before);
      this._scheduleEmit();
    }
    this._refresh();
    this._queueOverlay();
  }

  // Apply a drag to the config. pos is in pixels; free = no snapping.
  _applyDrag(d, pos, free = false) {
    const dx = (pos[0] - d.start[0]) / this._W;
    const dy = (pos[1] - d.start[1]) / this._H;
    const abs = d.origPx ? [d.origPx[0] + pos[0] - d.start[0], d.origPx[1] + pos[1] - d.start[1]] : null;
    let c = this._config;
    const r4 = M.r4;
    switch (d.kind) {
      case "panel-move":
      case "battery-move":
      case "panel-size":
      case "battery-size":
      case "panel-skew":
      case "battery-skew": {
        const b = { ...d.box };
        const op = d.kind.split("-")[1];
        if (op === "move") {
          b.x += dx;
          b.y += dy;
        } else if (op === "size") {
          b.w = Math.max(0.004, d.box.w + dx);
          b.h = Math.max(0.01, d.box.h + dy);
        } else {
          const { arm, cy } = this._box(d.box);
          b.skew = Math.round(M.clamp(Math.atan2(d.skewY + pos[1] - d.start[1] - cy, arm) / DEG, -75, 75));
        }
        const raw = this._config.layout?.[d.target];
        const keep = raw && typeof raw === "object" ? raw : {};
        c = M.setIn(c, ["layout", d.target], { ...keep, x: r4(b.x), y: r4(b.y), w: r4(b.w), h: r4(b.h), skew: b.skew });
        break;
      }
      case "junction": {
        const L = this._n.layout;
        const auto = this._px([L.panel.x + L.panel.w / 2, L.panel.y + L.panel.h * 0.58]);
        if (!free && Math.hypot(abs[0] - auto[0], abs[1] - auto[1]) < 12) c = M.setIn(c, ["layout", "junction"], undefined);
        else c = M.setIn(c, ["layout", "junction"], this._frac(abs).map(r4));
        break;
      }
      case "pt": {
        const { pts } = this._pathGet(d.key);
        const near = [pts[d.idx - 1], pts[d.idx + 1]].filter(Boolean).map((p) => this._px(p));
        const p = free ? abs : this._snapPt(abs, d.key, near);
        const next = [...pts];
        next[d.idx] = this._frac(p);
        c = this._pathSet(c, d.key, next);
        break;
      }
      case "car-move": {
        const patch = { slot: { x: r4(d.slot.x + dx), y: r4(d.slot.y + dy), w: r4(d.slot.w) } };
        if (d.port) patch.port = [r4(d.port[0] + dx), r4(d.port[1] + dy)];
        c = M.setCar(c, this._known, d.idx, patch);
        break;
      }
      case "car-size":
        c = M.setCar(c, this._known, d.idx, { slot: { x: r4(d.slot.x), y: r4(d.slot.y), w: r4(M.clamp(d.slot.w + dx, 0.03, 0.6)) } });
        break;
      case "port":
        c = M.setCar(c, this._known, d.idx, { port: this._frac(abs).map(r4) });
        break;
      case "cstart":
        c = M.setCar(c, this._known, d.idx, { cable_start: this._frac(abs).map(r4) });
        break;
      case "chip": {
        const a = d.anchor;
        const value = { x: r4(a.x + dx), y: r4(a.y + dy), align: a.align };
        const car = /^car(\d+)$/.exec(d.key);
        if (car) {
          const raw = this._cars[+car[1]]?.chip;
          c = M.setCar(c, this._known, +car[1], { chip: { ...(raw && typeof raw === "object" ? raw : {}), ...value } });
        } else {
          const raw = this._config.layout?.chips?.[d.key];
          const keep = raw && typeof raw === "object" ? raw : {};
          const { stack, ...rest } = keep;
          c = M.setIn(c, ["layout", "chips", d.key], { ...rest, ...value });
        }
        break;
      }
      default:
        return;
    }
    this._config = c;
  }

  // Snap a point being placed on a line to the junction, the panel and the
  // ends of other lines; otherwise line it up with its neighbors.
  _snapPt(p, key, neighbors) {
    const L = this._n.layout;
    const targets = [this._junctionPx()];
    if (L.panel.show) {
      targets.push(this._px([L.panel.x + L.panel.w / 2, L.panel.y]), this._px([L.panel.x + L.panel.w / 2, L.panel.y + L.panel.h]));
    }
    if (!key.startsWith("cable")) {
      for (const [k, l] of Object.entries(M.effectiveLines(this._config))) {
        if (k === key || l.pts.length < 2) continue;
        targets.push(this._px(l.pts[0]), this._px(l.pts.at(-1)));
      }
    }
    return M.snap(p, targets, neighbors, 8);
  }

  // ---- keyboard ----

  _keydown(e) {
    const tag = e.composedPath()[0]?.tagName;
    const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !typing && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) this._redo();
      else this._undo();
      return;
    }
    if (mod && !typing && e.key.toLowerCase() === "y") {
      e.preventDefault();
      this._redo();
      return;
    }
    if (typing) return;
    const handle = e.composedPath().find((x) => x instanceof Element && x.dataset?.kind && x.dataset.id);
    if ((e.key === "Delete" || e.key === "Backspace") && this._sel?.startsWith("pt|")) {
      e.preventDefault();
      this._deletePoint();
      return;
    }
    if (e.key === "Escape" && this._sel) {
      // only clear the handle: don't let the dialog around us close too
      e.preventDefault();
      e.stopPropagation();
      this._sel = null;
      this._refresh();
      this._queueOverlay();
      return;
    }
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (step && handle && this._W) {
      e.preventDefault();
      const k = e.shiftKey ? 10 : 1;
      const d = this._startDrag(handle.dataset, [0, 0]);
      if (!d) return;
      this._applyDrag(d, [step[0] * k, step[1] * k], true);
      if (!M.same(d.before, this._config)) {
        this._history.push(d.before);
        this._sel = handle.dataset.id;
        this._refresh();
        this._scheduleEmit();
      }
    }
  }

  _deletePoint() {
    const [, key, idx] = (this._sel || "").split("|");
    if (!key) return;
    const { pts } = this._pathGet(key);
    const next = pts.filter((_, i) => i !== Number(idx));
    this._sel = null;
    this._commit(this._pathSet(this._config, key, next));
    this._queueOverlay();
  }

  // ---- form helpers ----

  _check(label, checked, onChange, k) {
    const input = h("input", { type: "checkbox", "data-k": k });
    input.checked = !!checked;
    input.addEventListener("change", () => onChange(input.checked));
    return h("label", { class: "check" }, input, h("span", { text: label }));
  }

  _dropdown(label, options, value, onChange, k) {
    const sel = h("select", { "data-k": k, "aria-label": label }, ...options.map(([v, text]) => h("option", { value: v, text })));
    sel.value = value;
    sel.addEventListener("change", () => onChange(sel.value));
    return label ? h("label", { class: "field" }, h("span", { text: label }), sel) : sel;
  }

  _range(label, min, max, step, value, onInput, k, unit = "") {
    const input = h("input", { type: "range", min, max, step, "data-k": k });
    input.value = String(value);
    const out = h("span", { class: "rangev", text: `${fmt(value)}${unit}` });
    input.addEventListener("input", () => {
      out.textContent = `${fmt(+input.value)}${unit}`;
      onInput(+input.value);
    });
    input.addEventListener("change", () => this._endGesture());
    return h("label", { class: "field" }, h("span", null, label, out), input);
  }

  _text(label, value, onChange, k, extra = {}) {
    const input = h("input", { type: "text", "data-k": k, spellcheck: "false", autocomplete: "off", ...extra });
    input.value = value || "";
    input.addEventListener("change", () => onChange(input.value.trim()));
    return h("label", { class: "field" }, h("span", { text: label }), input);
  }

  _button(text, onClick, opts = {}) {
    return h("button", { type: "button", class: opts.cls, disabled: !!opts.disabled, "data-k": opts.k, "aria-pressed": opts.pressed === undefined ? null : String(opts.pressed), onclick: onClick, text });
  }

  _msg(text, kind = "") {
    return text ? h("div", { class: ["msg", kind], role: kind === "err" ? "alert" : null, text }) : null;
  }

  _fileButton(text, accept, onFile, k) {
    const input = h("input", { type: "file", accept, class: "file", tabindex: "-1", "aria-hidden": "true" });
    input.addEventListener("change", () => {
      const f = input.files?.[0];
      input.value = "";
      if (f) onFile(f);
    });
    const b = this._button(text, () => input.click(), { k });
    return h("span", null, b, input);
  }

  _renderBody() {
    if (!this._built) return;
    const active = this.shadowRoot.activeElement;
    const key = active?.dataset?.k;
    const fn = {
      photo: () => this._photoTab(),
      panel: () => this._panelTab(),
      lines: () => this._linesTab(),
      cars: () => this._carsTab(),
      battery: () => this._batteryTab(),
      labels: () => this._labelsTab(),
      colors: () => this._colorsTab(),
      backup: () => this._backupTab(),
    }[this._tab];
    this.$body.replaceChildren(...[fn()].flat().filter(Boolean));
    if (key && active && !active.isConnected) this.$body.querySelector(`[data-k="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  }

  // ---- photo ----

  async _uploadFile(file, kind, slot, onDone) {
    this._msgs[slot] = { text: t("ed_uploading") };
    this._renderBody();
    try {
      const out = await reencode(file, { kind, maxWidth: kind === "cutout" ? 1600 : 2400 });
      const url = await upload(this._hass, out.blob, kind === "cutout" ? "daymill-car.png" : "daymill-house.jpg");
      this._sizes[url] = { width: out.width, height: out.height };
      if (kind === "cutout") this._alpha[url] = out.alpha;
      this._msgs[slot] = null;
      onDone(url);
    } catch (err) {
      const code = String(err?.message || "");
      const known = ["not_image", "too_big", "no_upload", "upload_failed", "encode_failed"].includes(code);
      this._msgs[slot] = { text: t(`ed_err_${known ? code : "upload_failed"}`), kind: "err" };
      this._renderBody();
    }
  }

  _sizeOf(url) {
    if (!url) return null;
    if (!(url in this._sizes)) {
      this._sizes[url] = null;
      imageSize(url).then((sz) => {
        this._sizes[url] = sz;
        if (sz) this._renderBody();
      });
    }
    return this._sizes[url];
  }

  _photoTab() {
    const c = this._config;
    const photo = (key, title) => {
      const url = c[key] || "";
      const size = this._sizeOf(url);
      const m = this._msgs[key];
      return h(
        "div",
        { class: "card" },
        h("h4", { text: title }),
        h(
          "div",
          { class: "row" },
          this._fileButton(t("ed_upload"), "image/*", (f) => this._uploadFile(f, "photo", key, (u) => this._commit({ ...this._config, [key]: u })), `${key}-up`),
          url ? this._button(t("ed_remove"), () => this._commit(M.setIn(this._config, [key], undefined)), { k: `${key}-rm`, cls: "danger" }) : null,
        ),
        this._text(t("ed_url"), url, (v) => this._commit(M.setIn(this._config, [key], v || undefined)), `${key}-url`, { placeholder: "/api/image/serve/..." }),
        size ? this._msg(`${t("ed_size", { w: size.width, h: size.height })}. ${t("ed_size_note")}`) : null,
        m ? this._msg(m.text, m.kind) : null,
      );
    };
    const aspect = c.image_aspect;
    return [
      photo("image_day", t("ed_day_photo")),
      photo("image_night", t("ed_night_photo")),
      c.image_night ? null : this._msg(t("ed_no_night")),
      this._dropdown(
        t("ed_aspect"),
        [["", t("ed_aspect_auto")], ["16/9", "16:9"], ["16/10", "16:10"], ["3/2", "3:2"], ["4/3", "4:3"], ["1/1", "1:1"]].concat(
          aspect && !["16/9", "16/10", "3/2", "4/3", "1/1"].includes(String(aspect)) ? [[String(aspect), String(aspect)]] : [],
        ),
        aspect ? String(aspect) : "",
        (v) => this._commit(M.setIn(this._config, ["image_aspect"], v && aspectOf(v) ? v : undefined)),
        "aspect",
      ),
      this._msg(t("ed_privacy")),
    ];
  }

  // ---- panel ----

  _boxRaw(name) {
    const raw = this._config.layout?.[name];
    const n = this._n.layout[name];
    return { ...(raw && typeof raw === "object" ? raw : {}), x: n.x, y: n.y, w: n.w, h: n.h, skew: n.skew };
  }

  _panelTab() {
    const L = this._n.layout;
    const set = (patch, live = false) => {
      const next = M.setIn(this._config, ["layout", "panel"], { ...this._boxRaw("panel"), ...patch });
      if (live) this._live(next);
      else this._commit(next);
    };
    return [
      this._check(t("ed_show_panel"), L.panel.show, (v) => set({ show: v ? undefined : false }), "panel-show"),
      h(
        "div",
        { class: "grid2" },
        this._dropdown(t("ed_panel_style"), [["meter", t("ed_style_meter")], ["box", t("ed_style_box")]], L.panel.style, (v) => set({ style: v }), "panel-style"),
        this._range(t("ed_tilt"), -75, 75, 1, L.panel.skew, (v) => set({ skew: v }, true), "panel-skew", "°"),
        this._range(t("ed_width"), 0.004, 0.12, 0.001, L.panel.w, (v) => set({ w: v }, true), "panel-w"),
        this._range(t("ed_height"), 0.01, 0.35, 0.001, L.panel.h, (v) => set({ h: v }, true), "panel-h"),
      ),
      h(
        "div",
        { class: "card" },
        h("h4", { text: t("ed_junction") }),
        this._check(t("ed_show_junction"), L.junction.show, (v) => this._commit(M.setIn(this._config, ["layout", "junction"], v ? undefined : false)), "j-show"),
        L.junction.show
          ? this._check(t("ed_junction_follow"), !L.junction.at, (v) => {
            if (v) this._commit(M.setIn(this._config, ["layout", "junction"], undefined));
            else this._commit(M.setIn(this._config, ["layout", "junction"], this._frac(this._junctionPx()).map(M.r4)));
          }, "j-follow")
          : null,
      ),
    ];
  }

  // ---- lines ----

  _lineControls(key) {
    const { pts, curved } = this._pathGet(key);
    const selPt = this._sel?.startsWith(`pt|${key}|`);
    return [
      h(
        "div",
        { class: "row" },
        this._button(t("ed_delete_point"), () => this._deletePoint(), { disabled: !selPt, k: "del-pt", cls: "danger" }),
        this._button(t("ed_clear_line"), () => {
          this._sel = null;
          this._commit(this._pathSet(this._config, key, []));
        }, { disabled: !pts.length, k: "clear-line" }),
        key.startsWith("solar")
          ? this._button(t("ed_remove_line"), () => {
            this._sel = null;
            this._line = "solar0";
            this._commit(M.removeSolarLine(this._config, Number(key.slice(5))));
          }, { k: "rm-line", cls: "danger" })
          : null,
      ),
      curved ? this._msg(t("ed_curved"), "warn") : null,
      pts.length ? null : this._msg(t("ed_empty_line")),
    ];
  }

  _linesTab() {
    const lines = M.effectiveLines(this._config);
    const keys = Object.keys(lines).filter((k) => k !== "battery");
    if (!keys.includes(this._line)) this._line = keys[0] || "home";
    const pick = keys.map((k) =>
      this._button(this._lineName(k), () => {
        this._line = k;
        this._sel = null;
        this._refresh();
        this._queueOverlay();
      }, { pressed: this._line === k, k: `line-${k}` }),
    );
    return [
      h("div", { class: "row", role: "group", "aria-label": t("ed_tab_lines") }, ...pick, this._button(`+ ${t("ed_add_solar")}`, () => {
        const n = M.solarCount(this._config);
        this._line = `solar${n}`;
        this._sel = null;
        this._commit(M.addSolarLine(this._config));
      }, { k: "add-solar" })),
      ...this._lineControls(this._line),
      this._check(t("ed_round"), !!this._config.layout?.round_corners, (v) => this._commit(M.setIn(this._config, ["layout", "round_corners"], v ? true : undefined)), "round"),
    ];
  }

  // ---- cars ----

  _setCar(i, patch) {
    this._commit(M.setCar(this._config, this._known, i, patch));
  }

  _carsTab() {
    const cars = this._cars;
    if (this._car >= cars.length) this._car = Math.max(0, cars.length - 1);
    const add = this._button(`+ ${t("ed_add_car")}`, () => {
      const list = cars.map((c) => ({ ...c }));
      const car = { name: t("ed_car_n", { n: list.length + 1 }) };
      if (this._config.image_day) car.image = "builtin";
      list.push(car);
      this._car = list.length - 1;
      this._commit({ ...this._config, cars: list });
    }, { k: "add-car" });
    if (!cars.length) return [this._msg(t("ed_no_cars")), h("div", { class: "row" }, add)];
    const pick = cars.map((c, i) =>
      this._button(c.name || t("ed_car_n", { n: i + 1 }), () => {
        this._car = i;
        this._sel = null;
        this._refresh();
        this._queueOverlay();
      }, { pressed: this._car === i, k: `car-${i}` }),
    );
    const c = cars[this._car];
    const i = this._car;
    const kind = builtinCar(c.image);
    const picValue = !c.image ? "" : kind ? (kind === "sedan" ? "builtin" : `builtin:${kind}`) : "custom";
    const custom = picValue === "custom" || this._customPic === i;
    const mode = this._cableMode(i);
    const alphaKnown = c.image && !kind ? this._alphaOf(c.image) : undefined;
    const m = this._msgs[`car${i}`];
    const placed = this.$card.placedCars.find((x) => x.index === i);
    const slotW = placed?.slot.w ?? 0.135;
    const entities = Object.keys(this._hass?.states || {});
    const roles = M.ROLES.map((r) => {
      const id = `dl-${r}`;
      const list = h("datalist", { id }, ...entities.filter((e) => ROLE_DOMAINS[r].includes(e.split(".")[0])).map((e) => h("option", { value: e })));
      return h("div", null, this._text(t(`ed_role_${r.replace("_entity", "")}`), c[r], (v) => this._setCar(i, { [r]: v || undefined }), `role-${r}`, { list: id }), list);
    });
    return [
      Array.isArray(this._config.cars) ? null : this._msg(t("ed_found_cars")),
      this._config.image_day && !(c.image && !kind) ? this._msg(t("ed_drawn_on_photo")) : null,
      h("div", { class: "row", role: "group", "aria-label": t("ed_tab_cars") }, ...pick, add),
      h(
        "div",
        { class: "card" },
        h("div", { class: "grid2" },
          this._text(t("ed_name"), c.name, (v) => this._setCar(i, { name: v || undefined }), "car-name"),
          this._dropdown(t("ed_picture"), [["", t("ed_pic_none")], ["builtin", t("ed_pic_sedan")], ["builtin:suv", t("ed_pic_suv")], ["builtin:truck", t("ed_pic_truck")], ["custom", t("ed_pic_custom")]], custom ? "custom" : picValue, (v) => {
            if (v === "custom") {
              this._customPic = i;
              this._renderBody();
              return;
            }
            this._customPic = null;
            this._setCar(i, { image: v || undefined, image_ratio: undefined });
          }, "car-pic"),
        ),
        custom
          ? h("div", { class: "row" },
            this._fileButton(t("ed_upload_png"), "image/png,image/webp,image/*", (f) => this._uploadFile(f, "cutout", `car${i}`, (u) => {
              this._customPic = null;
              this._setCar(i, { image: u, image_ratio: undefined });
            }), "car-up"),
          )
          : null,
        custom ? this._text(t("ed_url"), kind ? "" : c.image, (v) => this._setCar(i, { image: v || undefined, image_ratio: undefined }), "car-url") : null,
        m ? this._msg(m.text, m.kind) : null,
        alphaKnown === false ? this._msg(t("ed_no_alpha"), "warn") : alphaKnown === true ? this._msg(t("ed_alpha_ok"), "ok") : null,
        h("div", { class: "grid2" },
          this._check(t("ed_flip"), !!c.flip, (v) => this._setCar(i, { flip: v || undefined }), "car-flip"),
          this._range(t("ed_car_size"), 0.03, 0.6, 0.001, slotW, (v) => {
            const slot = { x: M.r4(placed?.slot.x ?? 0.5), y: M.r4(placed?.slot.y ?? 0.6), w: M.r4(v) };
            this._live(M.setCar(this._config, this._known, i, { slot }));
          }, "car-size"),
        ),
        this._dropdown(t("ed_cable"), [["auto", t("ed_cable_auto")], ["draw", t("ed_cable_draw")], ["none", t("ed_cable_none")]], mode, (v) => {
          this._sel = null;
          if (v === "none") this._setCar(i, { show_cable: false, cable: undefined, cable_path: undefined });
          else if (v === "auto") this._setCar(i, { show_cable: undefined, cable: undefined, cable_path: undefined });
          else this._setCar(i, { show_cable: undefined, cable: [] });
        }, "car-cable"),
        h("div", { class: "row" },
          mode === "draw" ? this._button(t("ed_clear_cable"), () => this._setCar(i, { cable: [] }), { k: "clear-cable" }) : null,
          mode === "draw" && this._sel?.startsWith(`pt|cable${i}|`) ? this._button(t("ed_delete_point"), () => this._deletePoint(), { k: "del-pt", cls: "danger" }) : null,
          c.port ? this._button(t("ed_reset_port"), () => this._setCar(i, { port: undefined }), { k: "reset-port" }) : null,
          c.cable_start && mode === "auto" ? this._button(t("ed_reset_start"), () => this._setCar(i, { cable_start: undefined }), { k: "reset-start" }) : null,
        ),
        h("details", null, h("summary", { text: t("ed_car_entities") }), h("div", { class: "grid2" }, ...roles)),
        h("div", { class: "row" }, this._button(t("ed_remove_car"), () => {
          const list = cars.filter((_, j) => j !== i);
          this._car = Math.max(0, i - 1);
          this._commit({ ...this._config, cars: list });
        }, { k: "rm-car", cls: "danger" })),
      ),
    ];
  }

  _alphaOf(url) {
    if (url in this._alpha) return this._alpha[url];
    this._alpha[url] = undefined;
    const img = new Image();
    img.onload = () => {
      try {
        this._alpha[url] = hasAlpha(img, img.naturalWidth, img.naturalHeight);
      } catch {
        this._alpha[url] = undefined; // another site's picture: can't look inside
      }
      this._renderBody();
    };
    img.src = url;
    return undefined;
  }

  // ---- battery ----

  _batteryTab() {
    const L = this._n.layout;
    const set = (patch, live = false) => {
      const next = M.setIn(this._config, ["layout", "battery"], { ...this._boxRaw("battery"), ...patch });
      if (live) this._live(next);
      else this._commit(next);
    };
    return [
      this._msg(t("ed_battery_note")),
      this._check(t("ed_show_battery"), L.battery.show, (v) => set({ show: v ? undefined : false }), "batt-show"),
      this._range(t("ed_tilt"), -75, 75, 1, L.battery.skew, (v) => set({ skew: v }, true), "batt-skew", "°"),
      this._batteryPictures(L.battery, set),
      h("div", { class: "card" }, h("h4", { text: t("ed_battery_line") }), ...this._lineControls("battery")),
    ];
  }

  // Optional pictures of the owner's own battery, drawn in the battery box.
  _batteryPictures(b, set) {
    const row = (key, label) => {
      const url = b[key] || "";
      const m = this._msgs[`batt-${key}`];
      const alpha = url ? this._alphaOf(url) : undefined;
      return [
        h("div", { class: "row" },
          h("span", { class: "lab", text: label }),
          this._fileButton(t("ed_upload_png"), "image/png,image/webp,image/*", (f) => this._uploadFile(f, "cutout", `batt-${key}`, (u) => set({ [key]: u })), `batt-${key}-up`),
          url ? this._button(t("ed_remove"), () => set(key === "image" ? { image: undefined, image_night: undefined } : { [key]: undefined }), { k: `batt-${key}-rm`, cls: "danger" }) : null,
        ),
        m ? this._msg(m.text, m.kind) : null,
        alpha === false ? this._msg(t("ed_no_alpha"), "warn") : null,
      ];
    };
    return h("div", { class: "card" },
      h("h4", { text: t("ed_battery_picture") }),
      this._msg(t("ed_battery_picture_note")),
      ...row("image", t("ed_batt_day")),
      ...(b.image ? row("image_night", t("ed_batt_night")) : []),
    );
  }

  // ---- labels ----

  _labelsTab() {
    const L = this._n.layout;
    const rows = [];
    const align = (value, onChange, k) => {
      const sel = this._dropdown(null, [["left", t("ed_align_left")], ["center", t("ed_align_center")], ["right", t("ed_align_right")]], value, onChange, k);
      sel.setAttribute("aria-label", t("ed_align"));
      return sel;
    };
    const setChip = (k, patch) => {
      const raw = this._config.layout?.chips?.[k];
      const keep = raw && typeof raw === "object" ? raw : {};
      const next = { ...keep, ...patch };
      for (const [a, b] of Object.entries(next)) if (b === undefined) delete next[a];
      this._commit(M.setIn(this._config, ["layout", "chips", k], Object.keys(next).length ? next : undefined));
    };
    for (const k of M.CHIP_KEYS) {
      const chip = L.chips[k];
      const row = h("div", { class: "chiprow" }, h("span", { text: t(`ed_chip_${k}`) }), this._check(t("ed_show"), chip.show, (v) => setChip(k, { show: v ? undefined : false }), `show-${k}`));
      if (k === "today") {
        row.append(
          chip.stack ? h("span", { class: "lab" }) : align(chip.align, (v) => setChip(k, { align: v }), `align-${k}`),
          this._check(t("ed_stack"), !!chip.stack, (v) => {
            if (v) setChip(k, { stack: true, x: undefined, y: undefined, align: undefined });
            else {
              const a = this._chipAnchor("today");
              setChip(k, { stack: undefined, x: M.r4(a.x), y: M.r4(a.y), align: a.align });
            }
          }, "stack-today"),
        );
      } else row.append(align(chip.align, (v) => setChip(k, { align: v }), `align-${k}`), h("span"));
      rows.push(row);
    }
    this._cars.forEach((c, i) => {
      const raw = c.chip;
      const shown = raw !== false && !(raw && raw.show === false);
      const auto = !(raw && typeof raw === "object" && raw.x !== undefined);
      const set = (patch) => {
        const base = raw && typeof raw === "object" ? raw : {};
        const next = { ...base, ...patch };
        for (const [a, b] of Object.entries(next)) if (b === undefined) delete next[a];
        this._setCar(i, { chip: Object.keys(next).length ? next : undefined });
      };
      rows.push(
        h(
          "div",
          { class: "chiprow" },
          h("span", { text: c.name || t("ed_car_n", { n: i + 1 }) }),
          this._check(t("ed_show"), shown, (v) => set({ show: v ? undefined : false }), `show-car${i}`),
          align((raw && raw.align) || "center", (v) => set({ align: v }), `align-car${i}`),
          auto ? h("span", { class: "lab", text: t("ed_auto_pos") }) : this._button(t("ed_reset"), () => set({ x: undefined, y: undefined }), { k: `reset-car${i}` }),
        ),
      );
    });
    return h("div", { class: "list" }, ...rows);
  }

  // ---- colors ----

  _colorsTab() {
    const colors = this._config.colors || {};
    const rows = COLOR_KEYS.map((k) => {
      const input = h("input", { type: "color", "data-k": `color-${k}`, "aria-label": t(`ed_col_${k}`) });
      const cur = colors[k];
      input.value = /^#[0-9a-f]{6}$/i.test(cur || "") ? cur : COLORS[k];
      input.addEventListener("input", () => this._live(M.setIn(this._config, ["colors", k], input.value)));
      input.addEventListener("change", () => this._endGesture());
      return h(
        "div",
        { class: "colrow" },
        h("span", { text: t(`ed_col_${k}`) }),
        input,
        this._button(t("ed_reset"), () => this._commit(M.setIn(this._config, ["colors", k], undefined)), { disabled: !cur, k: `reset-${k}` }),
      );
    });
    return [
      h("div", { class: "list" }, ...rows),
      h("div", { class: "row" }, this._button(t("ed_reset_colors"), () => this._commit(M.setIn(this._config, ["colors"], undefined)), { disabled: !Object.keys(colors).length, k: "reset-colors" })),
    ];
  }

  // ---- backup ----

  _backupTab() {
    const json = JSON.stringify(M.exportLayout(M.clean(this._config)), null, 2);
    const area = h("textarea", { "data-k": "json", spellcheck: "false", "aria-label": t("ed_layout_json") });
    area.value = json;
    const m = this._msgs.backup;
    const load = (text) => {
      try {
        const next = M.importLayout(this._config, text);
        this._msgs.backup = { text: t("ed_applied"), kind: "ok" };
        this._commit(next);
        this._renderBody();
      } catch (err) {
        const code = ["bad_json", "no_layout"].includes(err.message) ? `ed_err_${err.message}` : null;
        this._msgs.backup = { text: code ? t(code) : String(err.message || err), kind: "err" };
        this._renderBody();
      }
    };
    return [
      h(
        "div",
        { class: "row" },
        this._button(t("ed_download"), () => {
          const url = URL.createObjectURL(new Blob([json + "\n"], { type: "application/json" }));
          const a = h("a", { href: url, download: "daymill-layout.json" });
          this.shadowRoot.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, { k: "download" }),
        this._fileButton(t("ed_load_file"), "application/json,.json", async (f) => load(await f.text()), "load"),
        this._button(t("ed_copy"), async () => {
          try {
            await navigator.clipboard.writeText(area.value);
            this._msgs.backup = { text: t("ed_copied"), kind: "ok" };
          } catch {
            area.select();
          }
          this._renderBody();
        }, { k: "copy" }),
        this._button(t("ed_apply"), () => load(area.value), { k: "apply" }),
      ),
      h("label", { class: "field" }, h("span", { text: t("ed_layout_json") }), area),
      m ? this._msg(m.text, m.kind) : null,
    ];
  }
}

defineElement("daymill-house-card-editor", HouseCardEditor);
