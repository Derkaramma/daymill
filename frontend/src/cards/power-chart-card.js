// daymill-power-chart-card: solar, home and grid power over the last hours.
//
//   type: custom:daymill-power-chart-card
//   hours: 24            # window
//   average: 10          # minutes per averaged point, 0 for raw
//   height: 180
//   legend: true
//   title: "..."         # false hides the header

import { DayMillCard, defineCard, h } from "../common/base.js";
import { t } from "../common/format.js";
import { chartStyles } from "./chart/style.js";
import { HistoryView, powerDefs } from "./chart/history.js";

class PowerChartCard extends DayMillCard {
  static styles = [chartStyles];
  static keys = ["solar_power", "home_power", "grid_power"];
  static cardSize = 4;
  static grid = { columns: 12, min_columns: 6, rows: "auto" };

  static getStubConfig() {
    return { hours: 24 };
  }

  validateConfig(config) {
    const hours = Number(config.hours ?? 24);
    if (!(hours > 0 && hours <= 168)) throw new Error("hours must be between 1 and 168");
  }

  get hours() {
    return Number(this.config.hours ?? 24);
  }

  build() {
    const cfg = this.config;
    this.view = new HistoryView({ kind: "power", height: Number(cfg.height) || 180 });
    const head = cfg.title === false ? null : h("div", { class: "ct-head" }, h("h2", { class: "ct-title", text: cfg.title || t("power_24h_title", { hours: this.hours }) }));
    this.shadowRoot.append(h("ha-card", null, h("div", { class: "ct" }, head, this.view.el)));
  }

  render() {
    const cfg = this.config;
    this.view.update(this.hass, powerDefs(this.entities), {
      hours: this.hours,
      average: Number(cfg.average ?? 10),
      showLegend: cfg.legend !== false,
    });
  }
}

defineCard("daymill-power-chart-card", PowerChartCard, {
  name: "DayMill power chart",
  description: "Solar, home and grid power over the last 24 hours.",
});
