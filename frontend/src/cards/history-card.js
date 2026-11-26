// daymill-history-card: history charts with a chart picker.
//
//   type: custom:daymill-history-card
//   chart: money_per_day      # one chart, no picker
//   charts: [power_24h, price_24h, money_per_day, energy_per_day, energy_per_month]
//   days: 7                   # per-day charts: 7 or 30 (any 2-60 works)
//   day_options: [7, 30]      # 7 d / 30 d toggle; [] hides it
//   hours: 24                 # power and price charts
//   height: 200
//   legend: true
//   title: "..."              # false hides the header

import { DayMillCard, asButton, defineCard, h } from "../common/base.js";
import { t } from "../common/format.js";
import { chartStyles } from "./chart/style.js";
import { HistoryView, StatsView, color, powerDefs, priceDefs } from "./chart/history.js";

const KINDS = ["power_24h", "price_24h", "money_per_day", "energy_per_day", "energy_per_month"];
const PER_DAY = new Set(["money_per_day", "energy_per_day"]);
const LIVE = { power_24h: ["solar_power", "home_power", "grid_power"], price_24h: ["import_rate", "export_rate"] };

const css = `
.bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: space-between; }
`;

class HistoryCard extends DayMillCard {
  static styles = [chartStyles, css];
  static keys = [
    "solar_power",
    "home_power",
    "grid_power",
    "import_rate",
    "export_rate",
    "net_cost",
    "solar_savings",
    "energy_produced",
    "energy_consumed",
    "energy_imported",
    "energy_exported",
  ];
  static cardSize = 5;

  static getStubConfig() {
    return { charts: KINDS };
  }

  validateConfig(config) {
    const list = config.chart ? [config.chart] : config.charts || KINDS;
    if (!Array.isArray(list) || !list.length) throw new Error("charts must be a list");
    const bad = list.find((k) => !KINDS.includes(k));
    if (bad) throw new Error(`Unknown chart: ${bad}. Use ${KINDS.join(", ")}`);
    const days = Number(config.days ?? 7);
    if (!(days >= 2 && days <= 60)) throw new Error("days must be between 2 and 60");
  }

  get kinds() {
    return this.config.chart ? [this.config.chart] : this.config.charts || KINDS;
  }

  // Only the active chart's live entities trigger a re-render.
  watchedEntities() {
    const e = this.entities;
    return (LIVE[this.kind] || []).map((k) => e[k]).filter(Boolean);
  }

  build() {
    const cfg = this.config;
    this.kind = this.kind && this.kinds.includes(this.kind) ? this.kind : this.kinds[0];
    this.days = Number(cfg.days ?? 7);
    this.views = {};
    this.heading = h("h2", { class: "ct-title" });
    this.tabs = h("div", { class: "ct-tabs", role: "group" });
    this.dayTabs = h("div", { class: "ct-tabs", role: "group" });
    this.host = h("div");
    const head = cfg.title === false ? null : h("div", { class: "ct-head" }, this.heading);
    const bar = h("div", { class: "bar" }, this.kinds.length > 1 ? this.tabs : null, this.dayTabs);
    this.shadowRoot.append(h("ha-card", null, h("div", { class: "ct" }, head, bar, this.host)));
  }

  view(kind) {
    if (!this.views[kind]) {
      const height = Number(this.config.height) || 200;
      this.views[kind] = kind in LIVE ? new HistoryView({ kind: kind === "price_24h" ? "price" : "power", height }) : new StatsView({ height });
    }
    return this.views[kind];
  }

  pick(kind) {
    if (kind === this.kind) return;
    this.kind = kind;
    const v = this.views[kind];
    if (v instanceof HistoryView) v.fetchedAt = 0; // fill the gap while it was hidden
    this._update(true);
  }

  pickDays(days) {
    if (days === this.days) return;
    this.days = days;
    this._update(true);
  }

  pills(host, items, active, onPick) {
    host.replaceChildren(
      ...items.map(([value, label]) => {
        const b = h("span", { class: "ct-tab", text: label, "aria-pressed": String(value === active), "data-k": `tab:${value}` });
        return asButton(b, () => onPick(value));
      }),
    );
  }

  render() {
    const hass = this.hass;
    const cfg = this.config;
    const e = this.entities;
    const kind = this.kind;
    const hours = Number(cfg.hours ?? 24);
    const months = 12;
    this.heading.textContent = cfg.title || t(`title_${kind}`, { hours, days: this.days, months });
    this.pills(this.tabs, this.kinds.map((k) => [k, t(`chart_${k}`)]), kind, (k) => this.pick(k));
    const dayOptions = cfg.day_options ?? [7, 30];
    if (PER_DAY.has(kind) && dayOptions.length > 1) this.pills(this.dayTabs, dayOptions.map((d) => [Number(d), t("days_n", { n: d })]), this.days, (d) => this.pickDays(d));
    else this.dayTabs.replaceChildren();

    const v = this.view(kind);
    if (this.host.firstChild !== v.el) this.host.replaceChildren(v.el);
    const showLegend = cfg.legend !== false;
    if (kind === "power_24h") v.update(hass, powerDefs(e), { hours, average: Number(cfg.average ?? 10), showLegend });
    else if (kind === "price_24h") v.update(hass, priceDefs(e), { hours, showLegend });
    else if (kind === "money_per_day") v.update(hass, this.moneyDefs(), { period: "day", count: this.days, showLegend });
    else if (kind === "energy_per_day") v.update(hass, this.energyDefs(), { period: "day", count: this.days, showLegend });
    else v.update(hass, this.energyDefs(), { period: "month", count: months, showLegend });
  }

  moneyDefs() {
    const e = this.entities;
    return [
      e.net_cost && { id: e.net_cost, key: "net_cost", label: t("net_cost_no_base"), color: color("import"), kind: "money" },
      e.solar_savings && { id: e.solar_savings, key: "savings", label: t("saved"), color: color("export"), kind: "money" },
    ].filter(Boolean);
  }

  energyDefs() {
    const e = this.entities;
    return [
      e.energy_produced && { id: e.energy_produced, key: "produced", label: t("produced"), color: color("solar"), kind: "energy" },
      e.energy_consumed && { id: e.energy_consumed, key: "used", label: t("used"), color: color("home"), kind: "energy" },
      e.energy_imported && { id: e.energy_imported, key: "imported", label: t("imported"), color: color("import"), kind: "energy" },
      e.energy_exported && { id: e.energy_exported, key: "exported", label: t("exported"), color: color("export"), kind: "energy" },
    ].filter(Boolean);
  }
}

defineCard("daymill-history-card", HistoryCard, {
  name: "DayMill history",
  description: "Power and price over 24 hours, money and energy per day, energy per month.",
});
