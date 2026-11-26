// daymill-share-ring-card: how much of the home's energy came from solar.
//
//   type: custom:daymill-share-ring-card
//   periods: [today, d7, d30]     tabs; month and year also work. First is the default.
//   entities: {totals: sensor.x}  optional override (totals_entity also works)
//
// Reads produced_<p>, exported_<p> and used_<p> from the totals sensor:
//   solar used = clamp(produced - exported, 0, used)
//   share      = solar used / used
//   grid used  = used - solar used

import { DayMillCard, defineCard, h, s } from "../common/base.js";
import { attr, toNumber } from "../common/entities.js";
import { kwh, pct } from "../common/format.js";
import { cssVar } from "../common/theme.js";
import { t, tileStyles } from "../common/tiles.js";

const PERIODS = ["today", "d7", "d30", "month", "year"];
const R = 52;
const C = 2 * Math.PI * R;
const GAP = 6;

const css = `
ha-card { padding: 14px 16px 16px; }
.tabs {
  display: flex;
  gap: 4px;
  justify-content: center;
  margin: 0 auto 12px;
  padding: 3px;
  width: max-content;
  max-width: 100%;
  box-sizing: border-box;
  border-radius: 999px;
  background: color-mix(in srgb, var(--sf-text) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--sf-text) 8%, transparent);
}
.tab {
  font: inherit;
  font-size: 0.82em;
  padding: 4px 12px;
  border-radius: 999px;
  cursor: pointer;
  color: var(--sf-text-2);
  background: transparent;
  border: 1px solid transparent;
  white-space: nowrap;
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
}
.tab:hover { color: var(--sf-text); }
.tab.on {
  color: var(--sf-text);
  background: color-mix(in srgb, var(--sf-ring-solar) 18%, transparent);
  border-color: color-mix(in srgb, var(--sf-ring-solar) 75%, transparent);
}
.tab:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: 1px; }
.wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px 22px;
  flex-wrap: wrap;
}
.tap { cursor: pointer; }
.ring { width: 150px; height: 150px; flex: none; }
.ring svg { width: 100%; height: 100%; display: block; overflow: visible; }
.track { fill: none; stroke: color-mix(in srgb, var(--sf-text) 9%, transparent); stroke-width: 14; }
.grid { fill: none; stroke: var(--sf-ring-grid); stroke-width: 14; }
.sun {
  fill: none;
  stroke: var(--sf-ring-solar);
  stroke-width: 14;
  stroke-linecap: round;
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--sf-ring-solar) 55%, transparent));
}
.grid, .sun { transition: stroke-dasharray 0.8s ease, stroke-dashoffset 0.8s ease, opacity 0.3s ease; }
@media (prefers-reduced-motion: reduce) {
  .grid, .sun, .tab { transition: none; }
}
.pct { font-size: 27px; font-weight: 700; fill: var(--sf-text); font-variant-numeric: tabular-nums; }
.cap { font-size: 10px; fill: var(--sf-text-2); letter-spacing: 0.08em; text-transform: uppercase; }
.legend {
  display: grid;
  grid-template-columns: auto auto;
  gap: 7px 16px;
  align-items: center;
  font-size: 0.92em;
  color: var(--sf-text);
  padding: 12px 14px;
}
.legend .k { display: flex; align-items: center; gap: 8px; color: var(--sf-text-2); }
.legend .v { font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }
.legend .sep { grid-column: 1 / -1; height: 1px; background: color-mix(in srgb, var(--sf-text) 10%, transparent); }
.legend .total.k { padding-left: 18px; }
.note { text-align: center; font-size: 0.8em; color: var(--sf-text-2); margin-top: 10px; }
.note:empty { display: none; }
`;

class ShareRingCard extends DayMillCard {
  static styles = [tileStyles, css];
  static keys = ["totals"];
  static cardSize = 4;
  static grid = { columns: 12, min_columns: 6, rows: "auto" };

  setConfig(config) {
    const c = { ...(config || {}) };
    // Option name from the older standalone card.
    if (typeof c.totals_entity === "string" && !c.entities?.totals) {
      c.entities = { ...(c.entities || {}), totals: c.totals_entity };
    }
    this._period = undefined;
    super.setConfig(c);
  }

  validateConfig(config) {
    if (config.periods !== undefined) {
      if (!Array.isArray(config.periods) || !config.periods.length) throw new Error("periods must be a non-empty list");
      const bad = config.periods.find((p) => !PERIODS.includes(p));
      if (bad) throw new Error(`Unknown period "${bad}". Use: ${PERIODS.join(", ")}`);
    }
  }

  get periods() {
    return this.config?.periods?.length ? this.config.periods : ["today", "d7", "d30"];
  }

  static getStubConfig() {
    return { periods: ["today", "d7", "d30"] };
  }

  build() {
    const periods = this.periods;
    if (!periods.includes(this._period)) this._period = periods[0];
    this.tabs = [];
    let tabBar = null;
    if (periods.length > 1) {
      tabBar = h("div", { class: "tabs", role: "tablist" });
      for (const p of periods) {
        const b = h("button", { class: "tab", type: "button", role: "tab", text: t(p) });
        b.dataset.p = p;
        b.addEventListener("click", () => {
          this._period = p;
          this.render();
        });
        this.tabs.push(b);
        tabBar.append(b);
      }
    }

    const c = 70;
    this.sun = s("circle", { class: "sun", cx: c, cy: c, r: R });
    this.gridArc = s("circle", { class: "grid", cx: c, cy: c, r: R });
    this.pctText = s("text", { class: "pct", x: c, y: 72, "text-anchor": "middle", "dominant-baseline": "middle" });
    this.svg = s(
      "svg",
      { viewBox: "0 0 140 140", role: "img" },
      s("g", { transform: `rotate(-90 ${c} ${c})` }, s("circle", { class: "track", cx: c, cy: c, r: R }), this.gridArc, this.sun),
      this.pctText,
      s("text", { class: "cap", x: c, y: 96, "text-anchor": "middle", text: t("from_solar_caps") }),
    );
    const ring = h("div", { class: "ring" }, this.svg);

    this.vSolar = h("span", { class: "v" });
    this.vGrid = h("span", { class: "v" });
    this.vUsed = h("span", { class: "v total" });
    const dot = (key) => h("span", { class: "sf-dot", style: { background: `var(${cssVar(key)})` } });
    const legend = h(
      "div",
      { class: "legend sf-glass" },
      h("span", { class: "k" }, dot("ring_solar"), t("solar")),
      this.vSolar,
      h("span", { class: "k" }, dot("ring_grid"), t("grid")),
      this.vGrid,
      h("span", { class: "sep" }),
      h("span", { class: "k total", text: t("home_used") }),
      this.vUsed,
    );
    // Ring and legend open the totals entity; tabs stay plain buttons.
    for (const el of [ring, legend]) {
      el.addEventListener("click", () => this.moreInfo(this.entities.totals));
      el.classList.add("tap");
    }
    this.note = h("div", { class: "note" });
    this.shadowRoot.append(h("ha-card", null, tabBar, h("div", { class: "wrap" }, ring, legend), this.note));
  }

  render() {
    const p = this._period;
    const id = this.entities.totals;
    const read = (k) => toNumber(attr(this.hass, id, `${k}_${p}`));
    const prod = read("produced");
    const exp = read("exported");
    const used = read("used");

    for (const b of this.tabs) {
      const on = b.dataset.p === p;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
    }

    const ok = used !== undefined && used > 0.01 && prod !== undefined && exp !== undefined;
    const solarUsed = ok ? Math.max(0, Math.min(used, prod - exp)) : 0;
    const share = ok ? solarUsed / used : 0;
    const gridUsed = ok ? Math.max(0, used - solarUsed) : 0;

    // Small gap between the two slices when both show.
    const gap = share > 0 && share < 1 ? GAP : 0;
    const sunLen = share * C;
    this.sun.style.strokeDasharray = `${Math.max(0, sunLen - gap)} ${C}`;
    this.sun.style.opacity = share > 0 ? "1" : "0";
    this.gridArc.style.strokeDasharray = `${Math.max(0, C - sunLen - gap)} ${C}`;
    this.gridArc.style.strokeDashoffset = `${-(sunLen + gap / 2)}`;
    this.gridArc.style.opacity = ok && share < 1 ? "1" : "0";

    const hass = this.hass;
    const e = (v) => kwh(hass, v, v < 10 ? 2 : 1);
    const whole = Math.round(share * 100);
    this.pctText.textContent = ok ? pct(hass, whole) : "–";
    this.svg.setAttribute("aria-label", ok ? t("pct_from_solar", { pct: whole }) : t("no_usage"));
    this.vSolar.textContent = ok ? e(solarUsed) : "–";
    this.vGrid.textContent = ok ? e(gridUsed) : "–";
    this.vUsed.textContent = used !== undefined ? e(Math.max(0, used)) : "–";
    this.note.textContent = !ok ? t("no_usage") : exp > 0.05 ? t("extra_solar", { energy: e(exp) }) : "";
  }
}

defineCard("daymill-share-ring-card", ShareRingCard, {
  name: "DayMill solar share",
  description: "Ring showing how much of the home's energy came from solar, for today, 7 days or 30 days.",
});
