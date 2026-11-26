// daymill-today-card: today's energy and money as 2x2 tiles.
//
//   type: custom:daymill-today-card
//   show: both            energy, money or both
//   headers: true         false hides the section headers
//   entities: {...}       optional overrides by translation key
//
// Energy: produced, used, imported, exported (from the totals sensor).
// Money: net cost including the daily charge, saved by solar, home use from
// solar, and non-bypassable charges plus adders.

import { DayMillCard, defineCard, h } from "../common/base.js";
import { attr, num, numAttr, toNumber } from "../common/entities.js";
import { money, num as fmtNum, pct } from "../common/format.js";
import { cssVar } from "../common/theme.js";
import { setValue, t, tapTarget, tile, tileStyles } from "../common/tiles.js";

const SHOW = ["both", "energy", "money"];

const css = `
.sec + .sec { margin-top: 16px; }
.credit .v { color: var(--sf-dot-credit); }
`;

const v = (key) => `var(${cssVar(key)})`;

class TodayCard extends DayMillCard {
  static styles = [tileStyles, css];
  static keys = [
    "totals",
    "cost_today",
    "self_sufficiency_today",
    "import_rate",
    "energy_produced",
    "energy_consumed",
    "energy_imported",
    "energy_exported",
    "solar_savings",
    "nbc_charges",
  ];
  static cardSize = 4;
  static grid = { columns: 12, min_columns: 6, rows: "auto" };

  static getStubConfig() {
    return { show: "both" };
  }

  validateConfig(config) {
    if (config.show !== undefined && !SHOW.includes(config.show)) throw new Error(`show must be one of: ${SHOW.join(", ")}`);
  }

  // The lifetime energy sensors are only tap targets.
  watchedEntities() {
    const e = this.entities;
    return [e.totals, e.cost_today, e.self_sufficiency_today, e.import_rate, e.solar_savings].filter(Boolean);
  }

  build() {
    const cfg = this.config;
    const show = cfg.show || "both";
    const e = () => this.entities;
    const section = (title, tiles) =>
      h(
        "div",
        { class: "sec" },
        cfg.headers === false ? null : h("div", { class: "sf-head" }, h("span", { text: title })),
        h("div", { class: "sf-tiles" }, tiles.map((x) => x.el)),
      );
    const tap = (x, key, label) => tapTarget(this, x.el, () => ({ entity: e()[key] || e().totals }), label);

    const parts = [];
    if (show !== "money") {
      this.produced = tile(t("produced"), v("solar"));
      this.used = tile(t("used"), v("home"));
      this.imported = tile(t("imported"), v("import"));
      this.exported = tile(t("exported"), v("export"));
      tap(this.produced, "energy_produced", t("produced"));
      tap(this.used, "energy_consumed", t("used"));
      tap(this.imported, "energy_imported", t("imported"));
      tap(this.exported, "energy_exported", t("exported"));
      parts.push(section(t("today_energy"), [this.produced, this.used, this.imported, this.exported]));
    } else {
      this.produced = undefined;
    }
    if (show !== "energy") {
      this.net = tile(t("net_cost_base"), v("dot_today"));
      this.saved = tile(t("saved"), v("dot_credit"));
      this.selfUse = tile(t("home_from_solar"), v("solar"));
      this.nbc = tile(t("nbc_adders"), v("ring_grid"));
      tap(this.net, "cost_today", t("net_cost_base"));
      tap(this.saved, "solar_savings", t("saved"));
      tap(this.selfUse, "self_sufficiency_today", t("home_from_solar"));
      tap(this.nbc, "nbc_charges", t("nbc_adders"));
      parts.push(section(t("today_money"), [this.net, this.saved, this.selfUse, this.nbc]));
    } else {
      this.net = undefined;
    }
    this.shadowRoot.append(h("ha-card", { class: "sf-pad" }, parts));
  }

  render() {
    const hass = this.hass;
    const e = this.entities;
    const total = (k) => numAttr(hass, e.totals, `${k}_today`);
    const today = (k) => numAttr(hass, e.cost_today, k);
    const energy = (x, value) => {
      const n = typeof value === "number" && Number.isFinite(value);
      setValue(x.value, n ? fmtNum(hass, value, value < 100 ? 1 : 0) : "–", n ? "kWh" : "");
    };

    const prod = total("produced");
    const exp = total("exported");

    if (this.produced) {
      energy(this.produced, prod);
      energy(this.used, total("used"));
      energy(this.imported, total("imported"));
      energy(this.exported, exp);
    }

    if (this.net) {
      // Net cost with the day's fixed charge, as a bill would count it.
      const daily = toNumber(attr(hass, e.import_rate, "daily_charge"));
      let net = num(hass, e.cost_today);
      if (net === undefined) {
        const base = total("net_cost");
        if (base !== undefined) net = base + (daily ?? 0);
      }
      const credit = net !== undefined && net < 0;
      this.net.value.textContent = net === undefined ? "–" : credit ? t("credit", { amount: money(hass, net, { abs: true }) }) : money(hass, net);
      this.net.el.classList.toggle("credit", credit);
      this.net.dot.style.setProperty("--c", credit ? v("dot_credit") : v("dot_today"));
      this.net.sub.textContent = daily ? t("incl_daily", { amount: money(hass, daily) }) : "";

      const saved = total("savings") ?? today("savings");
      this.saved.value.textContent = money(hass, saved);
      const lifetime = num(hass, e.solar_savings);
      this.saved.sub.textContent = lifetime !== undefined ? t("lifetime", { amount: money(hass, lifetime, { digits: 0 }) }) : "";

      const share = num(hass, e.self_sufficiency_today);
      this.selfUse.value.textContent = pct(hass, share);
      const used = total("used");
      const solarUsed = prod !== undefined && exp !== undefined ? Math.max(0, Math.min(used ?? Infinity, prod - exp)) : undefined;
      this.selfUse.sub.textContent =
        solarUsed !== undefined && Number.isFinite(solarUsed) ? t("solar_used_kwh", { energy: `${fmtNum(hass, solarUsed, 1)} kWh` }) : "";

      const nbc = total("nbc") ?? today("nbc");
      const adders = total("adders") ?? today("adders");
      const sum = nbc === undefined && adders === undefined ? undefined : (nbc ?? 0) + (adders ?? 0);
      this.nbc.value.textContent = money(hass, sum);
      this.nbc.sub.textContent =
        nbc !== undefined && adders !== undefined ? t("nbc_split", { nbc: money(hass, nbc), adders: money(hass, adders) }) : "";
    }
  }
}

defineCard("daymill-today-card", TodayCard, {
  name: "DayMill today",
  description: "Today's energy (produced, used, imported, exported) and money (net cost, savings, solar share, fixed charges) as tiles.",
});
