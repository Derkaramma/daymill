// daymill-rates-card: price now, the season rate tables, how net metering
// bills you, fixed charges and fine print, next holidays and the billing
// cycle day.
//
//   type: custom:daymill-rates-card
//   sections: [now, seasons, nem, fine_print, holidays, settings]
//   holidays: 4                      # how many upcoming holidays
//   billing_day_entity: number.x     # optional; else a link to the options
//   title: "..."                     # false hides the header

import { DayMillCard, asButton, defineCard, h } from "../common/base.js";
import { PLATFORM, PLATFORMS, attr, num, numAttr, state } from "../common/entities.js";
import { DASH, date, money, num as fmtNum, periodLabel, price, seasonLabel, t, time } from "../common/format.js";
import { periodColor } from "../common/theme.js";
import { duration, humanize, localDate, nemMode } from "../common/chart-helpers.js";
import { chartStyles } from "./chart/style.js";
import { dotLabel, section, table } from "./chart/table.js";

const SECTIONS = ["now", "seasons", "nem", "fine_print", "holidays", "settings"];
const DERIVED = new Set(["period_total_table", "rate_table", "energy_rate_table"]);
const DAY_KEYS = ["cycle_day", "billing_day", "billing_cycle_day"];
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

const css = `
.seasons { display: grid; grid-template-columns: 1fr; gap: 14px; }
@container (min-width: 1100px) { .seasons { grid-template-columns: 1fr 1fr; } }
.pair { display: grid; grid-template-columns: 1fr; gap: 14px; align-items: start; }
@container (min-width: 820px) { .pair { grid-template-columns: 3fr 2fr; } }
.setting { display: flex; align-items: center; gap: 12px; padding: 10px 12px; flex-wrap: wrap; }
.setting .txt { flex: 1 1 180px; display: flex; flex-direction: column; gap: 2px; }
.setting .txt .sub { font-size: 0.82em; color: var(--sf-text-2); }
.stepper { display: inline-flex; align-items: center; gap: 4px; }
.stepper .val { min-width: 2.4em; text-align: center; font-weight: 600; font-size: 1.1em; font-variant-numeric: tabular-nums; }
.stepper .btn {
  width: 30px; height: 30px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--ct-glass-edge); color: var(--sf-text); font-size: 1.1em; line-height: 1;
  user-select: none;
}
.stepper .btn:hover { background: color-mix(in srgb, var(--sf-text) 8%, transparent); }
.ct-hero .price-now { display: flex; flex-direction: column; gap: 4px; }
`;

class RatesCard extends DayMillCard {
  static styles = [chartStyles, css];
  static keys = ["import_rate", "export_rate", "tou_period", "tou_holiday", "bill_estimate"];
  static cardSize = 10;

  static getStubConfig() {
    return {};
  }

  validateConfig(config) {
    const bad = (config.sections || []).find((x) => !SECTIONS.includes(x));
    if (bad) throw new Error(`Unknown section: ${bad}. Use ${SECTIONS.join(", ")}`);
  }

  // Billing day control: config entity, else a DayMill number entity if the
  // integration ever adds one.
  get dayEntity() {
    if (this.config.billing_day_entity) return this.config.billing_day_entity;
    for (const e of Object.values(this.hass?.entities || {})) {
      if (PLATFORMS.includes(e?.platform) && DAY_KEYS.includes(e.translation_key)) return e.entity_id;
    }
    return undefined;
  }

  watchedEntities() {
    return [...Object.values(this.entities), this.dayEntity].filter(Boolean);
  }

  build() {
    const cfg = this.config;
    this.meta = h("span", { class: "ct-meta" });
    const head = cfg.title === false ? null : h("div", { class: "ct-head" }, h("h2", { class: "ct-title", text: cfg.title || t("rates_title") }), this.meta);
    this.body = h("div", { class: "ct-body" });
    this.shadowRoot.append(h("ha-card", null, h("div", { class: "ct" }, head, this.body)));
  }

  render() {
    const hass = this.hass;
    const e = this.entities;
    if (!e.import_rate || !hass.states[e.import_rate]) {
      this.body.replaceChildren(h("div", { class: "sf-empty", text: t("missing_entity", { entity: "import_rate" }) }));
      return;
    }
    this.a = hass.states[e.import_rate].attributes || {};
    this.nem = nemMode(hass, e);
    this.meta.textContent = attr(hass, e.tou_period, "plan", "");
    const want = new Set(this.config.sections || SECTIONS);
    const parts = [];
    if (want.has("now")) parts.push(this.hero());
    if (want.has("seasons")) parts.push(this.seasons());
    if (want.has("nem")) parts.push(this.explainer());
    // fine print and holidays sit side by side on wide cards
    const pair = [want.has("fine_print") && this.finePrint(), want.has("holidays") && this.holidays()].filter(Boolean);
    if (pair.length) parts.push(h("div", { class: "pair" }, pair));
    if (want.has("settings")) parts.push(this.setting());
    this.body.replaceChildren(...parts.filter(Boolean));
  }

  // ---- price now ----

  hero() {
    const hass = this.hass;
    const e = this.entities;
    const a = this.a;
    const rate = num(hass, e.import_rate);
    const period = state(hass, e.tou_period) || a.period;
    const label = attr(hass, e.tou_period, "label") || a.label || periodLabel(period);
    const season = attr(hass, e.tou_period, "season") || a.season;
    const dayType = attr(hass, e.tou_period, "day_type");
    const holiday = attr(hass, e.tou_period, "holiday");
    const exp = num(hass, e.export_rate);

    const side = [];
    side.push(h("span", { text: [seasonLabel(season), holiday || (dayType ? t(`day_${dayType}`) : "")].filter(Boolean).join(" · ") }));
    if (exp !== undefined && this.nem !== "none") side.push(h("span", null, `${t("col_export")} `, h("b", { text: price(hass, exp, { maxDigits: 5 }) })));
    const next = localDate(attr(hass, e.tou_period, "next_change"));
    if (next) {
      const np = attr(hass, e.tou_period, "next_period");
      const ns = attr(hass, e.tou_period, "next_season") || season;
      const nextPrice = a.rate_table?.[ns]?.[np];
      const mins = (next.getTime() - Date.now()) / 60_000;
      side.push(
        h(
          "span",
          null,
          `${t("changes_at", { period: attr(hass, e.tou_period, "next_period_label") || periodLabel(np), time: time(hass, next) })} · ${duration(mins, t)}`,
          isNum(nextPrice) ? [" · ", h("b", { text: price(hass, nextPrice, { maxDigits: 5 }) })] : null,
        ),
      );
    }
    const hero = h(
      "div",
      { class: "ct-panel ct-hero" },
      h(
        "div",
        { class: "price-now" },
        h("div", { class: "ct-label" }, h("span", { class: "sf-dot", style: { background: periodColor(period) } }), `${t("price_now")} · ${label}`),
        h("div", { class: "big" }, rate === undefined ? DASH : money(hass, rate, { digits: 5 }), h("span", { class: "unit", text: t("per_kwh") })),
      ),
      h("div", { class: "side" }, side),
    );
    asButton(hero, () => this.moreInfo(e.import_rate), t("price_now"));
    return hero;
  }

  // ---- season tables ----

  seasons() {
    const hass = this.hass;
    const a = this.a;
    const rate = a.rate_table;
    if (!rate || typeof rate !== "object") return null;
    const components = Object.keys(a).filter((k) => k.endsWith("_table") && !DERIVED.has(k) && a[k] && typeof a[k] === "object");
    const showExport = this.nem === "nem1" || this.nem === "nem2";
    const cols = [
      ...components.map((k) => ({ head: humanize(k.slice(0, -6)), table: a[k] })),
      a.period_total_table && components.length ? { head: t("col_total"), table: a.period_total_table } : null,
      { head: t("col_import"), table: rate, strong: true },
      showExport && a.energy_rate_table ? { head: t("col_export"), table: a.energy_rate_table } : null,
    ].filter(Boolean);
    const nowSeason = attr(hass, this.entities.tou_period, "season") || a.season;
    const nowPeriod = state(hass, this.entities.tou_period) || a.period;

    // same number of decimals down each table, 2 to 5
    const decimals = (v) => {
      for (let d = 2; d < 5; d++) if (Math.abs(Math.round(v * 10 ** d) - v * 10 ** d) < 1e-6) return d;
      return 5;
    };
    const tables = Object.keys(rate).map((season) => {
      const periods = Object.keys(rate[season] || {});
      let digits = 2;
      for (const c of cols) for (const p of periods) if (isNum(c.table?.[season]?.[p])) digits = Math.max(digits, decimals(c.table[season][p]));
      const rows = periods.map((p) => {
        const now = season === nowSeason && p === nowPeriod;
        return {
          class: now ? "now" : undefined,
          cells: [
            dotLabel(periodLabel(p), periodColor(p), now ? h("span", { class: "mark", text: t("now_mark") }) : null),
            ...cols.map((c) => {
              const v = c.table?.[season]?.[p];
              return isNum(v) ? money(hass, v, { digits }) : DASH;
            }),
          ],
        };
      });
      const label = `${seasonLabel(season)}${season === nowSeason ? ` ${t("now_mark")}` : ""}`;
      return section(label, table([t("period"), ...cols.map((c) => c.head)], rows));
    });
    return h("div", { class: "seasons" }, tables);
  }

  // ---- how net metering bills you ----

  explainer() {
    const hass = this.hass;
    const a = this.a;
    const version = attr(hass, this.entities.export_rate, "nem_version") || this.nem.toUpperCase();
    const p = (v) => (isNum(v) ? price(hass, v, { unit: false, maxDigits: 5 }) : DASH);
    const nscr = isNum(a.net_surplus_compensation_rate) ? ` (${price(hass, a.net_surplus_compensation_rate, { maxDigits: 5 })})` : "";
    const text = t(`nem_${this.nem}`, { nbc: p(a.nbc_per_kwh), adders: p(a.interval_adders_per_kwh), nscr });
    const parts = [h("p", { class: "ct-note", text })];
    if (typeof a.definitions === "string" && a.definitions) parts.push(h("p", { class: "ct-note", text: a.definitions }));
    return section(t("how_nem", { nem: version }), h("div", { class: "ct-panel ct-pad-note" }, parts));
  }

  // ---- fixed charges and fine print ----

  finePrint() {
    const hass = this.hass;
    const a = this.a;
    const p5 = (v) => price(hass, v, { maxDigits: 5 });
    const rows = [];
    const add = (label, value, sub) => value !== undefined && value !== null && value !== "" && rows.push([sub ? { text: label, sub } : label, value]);

    const plan = attr(hass, this.entities.tou_period, "plan");
    // the plan name is already in the header; the detail line adds to it
    if (a.plan_detail && a.plan_detail !== plan) add(t("plan"), String(a.plan_detail));
    if (isNum(a.daily_charge)) add(t("daily_charge"), `${money(hass, a.daily_charge, { digits: 2, maxDigits: 5 })}${t("per_day")}`);
    if (isNum(a.nbc_per_kwh)) {
      const parts = a.nbc_components && typeof a.nbc_components === "object" ? Object.entries(a.nbc_components).map(([k, v]) => `${humanize(k)} ${price(hass, v, { unit: false, maxDigits: 5 })}`) : [];
      add(t("nbc_rate"), p5(a.nbc_per_kwh), parts.join(" · ") || undefined);
    }
    if (isNum(a.interval_adders_per_kwh)) {
      const names = Object.keys(attr(hass, this.entities.bill_estimate, "adders", {}) || {});
      const parts = names.filter((k) => isNum(a[k])).map((k) => `${humanize(k)} ${price(hass, a[k], { unit: false, maxDigits: 5 })}`);
      add(t("adders_rate"), p5(a.interval_adders_per_kwh), parts.join(" · ") || undefined);
    }
    if ((this.nem === "nem1" || this.nem === "nem2") && isNum(a.net_surplus_compensation_rate)) add(t("nscr"), p5(a.net_surplus_compensation_rate));
    const cc = a.climate_credit;
    if (isNum(cc)) add(t("climate_credit"), money(hass, Math.abs(cc)));
    else if (cc && typeof cc === "object" && isNum(cc.amount)) {
      const months = (cc.months || []).map((m) => date(hass, new Date(2000, m - 1, 1), { month: "short" })).join(", ");
      add(t("climate_credit"), months ? t("climate_credit_months", { amount: money(hass, Math.abs(cc.amount)), months }) : money(hass, Math.abs(cc.amount)));
    }
    if (a.effective_date) add(t("effective"), date(hass, localDate(a.effective_date), { month: "short", day: "numeric", year: "numeric" }));
    if (a.decision) add(humanize("decision"), String(a.decision));
    if (a.advice_letter) add(humanize("advice_letter"), String(a.advice_letter));

    const out = [table(null, rows)];
    const unverified = [a.unverified_items].flat().filter((x) => typeof x === "string" && x);
    if (unverified.length) out.push(h("div", { class: "ct-label", text: t("unverified") }), h("ul", { class: "ct-list" }, unverified.map((x) => h("li", { text: x }))));
    const cites = [a.citations, attr(this.hass, this.entities.tou_period, "source")].flat().filter((x) => typeof x === "string" && x);
    if (cites.length) out.push(h("p", { class: "ct-note" }, h("b", { text: `${t("sources")}: ` }), cites.join(" · ")));
    return section(t("fine_print"), ...out);
  }

  // ---- holidays ----

  holidays() {
    const hass = this.hass;
    const dates = attr(hass, this.entities.tou_holiday, "dates");
    if (!dates || typeof dates !== "object") return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const count = Number(this.config.holidays ?? 4);
    const list = Object.entries(dates)
      .map(([d, name]) => [localDate(d), name])
      .filter(([d]) => d && d >= today)
      .sort((x, y) => x[0] - y[0])
      .slice(0, count);
    if (!list.length) return section(t("next_holidays"), h("p", { class: "ct-note", text: t("no_holidays") }));
    const rows = list.map(([d, name]) => {
      const days = Math.round((d.setHours(12) - today.getTime() - 12 * 3_600_000) / 86_400_000);
      return [name, { text: date(hass, d, { weekday: "short", month: "short", day: "numeric" }), sub: days === 0 ? t("today") : days === 1 ? t("tomorrow") : t("in_days", { n: days }) }];
    });
    return section(t("next_holidays"), table(null, rows));
  }

  // ---- billing cycle day ----

  setting() {
    const hass = this.hass;
    const id = this.dayEntity;
    const cycleStart = localDate(attr(hass, this.entities.bill_estimate, "cycle_start"));
    const txt = h("div", { class: "txt" }, h("span", { text: t("billing_day") }), h("span", { class: "sub", text: t("billing_day_hint") }));
    let control;
    const value = id ? num(hass, id) : cycleStart?.getDate();
    if (id && value !== undefined) {
      const domain = id.split(".")[0];
      const min = numAttr(hass, id, "min") ?? 1;
      const max = numAttr(hass, id, "max") ?? 28;
      const set = (v) => {
        const next = Math.min(max, Math.max(min, v));
        if (next !== value) hass.callService(domain, "set_value", { entity_id: id, value: next });
      };
      const btn = (label, delta, name) => {
        const b = asButton(h("span", { class: "btn", text: label, "data-k": name }), () => set(value + delta));
        b.setAttribute("aria-label", t(name));
        return b;
      };
      control = h("div", { class: "stepper" }, btn("−", -1, "billing_day_decrease"), h("span", { class: "val", text: fmtNum(hass, value, 0), "aria-live": "polite" }), btn("+", 1, "billing_day_increase"));
    } else {
      const link = asButton(h("span", { class: "ct-link", text: t("billing_day_options") }), () => this.navigate(`/config/integrations/integration/${PLATFORM}`));
      control = h("div", { class: "stepper" }, value !== undefined ? h("span", { class: "val", text: fmtNum(hass, value, 0) }) : null, link);
    }
    return h("div", { class: "ct-panel setting" }, txt, control);
  }
}

defineCard("daymill-rates-card", RatesCard, {
  name: "DayMill rates",
  description: "Price now, season rate tables, how net metering bills you, fine print and holidays.",
});
