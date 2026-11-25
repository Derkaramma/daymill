// Chart views shared by the power chart card and the history card.
//
// HistoryView: recent history of a few entities as a TimeChart, loaded once
// over history/history_during_period and then kept current from state
// updates. StatsView: per-day or per-month columns from long-term statistics.

import { h } from "../../common/dom.js";
import { stateObj, toKw, unit } from "../../common/entities.js";
import { fetchHistory, fetchStatistics, hoursAgo, statSeries, toSeries } from "../../common/ws.js";
import { kw, money, num, kwh, price, t } from "../../common/format.js";
import { cssVar } from "../../common/theme.js";
import { dayLabel, dayTime, hourLabel } from "../../common/chart-helpers.js";
import { BarChart, TimeChart, legend, stepDigits } from "./chart.js";
import { appendLive, bucketAverage, clip, holdUntil } from "./data.js";
import { calendarDay, displayZone, midnight, serverZone } from "./zone.js";

const REFETCH_MS = 30 * 60_000;
export const color = (key) => `var(${cssVar(key)})`;

// ---- series definitions ----

// Power in kW. History is in the entity's own unit (usually W).
export function powerDefs(ids) {
  const toKwFor = (id) => (v, hass) => toKw(v, unit(hass, id) || "W");
  return [
    ids.solar_power && { id: ids.solar_power, key: "solar", label: t("solar"), color: color("solar"), type: "area", map: toKwFor(ids.solar_power), avg: true },
    // home is drawn thin on top of a wider grid line: at night, when all of
    // the home comes from the grid, the import still shows as an edge
    ids.home_power && { id: ids.home_power, key: "home", label: t("home"), color: color("home"), type: "line", map: toKwFor(ids.home_power), avg: true, z: 3, width: 1.5 },
    ids.grid_power && {
      id: ids.grid_power,
      key: "grid",
      label: t("grid"),
      legendLabel: t("grid_in_out"),
      color: color("import"),
      colorBelowZero: color("export"),
      type: "line",
      width: 4,
      map: toKwFor(ids.grid_power),
      avg: true,
    },
  ].filter(Boolean);
}

export function priceDefs(ids) {
  return [
    ids.import_rate && { id: ids.import_rate, key: "import", label: t("import_price"), color: color("price_import"), type: "step" },
    ids.export_rate && { id: ids.export_rate, key: "export", label: t("export_price"), color: color("price_export"), type: "step" },
  ].filter(Boolean);
}

// ---- history view ----

export class HistoryView {
  // opts: {kind: "power"|"price", height, legend}
  constructor(opts = {}) {
    this.opts = opts;
    this.chart = new TimeChart({ height: opts.height ?? 180 });
    this.legendHost = h("div");
    this.el = h("div", { class: "ct-section" }, this.chart.el, this.legendHost);
    this.raw = {};
    this.key = undefined;
    this.fetchedAt = 0;
    this.loading = false;
    this.failed = false;
  }

  // Call on every card render.
  update(hass, defs, { hours = 24, average = 10, showLegend = true } = {}) {
    this.hass = hass;
    this.defs = defs;
    this.hours = hours;
    this.average = average;
    this.showLegend = showLegend;
    const key = JSON.stringify([defs.map((d) => d.id), hours]);
    const now = Date.now();
    if (key !== this.key || now - this.fetchedAt > REFETCH_MS) {
      this.key = key;
      this.fetchedAt = now;
      this.load(key);
    }
    this.appendStates();
    this.draw();
  }

  async load(key) {
    const { hass, defs, hours } = this;
    if (!defs.length) return;
    this.loading = true;
    try {
      const rows = await fetchHistory(hass, { entityIds: defs.map((d) => d.id), start: hoursAgo(hours + 1) });
      if (key !== this.key) return;
      for (const d of defs) this.raw[d.id] = toSeries(rows?.[d.id], (v) => (d.map ? d.map(v, this.hass) : v)) ?? [];
      this.failed = false;
    } catch (err) {
      console.warn("SunFlow: history fetch failed", err);
      this.failed = true;
      this.fetchedAt = Date.now() - REFETCH_MS + 60_000; // retry in a minute
    } finally {
      this.loading = false;
    }
    this.appendStates();
    this.draw();
  }

  // Live readings from hass.states, so the chart moves without refetching.
  appendStates() {
    for (const d of this.defs || []) {
      const st = stateObj(this.hass, d.id);
      if (!st) continue;
      const v = Number(st.state);
      const at = Date.parse(st.last_changed || st.last_updated);
      if (!Number.isFinite(v)) continue;
      const series = (this.raw[d.id] ||= []);
      appendLive(series, at, d.map ? d.map(v, this.hass) : v);
    }
  }

  draw() {
    const hass = this.hass;
    const to = Date.now();
    const from = to - this.hours * 3_600_000;
    const power = this.opts.kind !== "price";
    const series = this.defs.map((d) => {
      const raw = clip(this.raw[d.id] || [], from);
      let data;
      if (d.avg && this.average > 0) {
        data = bucketAverage(raw, from, to, this.average, displayZone(hass));
        const last = raw[raw.length - 1];
        if (last && data.length) data.push({ t: to, v: last.v });
      } else {
        data = holdUntil(raw.map((p) => (p.t < from ? { t: from, v: p.v } : p)), to);
      }
      return {
        ...d,
        data,
        format: power ? (v) => kw(hass, v) : (v) => price(hass, v, { maxDigits: 5 }),
      };
    });
    const ready = series.some((sr) => sr.data.length);
    this.chart.update({
      series,
      from,
      to,
      label: series.map((sr) => sr.label).join(", "),
      empty: this.loading ? t("loading") : t("no_data"),
      // the top tick carries the unit, so the axis reads without a title
      yFormat: power ? (v, step, top) => `${num(hass, v, stepDigits(step))}${top ? " kW" : ""}` : (v, step) => money(hass, v, { digits: Math.max(2, stepDigits(step)) }),
      xFormat: (d) => hourLabel(hass, d),
      tipTime: (d) => (d.getTime() >= to - 60_000 ? `${dayTime(hass, d)} · ${t("now_label")}` : dayTime(hass, d)),
    });
    if (!this.showLegend || !ready) {
      this.legendHost.replaceChildren();
      return;
    }
    this.legendHost.replaceChildren(
      legend(
        series.map((sr) => {
          const last = sr.data[sr.data.length - 1];
          return { label: sr.legendLabel || sr.label, color: sr.colorBelowZero && last?.v < 0 ? sr.colorBelowZero : sr.color, type: sr.type, value: last ? sr.format(last.v) : undefined };
        }),
      ),
    );
  }
}

// ---- statistics view ----

// defs: [{id, key, label, color, kind: "energy"|"money"}]
export class StatsView {
  constructor(opts = {}) {
    this.opts = opts;
    this.chart = new BarChart({ height: opts.height ?? 180 });
    this.legendHost = h("div");
    this.el = h("div", { class: "ct-section" }, this.chart.el, this.legendHost);
    this.key = undefined;
    this.result = undefined;
    this.loading = false;
  }

  // period: "day" | "month"; count: number of days or months, newest last.
  update(hass, defs, { period = "day", count = 7, showLegend = true } = {}) {
    this.hass = hass;
    this.defs = defs;
    this.period = period;
    this.count = count;
    this.showLegend = showLegend;
    this.zone = serverZone(hass);
    const start = this.startFor(period, count);
    const key = JSON.stringify([defs.map((d) => d.id), period, count, start.getTime()]);
    if (key !== this.key) {
      this.key = key;
      this.result = undefined;
      this.load(key, start);
    }
    this.draw();
  }

  // First day (or month) shown, as a calendar day in the server's zone.
  firstDay(period, count) {
    const d = calendarDay(Date.now(), this.zone);
    if (period === "month") {
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() - (count - 1));
    } else {
      d.setUTCDate(d.getUTCDate() - (count - 1));
    }
    return d;
  }

  // Server midnight of the first day: where the statistics rows start.
  startFor(period, count) {
    const d = this.firstDay(period, count);
    return new Date(midnight(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), this.zone));
  }

  async load(key, start) {
    if (!this.defs.length) return;
    this.loading = true;
    try {
      const res = await fetchStatistics(this.hass, { statisticIds: this.defs.map((d) => d.id), start, period: this.period, types: ["change"] });
      if (key !== this.key) return;
      this.result = res || {};
      this.start = start;
    } catch (err) {
      console.warn("SunFlow: statistics fetch failed", err);
      if (key === this.key) this.key = undefined; // retry on the next render
    } finally {
      this.loading = false;
    }
    this.draw();
  }

  draw() {
    const hass = this.hass;
    const month = this.period === "month";
    const tz = this.zone;
    const first = this.start ? calendarDay(this.start.getTime(), tz) : this.firstDay(this.period, this.count);
    const cats = [];
    const keys = [];
    // calendar days are UTC noon dates, so label them in UTC
    const label = (d, opts) => dayLabel(hass, d, { ...opts, timeZone: "UTC" });
    const keyOfDay = (d) => (month ? `${d.getUTCFullYear()}-${d.getUTCMonth()}` : `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`);
    for (let i = 0; i < this.count; i++) {
      const d = new Date(first);
      if (month) d.setUTCMonth(d.getUTCMonth() + i);
      else d.setUTCDate(d.getUTCDate() + i);
      keys.push(keyOfDay(d));
      cats.push(
        month
          ? { label: label(d, { month: "short" }), tip: label(d, { month: "long", year: "numeric" }) }
          : { label: label(d, this.count > 10 ? { day: "numeric" } : { weekday: "short" }), tip: label(d, { weekday: "short", month: "short", day: "numeric" }) },
      );
    }
    const keyOf = (ms) => keyOfDay(calendarDay(ms, tz));
    const index = new Map(keys.map((k, i) => [k, i]));
    const series = this.defs.map((d) => {
      const values = new Array(this.count).fill(undefined);
      if (this.result) {
        for (const p of statSeries(this.result[d.id])) {
          const i = index.get(keyOf(p.t));
          if (i !== undefined) values[i] = (values[i] || 0) + p.v;
        }
      }
      const fmt = d.kind === "money" ? (v) => money(hass, v) : (v) => kwh(hass, v, 1);
      return { ...d, values, format: (v) => (Number.isFinite(v) ? fmt(v) : "–") };
    });
    const isMoney = this.defs.every((d) => d.kind === "money");
    this.chart.update({
      categories: cats,
      series: this.result ? series : [],
      label: series.map((sr) => sr.label).join(", "),
      empty: this.loading || !this.result ? t("loading") : t("no_data"),
      // whole units, or cents when the step is not a whole number
      yFormat: isMoney ? (v, step) => money(hass, v, { digits: Math.abs(step - Math.round(step)) < 1e-9 ? 0 : 2 }) : (v, step) => num(hass, v, stepDigits(step)),
    });
    const ready = this.result && series.some((sr) => sr.values.some((v) => Number.isFinite(v)));
    if (!this.showLegend || !ready) {
      this.legendHost.replaceChildren();
      return;
    }
    // legend shows the total over the shown range
    this.legendHost.replaceChildren(
      legend(
        series.map((sr) => ({
          label: sr.label,
          color: sr.color,
          type: "bar",
          value: sr.format(sr.values.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0)),
        })),
      ),
    );
  }
}
