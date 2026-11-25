// sunflow-now-card: the "right now" summary.
//
//   type: custom:sunflow-now-card
//   title: Right now          optional; false hides the header
//   rates_path: /my-dash/rates      tap targets; without a path a tap opens
//   problem_path: /my-dash/panels   the entity's more-info dialog
//   panels_path: /my-dash/panels
//   bill_path: /my-dash/totals
//   panel_count: 12           optional, for "12 panels OK"
//   show_bill: true           set false to hide the bill line
//   entities: {...}           optional overrides by translation key
//
// Shows the current price and TOU period with the next change, an alert
// while the solar problem sensor is on, chips for panel health, % solar now
// and the data source, and the bill so far for this cycle.

import { SunFlowCard, defineCard, h } from "../common/base.js";
import { attr, isOn, num, state, toNumber } from "../common/entities.js";
import { date, money, periodLabel, price, seasonLabel, time } from "../common/format.js";
import { periodColor } from "../common/theme.js";
import { duration, icon, t, tapTarget, tileStyles } from "../common/tiles.js";

const css = `
.body { display: flex; flex-direction: column; gap: 10px; }
.ic { width: 18px; height: 18px; flex: none; }
.chev { width: 16px; height: 16px; flex: none; color: var(--sf-text-2); opacity: 0.7; }

.price { padding: 12px 14px 12px; display: flex; flex-direction: column; gap: 8px; }
.price .top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.price .amt {
  font-size: 2em;
  font-weight: 700;
  line-height: 1;
  color: var(--sf-text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.price .amt small { font-size: 0.42em; font-weight: 500; color: var(--sf-text-2); margin-left: 3px; }
.period {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 0.82em;
  font-weight: 600;
  color: var(--sf-text);
  white-space: nowrap;
  background: color-mix(in srgb, var(--c) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--c) 55%, transparent);
}
.line {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 0.85em;
  color: var(--sf-text-2);
  min-width: 0;
}
.line .ic { width: 15px; height: 15px; }
.line span { min-width: 0; }
.line b { font-weight: 600; color: var(--sf-text); }
.nextdot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--c); }
.tags { display: flex; gap: 6px; flex-wrap: wrap; }
.tag {
  font-size: 0.72em;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--sf-text-2);
}
.tag + .tag::before { content: "·"; margin-right: 6px; }

.alert {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  color: var(--sf-error);
  background: color-mix(in srgb, var(--sf-error) 14%, transparent);
  border-color: color-mix(in srgb, var(--sf-error) 55%, transparent);
}
.alert .txt { flex: 1; min-width: 0; }
.alert .h { font-weight: 600; font-size: 0.92em; }
.alert .f {
  font-size: 0.8em;
  color: var(--sf-text);
  opacity: 0.85;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px 5px 9px;
  border-radius: 999px;
  font-size: 0.82em;
  color: var(--sf-text);
  white-space: nowrap;
}
.chip .ic { width: 15px; height: 15px; color: var(--c, var(--sf-text-2)); }
.chip.warn { color: var(--sf-warn-text); border-color: color-mix(in srgb, var(--sf-warn) 55%, transparent); }
.chip.warn .ic { color: var(--sf-warn); }

.bill { display: flex; align-items: center; gap: 10px; padding: 10px 12px; }
.bill > .ic { color: var(--sf-dot-today); }
.bill .txt { flex: 1; min-width: 0; }
.bill .h { font-size: 0.92em; color: var(--sf-text); }
.bill .sub { font-size: 0.78em; color: var(--sf-text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bill .amt { font-size: 1.25em; font-weight: 650; font-variant-numeric: tabular-nums; color: var(--sf-text); white-space: nowrap; }
`;

class NowCard extends SunFlowCard {
  static styles = [tileStyles, css];
  static keys = [
    "import_rate",
    "export_rate",
    "tou_period",
    "solar_problem",
    "panel_health",
    "self_sufficiency",
    "solar_power",
    "grid_power",
    "bill_estimate",
    "data_age",
  ];
  static cardSize = 4;
  static grid = { columns: 12, min_columns: 6, rows: "auto" };

  static getStubConfig() {
    return {};
  }

  validateConfig(config) {
    for (const k of ["rates_path", "problem_path", "panels_path", "bill_path"]) {
      if (config[k] !== undefined && typeof config[k] !== "string") throw new Error(`${k} must be a path like /dashboard/view`);
    }
    if (config.panel_count !== undefined && !(Number(config.panel_count) > 0)) throw new Error("panel_count must be a positive number");
  }

  build() {
    const cfg = this.config;
    const e = () => this.entities;

    // header
    const head = cfg.title === false || cfg.title === "" ? null : h("div", { class: "sf-head" }, h("span", { text: cfg.title || t("right_now") }));

    // price
    this.amt = h("div", { class: "amt" });
    this.periodPill = h("span", { class: "period" });
    this.periodDot = h("span", { class: "glow" });
    this.periodText = h("span");
    this.periodPill.append(this.periodDot, this.periodText);
    this.tags = h("div", { class: "tags" });
    this.nextDot = h("span", { class: "nextdot" });
    this.nextText = h("span");
    this.nextLine = h("div", { class: "line" }, icon("clock"), this.nextDot, this.nextText);
    this.exportText = h("span");
    this.exportLine = h("div", { class: "line" }, icon("sun"), this.exportText);
    const priceBox = h(
      "div",
      { class: "sf-glass price" },
      h("div", { class: "top" }, this.amt, this.periodPill),
      this.tags,
      this.nextLine,
      this.exportLine,
    );
    tapTarget(this, priceBox, () => ({ path: cfg.rates_path, entity: e().import_rate }), t("price_now"));

    // problem alert
    this.findings = h("div", { class: "f" });
    this.alert = h(
      "div",
      { class: "sf-glass alert" },
      icon("alert"),
      h("div", { class: "txt" }, h("div", { class: "h", text: t("problem") }), this.findings),
      icon("chevron", "chev"),
    );
    tapTarget(this, this.alert, () => ({ path: cfg.problem_path, entity: e().solar_problem }), t("problem"));

    // chips
    const chip = (name, color) => {
      const label = h("span");
      const el = h("span", { class: "sf-glass chip", style: color ? { "--c": color } : null }, icon(name), label);
      return { el, label };
    };
    this.health = chip("panel", "var(--sf-solar)");
    tapTarget(this, this.health.el, () => ({ path: cfg.panels_path, entity: e().panel_health }));
    this.share = chip("sun", "var(--sf-solar)");
    tapTarget(this, this.share.el, () => ({ entity: e().self_sufficiency }));
    this.source = chip("live", "var(--sf-export)");
    tapTarget(this, this.source.el, () => ({ entity: e().data_age || e().solar_power }));
    const chips = h("div", { class: "chips" }, this.health.el, this.share.el, this.source.el);

    // bill so far
    this.billAmt = h("div", { class: "amt" });
    this.billSub = h("div", { class: "sub" });
    this.bill = h(
      "div",
      { class: "sf-glass bill" },
      icon("receipt"),
      h("div", { class: "txt" }, h("div", { class: "h", text: t("bill_so_far") }), this.billSub),
      this.billAmt,
      icon("chevron", "chev"),
    );
    tapTarget(this, this.bill, () => ({ path: cfg.bill_path, entity: e().bill_estimate }), t("bill_so_far"));

    this.shadowRoot.append(
      h("ha-card", { class: "sf-pad" }, head, h("div", { class: "body" }, priceBox, this.alert, chips, this.bill)),
    );
  }

  render() {
    const hass = this.hass;
    const cfg = this.config;
    const e = this.entities;

    // price and period
    const rate = num(hass, e.import_rate);
    this.amt.replaceChildren(price(hass, rate, { unit: false }));
    if (rate !== undefined) this.amt.append(h("small", { text: t("per_kwh") }));
    const period = state(hass, e.tou_period);
    const color = periodColor(period);
    this.periodPill.style.setProperty("--c", color);
    this.periodDot.style.setProperty("--c", color);
    this.periodText.textContent = periodLabel(period, attr(hass, e.tou_period, "label"));
    this.periodPill.hidden = !period;

    const tags = [];
    const season = attr(hass, e.tou_period, "season");
    if (season) tags.push(seasonLabel(season));
    const holiday = attr(hass, e.tou_period, "holiday");
    const dayType = attr(hass, e.tou_period, "day_type");
    if (holiday) tags.push(typeof holiday === "string" ? holiday : t("holiday"));
    else if (dayType === "weekend" || dayType === "weekday") tags.push(t(dayType));
    const plan = attr(hass, e.tou_period, "plan");
    if (plan && cfg.show_plan) tags.push(plan);
    this.tags.replaceChildren(...tags.map((x) => h("span", { class: "tag", text: x })));
    this.tags.hidden = !tags.length;

    const nextAt = attr(hass, e.tou_period, "next_change");
    const nextPeriod = attr(hass, e.tou_period, "next_period");
    const when = nextAt ? Date.parse(nextAt) : NaN;
    if (Number.isFinite(when) && nextPeriod) {
      const label = periodLabel(nextPeriod, attr(hass, e.tou_period, "next_period_label"));
      const secs = (when - Date.now()) / 1000;
      this.nextDot.style.setProperty("--c", periodColor(nextPeriod));
      this.nextText.replaceChildren(
        t("next_change", { period: label, time: time(hass, new Date(when)) }),
        secs > 0 ? ` · ${t("in_dur", { dur: duration(secs) }).replace(/ /g, "\u00a0")}` : "",
      );
      this.nextLine.hidden = false;
    } else {
      this.nextLine.hidden = true;
    }

    const exportRate = num(hass, e.export_rate);
    this.exportText.textContent = t("export_at", { price: price(hass, exportRate) });
    this.exportLine.hidden = exportRate === undefined;

    // problem alert
    const problem = isOn(hass, e.solar_problem);
    this.alert.hidden = !problem;
    if (problem) {
      const findings = attr(hass, e.solar_problem, "findings") || state(hass, e.panel_health) || "";
      this.findings.textContent = findings === "OK" ? "" : String(findings);
    }

    // chips
    const health = state(hass, e.panel_health);
    this.health.el.hidden = health === undefined;
    if (health !== undefined) {
      const ok = health === "OK";
      const n = Number(cfg.panel_count);
      this.health.label.textContent = ok ? (n > 0 ? t("panels_ok", { n }) : t("panels_ok_plain")) : t("panels_check");
      this.health.el.classList.toggle("warn", !ok);
    }

    const share = num(hass, e.self_sufficiency);
    this.share.el.hidden = share === undefined;
    if (share !== undefined) this.share.label.textContent = t("solar_now", { pct: Math.round(share) });

    const stale = this.isStale();
    const source = attr(hass, e.solar_power, "source");
    this.source.el.classList.toggle("warn", stale);
    if (stale) {
      this.source.label.textContent = t("data_old", { minutes: Math.round(this.dataAge() / 60) });
      this.source.el.hidden = false;
    } else {
      this.source.label.textContent = source === "live" ? t("live") : t("meter_5min");
      this.source.el.style.setProperty("--c", source === "live" ? "var(--sf-export)" : "var(--sf-text-2)");
      this.source.el.hidden = !source;
    }

    // bill
    const bill = num(hass, e.bill_estimate);
    this.bill.hidden = cfg.show_bill === false || bill === undefined;
    if (bill !== undefined) {
      this.billAmt.textContent = bill < 0 ? t("credit", { amount: money(hass, bill, { abs: true }) }) : money(hass, bill);
      const start = attr(hass, e.bill_estimate, "cycle_start");
      const days = toNumber(attr(hass, e.bill_estimate, "days_in_cycle"));
      this.billSub.textContent = start
        ? days
          ? t("cycle_since", { date: date(hass, start), days })
          : t("since", { date: date(hass, start) })
        : "";
    }
  }
}

defineCard("sunflow-now-card", NowCard, {
  name: "SunFlow right now",
  description: "Current price and TOU period, next change, problem alert, panel and data chips, and the bill so far.",
});
