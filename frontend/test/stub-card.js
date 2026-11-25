// A throwaway card for checking the harness and the shared helpers.
// Not part of the bundle.

import { SunFlowCard, defineCard, h, asButton } from "../src/common/base.js";
import { powerKw, num, attr } from "../src/common/entities.js";
import { kw, money, price, pct, t, periodLabel } from "../src/common/format.js";
import { donut } from "../src/common/svg.js";
import { periodColor, cssVar } from "../src/common/theme.js";

const css = `
.body { display: flex; gap: 16px; align-items: center; }
.ring { width: 96px; height: 96px; flex: none; }
.ring svg { width: 100%; height: 100%; }
.rows { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; }
.k { color: var(--sf-text-2); }
`;

class SunFlowTestCard extends SunFlowCard {
  static styles = [css];
  static keys = ["solar_power", "home_power", "grid_power", "import_rate", "tou_period", "cost_today", "self_sufficiency", "data_age"];
  static cardSize = 3;

  build() {
    this.ring = h("div", { class: "ring" });
    this.rows = h("div", { class: "rows sf-num" });
    this.dot = h("span", { class: "sf-dot" });
    this.head = h("div", { class: "sf-title sf-row" }, this.dot, h("span", { text: "SunFlow" }));
    this.pill = h("span", { class: "sf-pill warn" });
    asButton(this.head, () => this.moreInfo(this.entities.solar_power), "Solar");
    this.shadowRoot.append(h("ha-card", { class: "sf-pad" }, this.head, h("div", { class: "body" }, this.ring, this.rows), this.pill));
  }

  render() {
    const e = this.entities;
    const hass = this.hass;
    const share = num(hass, e.self_sufficiency) ?? 0;
    this.ring.replaceChildren(
      donut({
        size: 96,
        width: 12,
        segments: [
          { value: share, color: `var(${cssVar("ring_solar")})` },
          { value: 100 - share, color: `var(${cssVar("ring_grid")})` },
        ],
      }),
    );
    const period = attr(hass, e.tou_period, "label") || periodLabel(hass.states[e.tou_period]?.state);
    this.dot.style.background = periodColor(hass.states[e.tou_period]?.state);
    const row = (k, v) => [h("span", { class: "k", text: k }), h("span", { text: v })];
    this.rows.replaceChildren(
      ...row(t("solar"), kw(hass, powerKw(hass, e.solar_power))),
      ...row(t("home"), kw(hass, powerKw(hass, e.home_power))),
      ...row(t("grid"), kw(hass, powerKw(hass, e.grid_power))),
      ...row(t("rate"), `${price(hass, num(hass, e.import_rate))} · ${period}`),
      ...row(t("cost_today"), money(hass, num(hass, e.cost_today))),
      ...row(t("from_solar"), pct(hass, share)),
    );
    const stale = this.isStale();
    this.pill.hidden = !stale;
    this.pill.textContent = stale ? t("data_old", { minutes: Math.round(this.dataAge() / 60) }) : "";
  }
}

defineCard("sunflow-test-card", SunFlowTestCard, { name: "SunFlow test card" });
