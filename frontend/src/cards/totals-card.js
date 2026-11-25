// sunflow-totals-card: energy and money for today, 7 days, 30 days, this
// month and this year, from the totals sensor (recorder statistics).
//
//   type: custom:sunflow-totals-card
//   windows: [today, d7, d30, month, year]
//   tracking_start: 2026-01-01   # optional; normally found automatically
//   notes: true
//   title: "..."                  # false hides the header

import { SunFlowCard, defineCard, h } from "../common/base.js";
import { numAttr, toNumber } from "../common/entities.js";
import { DASH, date, money, num as fmtNum, pct, price, t } from "../common/format.js";
import { dayLabel, knownTrackingStart, trackingStart } from "../common/chart-helpers.js";
import { chartStyles } from "./chart/style.js";
import { table } from "./chart/table.js";

const WINDOWS = ["today", "d7", "d30", "month", "year"];
const DAY = 86_400_000;

class TotalsCard extends SunFlowCard {
  static styles = [chartStyles];
  static keys = ["totals", "import_rate", "energy_produced"];
  static cardSize = 7;

  static getStubConfig() {
    return {};
  }

  validateConfig(config) {
    if (config.windows !== undefined) {
      if (!Array.isArray(config.windows) || !config.windows.length) throw new Error("windows must be a list");
      const bad = config.windows.find((w) => !WINDOWS.includes(w));
      if (bad) throw new Error(`Unknown window: ${bad}. Use ${WINDOWS.join(", ")}`);
    }
  }

  watchedEntities() {
    const e = this.entities;
    return [e.totals, e.import_rate].filter(Boolean);
  }

  build() {
    const cfg = this.config;
    this.meta = h("span", { class: "ct-meta" });
    const head = cfg.title === false ? null : h("div", { class: "ct-head" }, h("h2", { class: "ct-title", text: cfg.title || t("totals_title") }), this.meta);
    this.body = h("div", { class: "ct-body" });
    this.shadowRoot.append(h("ha-card", null, h("div", { class: "ct" }, head, this.body)));
    this.foundStart = undefined;
    trackingStart(this.hass, cfg).then((d) => {
      this.foundStart = d;
      if (d) this._update(true);
    });
  }

  // Days each window covers, counting today, never before tracking started.
  days(win, now) {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    let start;
    if (win === "today") start = today;
    else if (win === "d7") start = new Date(today.getTime() - 6 * DAY);
    else if (win === "d30") start = new Date(today.getTime() - 29 * DAY);
    else if (win === "month") start = new Date(today.getFullYear(), today.getMonth(), 1);
    else start = new Date(today.getFullYear(), 0, 1);
    if (this.started && this.started > start) {
      start = new Date(this.started);
      start.setHours(0, 0, 0, 0);
    }
    return Math.max(0, Math.round((today - start) / DAY) + 1);
  }

  render() {
    const hass = this.hass;
    this.started = knownTrackingStart(hass, this.config) || this.foundStart;
    const e = this.entities;
    const a = hass.states[e.totals]?.attributes;
    if (!e.totals || !a) {
      this.body.replaceChildren(h("div", { class: "sf-empty", text: e.totals ? t("unavailable") : t("missing_entity", { entity: "totals" }) }));
      return;
    }
    const wins = this.config.windows || WINDOWS;
    const now = new Date();
    const daily = numAttr(hass, e.import_rate, "daily_charge");
    const v = (metric, w) => toNumber(a[`${metric}_${w}`]);
    const k1 = (x) => (x === undefined ? DASH : fmtNum(hass, x, 1));
    const m = (x, opts = {}) => (x === undefined ? DASH : { text: money(hass, x + 0), class: opts.credit && x < 0 ? "credit" : undefined });

    const head = [
      "",
      ...wins.map((w) =>
        w === "month" ? dayLabel(hass, now, { month: "short" }) : w === "year" ? String(now.getFullYear()) : t(`w_${w}`),
      ),
    ];
    const row = (label, fn, cls) => ({ cells: [label, ...wins.map(fn)], class: cls });
    const group = (label) => ({ cells: [{ text: label, span: wins.length + 1 }], class: "group" });
    const self = (w) => {
      const used = v("used", w);
      const prod = v("produced", w);
      const exp = v("exported", w);
      if (used === undefined || prod === undefined || exp === undefined) return DASH;
      if (used <= 0) return pct(hass, 0);
      return pct(hass, Math.min(100, Math.max(0, ((prod - exp) / used) * 100)));
    };
    const base = (w) => (daily === undefined ? undefined : daily * this.days(w, now));
    const sumOf = (...xs) => (xs.some((x) => x === undefined) ? undefined : xs.reduce((s, x) => s + x, 0));
    const hasAdders = wins.some((w) => v("adders", w) !== undefined);
    const adders = (w) => v("adders", w) ?? 0;

    const rows = [
      group(`${t("group_energy")} · kWh`),
      row(t("row_produced"), (w) => k1(v("produced", w))),
      row(t("row_used"), (w) => k1(v("used", w))),
      row(t("row_imported"), (w) => k1(v("imported", w))),
      row(t("row_exported"), (w) => k1(v("exported", w))),
      row(t("row_self"), self),
      group(t("group_money")),
      row(t("row_netted"), (w) => m(sumOf(v("net_cost", w), -(v("nbc", w) ?? 0), -adders(w)), { credit: true })),
      row(t("row_nbc"), (w) => m(v("nbc", w))),
      hasAdders ? row(t("row_adders"), (w) => m(adders(w))) : null,
      daily !== undefined ? row(t("row_base"), (w) => m(base(w))) : null,
      row(t("row_net"), (w) => m(sumOf(v("net_cost", w), base(w) ?? 0), { credit: true }), "strong total"),
      row(t("row_saved"), (w) => {
        const x = v("savings", w);
        return x === undefined ? DASH : { text: money(hass, x), class: "credit" };
      }),
    ];

    const parts = [table(head, rows)];
    if (this.config.notes !== false) {
      const notes = [];
      const nbc = numAttr(hass, e.import_rate, "nbc_per_kwh");
      const add = numAttr(hass, e.import_rate, "interval_adders_per_kwh");
      if (nbc !== undefined && add !== undefined) {
        notes.push(t("totals_note_rates", { nbc: price(hass, nbc, { unit: false, maxDigits: 5 }), adders: price(hass, add, { unit: false, maxDigits: 5 }) }));
      }
      if (this.started && this.started > new Date(now.getFullYear(), 0, 1)) notes.push(t("totals_note_window"));
      if (notes.length) parts.push(h("p", { class: "ct-note", text: notes.join(" ") }));
    }
    this.meta.textContent = this.started ? t("tracking_since", { date: date(hass, this.started, { month: "short", day: "numeric", year: "numeric" }) }) : "";
    this.body.replaceChildren(...parts);
  }
}

defineCard("sunflow-totals-card", TotalsCard, {
  name: "SunFlow totals",
  description: "Energy and money for today, 7 days, 30 days, this month and this year.",
});
