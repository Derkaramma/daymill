// daymill-panels-card: every panel at a glance. Power columns for all panels,
// one block per roof face (tiles with power and today's kWh), lifetime kWh per
// panel, the health check and an optional list of gateway diagnostics.
//
// type: custom:daymill-panels-card
// groups: [...]            # optional, see common/panel-groups.js
// diagnostics: [sensor.gateway_uptime, {entity: sensor.x, name: CPU, divider: true}]
// show_chart / show_groups / show_lifetime / show_health / show_diagnostics: true
// max_power: 400           # W, fixes the column scale
//
// Hidden when there are no panels and no diagnostics.

import { DayMillCard, defineCard, h, setStyle, asButton } from "../common/base.js";
import { attr, isOn, powerKw, energyKwh, stateObj, isAvailable, toNumber, unit } from "../common/entities.js";
import { kw, kwh, num, numFmt, pct, time, t, DASH } from "../common/format.js";
import { fetchStatistics, startOfDay } from "../common/ws.js";
import { diagnosticEntities, facingText, median, panelFlags, panelGroups } from "../common/panel-groups.js";

const TODAY_TTL = 5 * 60_000;
const LOW_LIFETIME = 0.75; // flag panels under 75% of their group's median
const COMPACT_OVER = 16; // hide column values past this many panels

const css = `
:host([hidden]) { display: none !important; }
[hidden] { display: none !important; }
ha-card { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.head .ttl { flex: 1 1 auto; min-width: 0; }
.head .name { font-size: 1.15em; font-weight: 600; color: var(--sf-text); letter-spacing: .01em; }
.head .sub { color: var(--sf-text-2); font-size: .9em; margin-top: 2px; font-variant-numeric: tabular-nums; }
.health { gap: 8px; max-width: 100%; }
.health span:last-child { overflow: hidden; text-overflow: ellipsis; }
.health.ok { border-color: color-mix(in srgb, var(--sf-export) 55%, transparent); }
.health.ok .sf-dot { background: var(--sf-export); box-shadow: 0 0 8px var(--sf-export); }
.health.bad { border-color: var(--sf-error); color: var(--sf-error); }
.health.bad .sf-dot { background: var(--sf-error); box-shadow: 0 0 8px var(--sf-error); }
.health.warn { border-color: var(--sf-warn); color: var(--sf-warn-text); }
.health.warn .sf-dot { background: var(--sf-warn); }

.glass {
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--sf-text) 11%, transparent);
  background: linear-gradient(160deg,
    color-mix(in srgb, var(--sf-text) 7%, transparent),
    color-mix(in srgb, var(--sf-text) 2%, transparent));
  box-shadow: 0 2px 10px rgba(0, 0, 0, .16);
}
.block { padding: 12px 14px; }
.label {
  display: flex; align-items: baseline; gap: 8px;
  font-size: .75em; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
  color: var(--sf-text-2); margin-bottom: 8px;
}
.label .r { margin-left: auto; letter-spacing: 0; text-transform: none; font-weight: 500; font-variant-numeric: tabular-nums; }

/* column charts */
.chart { position: relative; }
.plot { position: relative; height: 136px; display: flex; align-items: stretch; gap: 14px; }
.grid-line {
  position: absolute; left: 0; right: 0; top: 16px; height: 0;
  border-top: 1px dashed color-mix(in srgb, var(--sf-text) 16%, transparent);
}
.grid-line span {
  position: absolute; left: 0; top: -14px; font-size: .68em; color: var(--sf-text-2);
}
.cg { flex: var(--n) 1 0; min-width: 0; display: flex; flex-direction: column; }
.cols { flex: 1; display: flex; align-items: stretch; justify-content: center; gap: 4px; padding-top: 18px; }
.col {
  flex: 1 1 0; min-width: 0; max-width: 72px;
  display: flex; flex-direction: column; justify-content: flex-end; align-items: stretch;
  border-radius: 6px;
}
.col .v {
  font-size: .68em; text-align: center; color: var(--sf-text-2); white-space: nowrap;
  overflow: hidden; margin-bottom: 3px; font-variant-numeric: tabular-nums;
}
.col .bar {
  min-height: 2px; border-radius: 5px 5px 2px 2px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--c) 65%, #fff), var(--c));
  box-shadow: 0 0 12px color-mix(in srgb, var(--c) 40%, transparent);
  transition: height .6s ease;
}
.col.dim .bar { background: color-mix(in srgb, var(--c) 28%, transparent); box-shadow: none; }
.col.life .bar { background: linear-gradient(180deg, color-mix(in srgb, var(--c) 80%, transparent), color-mix(in srgb, var(--c) 18%, transparent)); box-shadow: none; }
.col.flag .bar { background: linear-gradient(180deg, color-mix(in srgb, var(--sf-error) 60%, #fff), var(--sf-error)); }
.col.flag .v { color: var(--sf-error); }
.col.low .bar { background: color-mix(in srgb, var(--sf-warn) 75%, transparent); box-shadow: 0 0 10px color-mix(in srgb, var(--sf-warn) 35%, transparent); }
.col.low .v { color: var(--sf-warn-text); }
.xs { display: flex; justify-content: center; gap: 4px; margin-top: 4px; }
.xs span { flex: 1 1 0; min-width: 0; max-width: 72px; text-align: center; font-size: .68em; color: var(--sf-text-2); font-variant-numeric: tabular-nums; }
.gname {
  margin-top: 3px; padding-top: 3px; font-size: .74em; color: var(--sf-text); text-align: center;
  border-top: 2px solid var(--c); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.rest {
  position: absolute; left: 0; right: 0; top: 16px; bottom: 40px;
  display: flex; align-items: center; justify-content: center;
  color: var(--sf-text-2); font-size: .85em; letter-spacing: .06em; text-transform: uppercase;
}
.compact .col .v, .resting .col .v, .resting .grid-line span { visibility: hidden; }

/* roof faces */
.faces { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; }
.face { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.fhead { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fhead .sf-dot { background: var(--c); box-shadow: 0 0 8px var(--c); }
.fhead .fn { font-weight: 600; color: var(--sf-text); }
.fhead .fc { color: var(--sf-text-2); font-size: .85em; }
.fhead .ft { margin-left: auto; font-size: .85em; color: var(--sf-text); font-variant-numeric: tabular-nums; white-space: nowrap; }
.fnote { color: var(--sf-text-2); font-size: .82em; line-height: 1.35; margin-top: -4px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
.tile {
  position: relative; padding: 8px 10px 9px; border-radius: 11px; overflow: hidden;
  background: color-mix(in srgb, var(--sf-text) 5%, transparent);
  border: 1px solid color-mix(in srgb, var(--sf-text) 9%, transparent);
}
.tile.on { border-color: color-mix(in srgb, var(--c) 38%, transparent); }
.tile.on::before {
  content: ""; position: absolute; left: 0; right: 0; top: 0; height: 2px;
  background: linear-gradient(90deg, transparent, var(--c), transparent); opacity: .85;
}
.tile.flag { border-color: var(--sf-error); background: color-mix(in srgb, var(--sf-error) 10%, transparent); }
.tile .tn { font-size: .78em; color: var(--sf-text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tile .tp { font-size: 1.15em; font-weight: 600; color: var(--sf-text); margin-top: 2px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.tile .tt { font-size: .76em; color: var(--sf-text-2); margin-top: 1px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.tile .tf { font-size: .74em; color: var(--sf-error); margin-top: 3px; }
.meter { height: 3px; border-radius: 2px; margin-top: 6px; background: color-mix(in srgb, var(--sf-text) 10%, transparent); overflow: hidden; }
.meter i { display: block; height: 100%; border-radius: 2px; background: var(--c); }

/* bottom row */
.bottom { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
.hrow { display: flex; align-items: center; gap: 10px; padding: 6px 4px; border-radius: 8px; }
.hrow + .hrow { border-top: 1px solid color-mix(in srgb, var(--sf-text) 8%, transparent); }
.hico {
  width: 30px; height: 30px; border-radius: 50%; flex: none; display: grid; place-items: center;
  background: color-mix(in srgb, var(--k) 18%, transparent); color: var(--k);
}
.hico svg { width: 18px; height: 18px; fill: currentColor; }
.hk { color: var(--sf-text-2); font-size: .8em; }
.hv { color: var(--sf-text); font-weight: 500; overflow-wrap: anywhere; }
.hnote { color: var(--sf-text-2); font-size: .78em; line-height: 1.35; margin-top: 8px; }
.drow { display: flex; align-items: baseline; gap: 12px; padding: 7px 4px; border-radius: 8px; font-size: .92em; }
.drow + .drow { border-top: 1px solid color-mix(in srgb, var(--sf-text) 8%, transparent); }
.drow.sep { border-top: 1px solid color-mix(in srgb, var(--sf-text) 22%, transparent); margin-top: 4px; }
.drow .dk { flex: 1; min-width: 0; color: var(--sf-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.drow .dv { color: var(--sf-text); font-variant-numeric: tabular-nums; white-space: nowrap; }
.lnote { display: flex; gap: 6px; align-items: center; color: var(--sf-warn-text); font-size: .8em; margin-top: 8px; }
.lnote .sf-dot { width: 8px; height: 8px; background: var(--sf-warn); }
`;

// mdi paths, inlined so nothing is fetched.
const ICON_OK = "M12 2C6.5 2 2 6.5 2 12S6.5 22 12 22 22 17.5 22 12 17.5 2 12 2M10 17L5 12L6.41 10.59L10 14.17L17.59 6.58L19 8L10 17Z";
const ICON_ALERT = "M13 14H11V9H13M13 18H11V16H13M1 21H23L12 2L1 21Z";
const ICON_BELL = "M21 19V20H3V19L5 17V11C5 7.9 7.03 5.17 10 4.29V4A2 2 0 0 1 12 2A2 2 0 0 1 14 4V4.29C16.97 5.17 19 7.9 19 11V17L21 19M14 21A2 2 0 0 1 12 23A2 2 0 0 1 10 21";

function icon(d) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", d);
  svg.append(p);
  return svg;
}

// Round a max up to a tidy axis value.
export function niceMax(v) {
  if (!(v > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10].map((m) => m * mag).find((s) => s >= v * 0.9999) || v;
}

function duration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400);
  const hh = Math.floor((s % 86400) / 3600);
  const mm = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${hh}h`;
  if (hh) return `${hh}h ${mm}m`;
  return `${mm}m`;
}

// State of a diagnostic entity, formatted with its unit.
function diagValue(hass, id) {
  const st = stateObj(hass, id);
  if (!isAvailable(st)) return st ? t("unavailable") : DASH;
  const n = toNumber(st.state);
  const u = unit(hass, id);
  if (n === undefined) return st.state;
  if (st.attributes?.device_class === "duration") {
    const f = { s: 1, min: 60, h: 3600, d: 86400 }[u];
    if (f) return duration(n * f);
  }
  const digits = Math.abs(n) >= 100 || Number.isInteger(n) ? 0 : 1;
  return `${num(hass, n, 0, digits)}${u ? (u === "%" ? "%" : ` ${u}`) : ""}`;
}

// Setters that skip the DOM write when nothing changed.
function setText(el, value) {
  const v = String(value);
  if (el.textContent !== v) el.textContent = v;
}

function setClass(el, list) {
  const v = list.filter(Boolean).join(" ");
  if (el.getAttribute("class") !== v) el.setAttribute("class", v);
}

function setAttr(el, name, value) {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

const lastProps = new WeakMap();
function setProp(el, name, value) {
  let seen = lastProps.get(el);
  if (!seen) lastProps.set(el, (seen = {}));
  if (seen[name] === value) return;
  seen[name] = value;
  el.style.setProperty(name, value);
}

function compactKwh(hass, v) {
  if (!Number.isFinite(v)) return DASH;
  if (Math.abs(v) >= 10000) {
    return numFmt(hass, { notation: "compact", maximumFractionDigits: 1 }).format(v);
  }
  return num(hass, v, 0, v < 10 ? 1 : 0);
}

class DayMillPanelsCard extends DayMillCard {
  static styles = [css];
  static keys = ["panel_health", "solar_problem"];
  static grid = { columns: 12, min_columns: 6, rows: "auto" };
  static cardSize = 8;
  // Works from card config alone (groups / diagnostics), so no "not found" hint.
  static requiresDayMill = false;

  static getStubConfig() {
    return {};
  }

  constructor() {
    super();
    this._today = {};
    this._todayKey = undefined;
    this._todayAt = 0;
  }

  validateConfig(config) {
    if (config.groups !== undefined && !Array.isArray(config.groups)) throw new Error("groups must be a list");
    if (config.diagnostics !== undefined && !Array.isArray(config.diagnostics)) throw new Error("diagnostics must be a list");
  }

  // Groups and diagnostics, recomputed when config, registry or the health sensor change.
  get groups() {
    const hass = this.hass;
    const health = stateObj(hass, this.entities.panel_health);
    const c = this._groupCache;
    if (!c || c.cfg !== this.config || c.health !== health || c.reg !== hass?.entities) {
      this._groupCache = {
        cfg: this.config,
        health,
        reg: hass?.entities,
        list: panelGroups(hass, this.config),
        diag: diagnosticEntities(hass, this.config),
      };
    }
    return this._groupCache;
  }

  watchedEntities() {
    const ids = Object.values(this.entities);
    const { list, diag } = this.groups;
    for (const g of list) for (const p of g.panels) ids.push(p.power, p.energy, p.today);
    for (const d of diag) ids.push(typeof d === "string" ? d : d.entity);
    return ids.filter(Boolean);
  }

  getCardSize() {
    if (!this.hass || !this.config) return this.constructor.cardSize;
    const { list } = this.groups;
    if (!list.length) return 0;
    return 6 + Math.ceil(list.length / 2) * 3;
  }

  _show(key) {
    return this.config?.[`show_${key}`] !== false;
  }

  // Hidden cards tell the dashboard, so sections can collapse the slot.
  _setVisible(visible) {
    if (this.hidden === !visible) return;
    this.hidden = !visible;
    this.dispatchEvent(new CustomEvent("card-visibility-changed", { detail: { value: visible }, bubbles: true, composed: true }));
  }

  build() {
    this.card = h("ha-card");
    this._ui = undefined;
    this.shadowRoot.append(this.card);
  }

  render() {
    const { list, diag } = this.groups;
    if (!list.length && !diag.length) {
      this.card.replaceChildren();
      this._ui = undefined;
      this._setVisible(false);
      return;
    }
    this._setVisible(true);
    this._loadToday(list);
    this._paint();
  }

  // ---- today's kWh from statistics of the lifetime counters ----

  _loadToday(groups) {
    const ids = groups.flatMap((g) => g.panels.filter((p) => p.energy && !p.today).map((p) => p.energy));
    if (!ids.length || typeof this.hass?.callWS !== "function") return;
    const start = startOfDay(new Date());
    const key = `${start.getTime()}|${ids.join(",")}`;
    if (key === this._todayKey && Date.now() - this._todayAt < TODAY_TTL) return;
    this._todayKey = key;
    this._todayAt = Date.now();
    fetchStatistics(this.hass, { statisticIds: ids, start, period: "hour", types: ["change"], units: { energy: "kWh" } })
      .then((res) => {
        if (key !== this._todayKey) return;
        const out = {};
        for (const id of ids) {
          const rows = res?.[id];
          if (rows) out[id] = rows.reduce((a, r) => a + (Number.isFinite(r.change) ? r.change : 0), 0);
        }
        this._today = out;
        if (this.isConnected && this._built && this.hass) this.keepFocus(() => this._paint());
      })
      .catch((err) => {
        console.warn("daymill-panels-card: no statistics,", err?.message || err);
        this._todayAt = 0;
      });
  }

  _todayKwh(p) {
    if (p.today) return energyKwh(this.hass, p.today);
    if (p.energy) return this._today[p.energy];
    return undefined;
  }

  // ---- drawing ----
  //
  // The DOM is built once per layout (groups, diagnostics, which blocks show,
  // language) and every update after that only touches text, classes and
  // sizes. Panel power changes every few seconds, so this keeps focus and
  // hover where they are and stays cheap with lots of panels.

  _paint() {
    const hass = this.hass;
    const { list, diag } = this.groups;
    const e = this.entities;
    const findings = e.panel_health ? stateObj(hass, e.panel_health)?.state : undefined;
    const flags = panelFlags(findings, list.flatMap((g) => g.panels.map((p) => p.name)));
    const rows = list.map((g) => ({
      g,
      panels: g.panels.map((p) => ({
        p,
        kw: powerKw(hass, p.power),
        today: this._todayKwh(p),
        life: energyKwh(hass, p.energy),
        flag: flags[p.name],
      })),
    }));
    const all = rows.flatMap((r) => r.panels);
    const show = {
      chart: all.length > 0 && this._show("chart"),
      groups: all.length > 0 && this._show("groups"),
      lifetime: all.some((x) => Number.isFinite(x.life)) && this._show("lifetime"),
      health: this._show("health") && !!(e.panel_health || e.solar_problem),
      diagnostics: diag.length > 0 && this._show("diagnostics"),
      pill: findings !== undefined,
    };
    const layout = [this._layoutKey(), e.panel_health, e.solar_problem, hass.language, hass.locale, ...Object.values(show)];
    if (!this._ui || layout.length !== this._ui.layout.length || layout.some((v, i) => v !== this._ui.layout[i])) {
      this._ui = this._build(rows, diag, show);
      this._ui.layout = layout;
      this.card.replaceChildren(...this._ui.parts);
    }
    this._fill(this._ui, rows, all, diag, findings);
  }

  // Layout-relevant parts of the groups as one string, cached with them.
  _layoutKey() {
    const c = this.groups;
    c.key ??= JSON.stringify([
      c.list.map((g) => [g.label, g.facing, g.note, g.color, g.panels.map((p) => [p.name, p.short, p.power, p.energy, p.today])]),
      c.diag,
    ]);
    return c.key;
  }

  _build(rows, diag, show) {
    const ui = { parts: [], show };
    ui.parts.push(this._buildHeader(ui, rows, show.pill));
    if (show.chart) ui.parts.push(this._buildPowerChart(ui, rows));
    if (show.groups) {
      ui.faces = rows.map((r) => this._buildFace(r));
      ui.parts.push(h("div", { class: "faces" }, ui.faces.map((f) => f.el)));
    }
    if (show.lifetime) ui.parts.push(this._buildLifetime(ui, rows));
    const bottom = [];
    if (show.health) bottom.push(this._buildHealth(ui));
    if (show.diagnostics) bottom.push(this._buildDiagnostics(ui, diag));
    if (bottom.length) ui.parts.push(h("div", { class: "bottom" }, bottom));
    return ui;
  }

  _fill(ui, rows, all, diag, findings) {
    const hass = this.hass;
    const totalKw = all.reduce((a, x) => a + (x.kw > 0 ? x.kw : 0), 0);
    if (ui.sub) {
      const bits = [all.length === 1 ? t("panels_count_one") : t("panels_count", { n: all.length }), t("panels_total_now", { power: kw(hass, totalKw, { unit: "auto" }) })];
      setText(ui.sub, bits.join(" · "));
    }
    if (ui.pill) this._fillPill(ui.pill, findings);
    if (ui.power) this._fillPowerChart(ui.power, rows);
    if (ui.faces) rows.forEach((r, i) => this._fillFace(ui.faces[i], r));
    if (ui.life) this._fillLifetime(ui.life, rows);
    if (ui.health) this._fillHealth(ui.health, findings);
    if (ui.diag) this._fillDiagnostics(ui.diag, diag);
  }

  // ---- header ----

  _buildHeader(ui, rows, withPill) {
    const count = rows.reduce((a, r) => a + r.panels.length, 0);
    ui.sub = count ? h("div", { class: "sub" }) : null;
    const head = h("div", { class: "head" }, h("div", { class: "ttl" }, h("div", { class: "name", text: this.config.title ?? t("panels_title") }), ui.sub));
    if (withPill) {
      const text = h("span");
      const el = h("span", { class: "sf-pill health" }, h("span", { class: "sf-dot" }), text);
      asButton(el, () => this.moreInfo(this.entities.panel_health), t("panels_health"));
      el.dataset.k = "health-pill";
      ui.pill = { el, text };
      head.append(el);
    }
    return head;
  }

  _fillPill(pill, findings) {
    const hass = this.hass;
    const available = isAvailable(stateObj(hass, this.entities.panel_health));
    const ok = findings === "OK";
    const cls = ok ? "ok" : !available ? "" : isOn(hass, this.entities.solar_problem) ? "bad" : "warn";
    setClass(pill.el, ["sf-pill", "health", cls]);
    setText(pill.text, ok ? t("panels_all_ok") : available ? findings : t("unavailable"));
  }

  // ---- columns grouped by roof face, with one dashed line at the scale top ----

  _buildColumns(rows, label) {
    const count = rows.reduce((a, r) => a + r.panels.length, 0);
    const topLabel = h("span");
    const plot = h("div", { class: "plot" }, h("div", { class: "grid-line" }, topLabel));
    const cols = [];
    for (const r of rows) {
      const colsEl = h("div", { class: "cols" });
      const xs = h("div", { class: "xs" });
      for (const x of r.panels) {
        const v = h("div", { class: "v" });
        const bar = h("div", { class: "bar" });
        const col = h("div", { class: "col" }, v, bar);
        const p = x.p;
        asButton(col, () => this.moreInfo(p.power || p.energy));
        col.dataset.k = `${label}:${p.name}`;
        cols.push({ col, v, bar });
        colsEl.append(col);
        xs.append(h("span", { text: p.short }));
      }
      const g = h("div", { class: "cg" }, colsEl, xs, h("div", { class: "gname", text: r.g.label }));
      setStyle(g, { "--n": r.panels.length, "--c": r.g.color });
      plot.append(g);
    }
    const chart = h("div", { class: ["chart", count > COMPACT_OVER && "compact"], role: "group" }, plot);
    chart.setAttribute("aria-label", label);
    return { chart, topLabel, cols, compact: count > COMPACT_OVER };
  }

  _fillColumns(ref, rows, valueOf, { max, fmt, cls }) {
    const values = rows.flatMap((r) => r.panels.map(valueOf)).filter(Number.isFinite);
    const top = max > 0 ? max : niceMax(Math.max(...values, 0) * 1.05);
    setText(ref.topLabel, fmt(top, true));
    let i = 0;
    for (const r of rows) {
      for (const x of r.panels) {
        const c = ref.cols[i++];
        const v = valueOf(x);
        const ok = Number.isFinite(v);
        const share = ok ? Math.max(0, Math.min(1, v / top)) : 0;
        setProp(c.bar, "height", `calc((100% - 18px) * ${share.toFixed(4)})`);
        setClass(c.col, ["col", cls?.(x, v)]);
        setText(c.v, ok ? fmt(v) : DASH);
        // the column only shows a number, so name it in full
        const name = `${x.p.name}: ${ok ? fmt(v, true) : DASH}`;
        setAttr(c.col, "title", name);
        setAttr(c.col, "aria-label", name);
      }
    }
  }

  _buildPowerChart(ui, rows) {
    const label = t("panels_power_now");
    const cols = this._buildColumns(rows, label);
    const peak = h("span", { class: "r" });
    const rest = h("div", { class: "rest", text: t("panels_resting") });
    cols.chart.append(rest);
    ui.power = { ...cols, peak, rest };
    return h("div", { class: "glass block" }, h("div", { class: "label" }, h("span", { text: label }), peak), cols.chart);
  }

  _fillPowerChart(ref, rows) {
    const hass = this.hass;
    const maxW = toNumber(this.config.max_power);
    const resting = rows.every((r) => r.panels.every((x) => !(x.kw > 0.001)));
    this._fillColumns(ref, rows, (x) => x.kw, {
      max: maxW ? maxW / 1000 : resting ? 0.1 : undefined,
      fmt: (v, full) => (full ? kw(hass, v, { unit: "W" }) : num(hass, v * 1000, 0)),
      cls: (x, v) => (x.flag ? "flag" : !(v > 0.001) ? "dim" : ""),
    });
    setClass(ref.chart, ["chart", ref.compact && "compact", resting && "resting"]);
    ref.rest.hidden = !resting;
    const peak = Math.max(...rows.flatMap((r) => r.panels.map((x) => x.kw)).filter(Number.isFinite), 0);
    setText(ref.peak, peak > 0 ? `max ${kw(hass, peak, { unit: "W" })}` : "");
  }

  // ---- roof faces ----

  _buildFace({ g, panels }) {
    const facing = facingText(g.facing);
    const meta = [panels.length === 1 ? t("panels_count_one") : t("panels_count", { n: panels.length })];
    if (facing) meta.push(t("panels_facing", { dir: facing }));
    const total = h("span", { class: "ft" });
    const head = h("div", { class: "fhead" }, h("span", { class: "sf-dot" }), h("span", { class: "fn", text: g.label }), h("span", { class: "fc", text: meta.join(" · ") }), total);
    const tilesEl = h("div", { class: "tiles" });
    const tiles = [];
    for (const x of panels) {
      const p = x.p;
      const power = h("div", { class: "tp" });
      const today = p.energy || p.today ? h("div", { class: "tt" }) : null;
      const flag = h("div", { class: "tf" });
      const bar = h("i");
      const meter = h("div", { class: "meter" }, bar);
      const tile = h("div", { class: "tile" }, h("div", { class: "tn", text: p.name }), power, today, flag, meter);
      asButton(tile, () => this.moreInfo(p.power || p.energy));
      tile.dataset.k = `tile:${p.name}`;
      tiles.push({ tile, power, today, flag, meter, bar });
      tilesEl.append(tile);
    }
    const el = h("div", { class: "glass face" }, head, g.note ? h("div", { class: "fnote", text: g.note }) : null, tilesEl);
    setStyle(el, { "--c": g.color });
    return { el, total, tiles };
  }

  _fillFace(ref, { panels }) {
    const hass = this.hass;
    const nowKw = panels.reduce((a, x) => a + (x.kw > 0 ? x.kw : 0), 0);
    const todays = panels.map((x) => x.today).filter(Number.isFinite);
    const todaySum = todays.length ? todays.reduce((a, b) => a + b, 0) : undefined;
    const peak = Math.max(...panels.map((x) => x.kw).filter(Number.isFinite), 0);
    setText(ref.total, `${kw(hass, nowKw, { unit: "auto" })}${todaySum !== undefined ? ` · ${kwh(hass, todaySum, 2)}` : ""}`);
    panels.forEach((x, i) => {
      const c = ref.tiles[i];
      const on = x.kw > 0.001;
      setClass(c.tile, ["tile", on && "on", x.flag && "flag"]);
      setText(c.power, Number.isFinite(x.kw) ? kw(hass, x.kw, { unit: "W" }) : DASH);
      if (c.today) setText(c.today, `${t("panels_today")} ${Number.isFinite(x.today) ? kwh(hass, x.today, 2) : DASH}`);
      c.flag.hidden = !x.flag;
      c.meter.hidden = !!x.flag;
      if (x.flag) setText(c.flag, t(`panels_flag_${x.flag}`));
      else setProp(c.bar, "width", `${peak > 0 && on ? Math.round((x.kw / peak) * 100) : 0}%`);
    });
  }

  // ---- lifetime ----

  _buildLifetime(ui, rows) {
    const label = t("panels_lifetime_kwh");
    const cols = this._buildColumns(rows, label);
    const total = h("span", { class: "r" });
    const notes = h("div");
    ui.life = { ...cols, total, notes, notesKey: undefined };
    return h("div", { class: "glass block" }, h("div", { class: "label" }, h("span", { text: label }), total), cols.chart, notes);
  }

  _fillLifetime(ref, rows) {
    const hass = this.hass;
    const low = new Map();
    for (const r of rows) {
      const m = median(r.panels.map((x) => x.life));
      if (!(m > 0) || r.panels.length < 3) continue;
      for (const x of r.panels) if (Number.isFinite(x.life) && x.life < m * LOW_LIFETIME) low.set(x, (x.life / m) * 100);
    }
    this._fillColumns(ref, rows, (x) => x.life, {
      fmt: (v, full) => (full ? kwh(hass, v, 0) : compactKwh(hass, v)),
      cls: (x) => (low.has(x) ? "low" : "life"),
    });
    const total = rows.flatMap((r) => r.panels).reduce((a, x) => a + (Number.isFinite(x.life) ? x.life : 0), 0);
    setText(ref.total, kwh(hass, total, 0));
    const lines = [...low].map(([x, p]) => t("panels_low_lifetime", { name: x.p.name, pct: pct(hass, p) }));
    const key = lines.join("\n");
    if (key !== ref.notesKey) {
      ref.notesKey = key;
      ref.notes.replaceChildren(...lines.map((text) => h("div", { class: "lnote" }, h("span", { class: "sf-dot" }), h("span", { text }))));
    }
  }

  // ---- health and diagnostics ----

  _healthRow(key, label, onActivate) {
    const svg = icon(ICON_OK);
    const ico = h("div", { class: "hico" }, svg);
    const value = h("div", { class: "hv" });
    const row = h("div", { class: "hrow" }, ico, h("div", null, h("div", { class: "hk", text: label }), value));
    asButton(row, onActivate, label);
    row.dataset.k = key;
    return { row, ico, path: svg.firstChild, value };
  }

  _buildHealth(ui) {
    const e = this.entities;
    const box = h("div", { class: "glass block" }, h("div", { class: "label", text: t("panels_health") }));
    ui.health = {};
    if (e.panel_health) {
      ui.health.check = this._healthRow("health", t("panels_health"), () => this.moreInfo(this.entities.panel_health));
      box.append(ui.health.check.row);
    }
    if (e.solar_problem) {
      ui.health.problem = this._healthRow("problem", t("panels_problem"), () => this.moreInfo(this.entities.solar_problem));
      box.append(ui.health.problem.row);
    }
    if (this.config.show_health_note !== false) box.append(h("div", { class: "hnote", text: t("panels_health_note") }));
    return box;
  }

  _fillHealth(ref, findings) {
    const hass = this.hass;
    const e = this.entities;
    if (ref.check) {
      const ok = findings === "OK";
      setAttr(ref.check.path, "d", ok ? ICON_OK : ICON_ALERT);
      setProp(ref.check.ico, "--k", ok ? "var(--sf-export)" : "var(--sf-warn)");
      setText(ref.check.value, ok ? t("panels_all_ok") : isAvailable(stateObj(hass, e.panel_health)) ? findings : t("unavailable"));
    }
    if (ref.problem) {
      const problem = isOn(hass, e.solar_problem);
      const since = attr(hass, e.solar_problem, "problem_since");
      setAttr(ref.problem.path, "d", problem ? ICON_ALERT : ICON_BELL);
      setProp(ref.problem.ico, "--k", problem ? "var(--sf-error)" : "var(--sf-text-2)");
      setText(ref.problem.value, problem ? (since ? t("panels_problem_on", { time: time(hass, since) }) : t("panels_problem")) : t("panels_problem_off"));
    }
  }

  _buildDiagnostics(ui, diag) {
    const box = h("div", { class: "glass block" }, h("div", { class: "label", text: this.config.diagnostics_title ?? t("panels_diagnostics") }));
    ui.diag = [];
    for (const d of diag) {
      const id = typeof d === "string" ? d : d.entity;
      const name = h("span", { class: "dk" });
      const value = h("span", { class: "dv" });
      const row = h("div", { class: ["drow", typeof d === "object" && d.divider && "sep"] }, name, value);
      asButton(row, () => this.moreInfo(id));
      row.dataset.k = `diag:${id}`;
      ui.diag.push({ name, value });
      box.append(row);
    }
    return box;
  }

  _fillDiagnostics(ref, diag) {
    const hass = this.hass;
    diag.forEach((d, i) => {
      const id = typeof d === "string" ? d : d.entity;
      setText(ref[i].name, (typeof d === "object" && d.name) || attr(hass, id, "friendly_name") || id);
      setText(ref[i].value, diagValue(hass, id));
    });
  }
}

defineCard("daymill-panels-card", DayMillPanelsCard, {
  name: "DayMill panels",
  description: "Power, today's and lifetime energy for every panel, grouped by roof face, with the health check and gateway diagnostics.",
  documentationURL: "https://github.com/Derkaramma/daymill",
});

export { DayMillPanelsCard };
