// daymill-billing-card: this billing cycle so far, and grid kWh per TOU
// period with the current period marked. Reads the bill estimate sensor.
//
//   type: custom:daymill-billing-card
//   periods: true            # false hides the per-period table
//   show_all_periods: false  # also list periods with no kWh this cycle
//   notes: true              # cycle note and tracking start under the tables
//   title: "..."             # false hides the header

import { DayMillCard, asButton, defineCard, h } from "../common/base.js";
import { attr, num, state } from "../common/entities.js";
import { DASH, date, money, num as fmtNum, periodLabel, price, seasonLabel, t } from "../common/format.js";
import { periodColor } from "../common/theme.js";
import { humanize, knownTrackingStart, localDate, trackingStart } from "../common/chart-helpers.js";
import { chartStyles } from "./chart/style.js";
import { dotLabel, section, table } from "./chart/table.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

class BillingCard extends DayMillCard {
  static styles = [chartStyles];
  static keys = ["bill_estimate", "tou_period", "import_rate", "totals", "energy_produced"];
  static cardSize = 7;

  static getStubConfig() {
    return {};
  }

  watchedEntities() {
    const e = this.entities;
    return [e.bill_estimate, e.tou_period].filter(Boolean);
  }

  build() {
    const cfg = this.config;
    this.meta = h("span", { class: "ct-meta" });
    const head = cfg.title === false ? null : h("div", { class: "ct-head" }, h("h2", { class: "ct-title", text: cfg.title || t("billing_title") }), this.meta);
    this.body = h("div", { class: "ct-body" });
    this.shadowRoot.append(h("ha-card", null, h("div", { class: "ct" }, head, this.body)));
    this.foundStart = undefined;
    if (cfg.notes !== false) {
      trackingStart(this.hass, cfg).then((d) => {
        this.foundStart = d;
        if (d) this._update(true);
      });
    }
  }

  render() {
    const hass = this.hass;
    this.started = knownTrackingStart(hass, this.config) || this.foundStart;
    const id = this.entities.bill_estimate;
    const a = hass.states[id]?.attributes;
    if (!id || !a) {
      this.body.replaceChildren(h("div", { class: "sf-empty", text: id ? t("unavailable") : t("missing_entity", { entity: "bill_estimate" }) }));
      return;
    }
    const nem3 = a.nem === "nem3";
    const m = (v) => money(hass, v);
    const start = localDate(a.cycle_start);
    this.meta.textContent = start ? t("billing_cycle_since", { date: date(hass, start), days: a.days_in_cycle ?? DASH }) : "";

    // hero: bill so far, due and carried credit
    const total = num(hass, id);
    const hero = h(
      "div",
      { class: "ct-panel ct-hero" },
      h("div", null, h("div", { class: "ct-label", text: t("bill_so_far") }), h("div", { class: "big", text: m(total) })),
      h(
        "div",
        { class: "side" },
        isNum(a.import_kwh) ? h("span", null, `${t("from_grid_kwh")} `, h("b", { text: `${fmtNum(hass, a.import_kwh, 1)} kWh` })) : null,
        isNum(a.export_kwh) ? h("span", null, `${t("to_grid_kwh")} `, h("b", { text: `${fmtNum(hass, a.export_kwh, 1)} kWh` })) : null,
      ),
    );
    asButton(hero, () => this.moreInfo(id), t("bill_so_far"));

    const parts = [hero, this.summary(a, nem3)];
    if (this.config.periods !== false && Array.isArray(a.periods)) parts.push(this.periods(a, nem3));
    if (a.beta_note) parts.push(h("div", { class: "ct-warn" }, h("span", { class: "tag", text: t("beta") }), String(a.beta_note)));
    if (this.config.notes !== false) {
      const notes = [];
      if (this.started) notes.push(t("tracking_since", { date: date(hass, this.started, { month: "short", day: "numeric", year: "numeric" }) }));
      if (a.note) notes.push(String(a.note));
      if (notes.length) parts.push(h("p", { class: "ct-note", text: notes.join(" · ") }));
    }
    this.body.replaceChildren(...parts);
  }

  summary(a, nem3) {
    const hass = this.hass;
    const m = (v) => (isNum(v) ? money(hass, v) : DASH);
    const credit = (v) => (isNum(v) ? { text: money(hass, v + 0), class: v < 0 ? "credit" : undefined } : DASH);
    const daily = attr(hass, this.entities.import_rate, "daily_charge");
    const adderNames = a.adders && typeof a.adders === "object" ? Object.keys(a.adders).map(humanize).join(" + ") : "";
    const row = (label, value, opts = {}) => (value === undefined || value === null ? null : { cells: [opts.sub ? { text: label, sub: opts.sub } : label, value], class: opts.class });
    const has = (k) => isNum(a[k]);

    const rows = [
      row(t("base_charges"), m(a.base_charges), {
        sub: isNum(daily)
          ? `${a.days_before_tracking > 0 ? t("base_charges_before", { days: a.days_in_cycle, n: a.days_before_tracking }) : t("base_charges_detail", { days: a.days_in_cycle })} × ${money(hass, daily)}`
          : undefined,
      }),
      row(t("nbc_charges"), m(a.nbc_charges)),
      has("adder_charges") ? row(t("adder_charges"), m(a.adder_charges), { sub: adderNames || undefined }) : null,
      row(t("energy_charges"), m(a.energy_charges)),
    ];
    if (nem3) {
      rows.push(
        row(t("export_credit_this_cycle"), credit(-Math.abs(a.export_credit_this_cycle ?? 0))),
        has("export_credit_carried_in") && a.export_credit_carried_in ? row(t("export_credit_carried_in"), m(a.export_credit_carried_in)) : null,
        row(t("export_credit_applied"), credit(has("export_credit_applied") ? -Math.abs(a.export_credit_applied) : undefined)),
        row(t("energy_due"), m(a.energy_due)),
        has("acc_plus_this_cycle") && a.acc_plus_this_cycle
          ? row(t("acc_plus_this_cycle"), m(a.acc_plus_this_cycle), { sub: isNum(a.acc_plus_per_kwh) ? price(hass, a.acc_plus_per_kwh, { maxDigits: 5 }) : undefined })
          : null,
        has("acc_plus_applied") && a.acc_plus_applied ? row(t("acc_plus_applied"), credit(-Math.abs(a.acc_plus_applied))) : null,
        has("account_credit_applied") && a.account_credit_applied ? row(t("account_credit_applied"), credit(-Math.abs(a.account_credit_applied))) : null,
        row(t("due_before_credits"), m(a.due_before_credits)),
        row(t("due_this_cycle"), m(a.due_this_cycle), { class: "strong total" }),
        has("acc_plus_carried_forward") && a.acc_plus_carried_forward ? row(t("acc_plus_carried_forward"), credit(-Math.abs(a.acc_plus_carried_forward))) : null,
        has("account_credit_carried_forward") && a.account_credit_carried_forward ? row(t("account_credit_carried_forward"), credit(-Math.abs(a.account_credit_carried_forward))) : null,
        row(t("credit_carried_forward"), credit(a.credit_carried_forward)),
      );
    } else {
      rows.push(
        row(t("energy_credits"), credit(a.energy_credits)),
        row(t("nem_energy_balance"), credit(a.nem_energy_balance)),
        row(t("due_this_cycle"), m(a.due_this_cycle_mbo), { class: "strong total" }),
        row(t("credit_carried_forward"), credit(a.credit_carried_forward)),
      );
    }
    rows.push(row(t("due_monthly_minimum"), m(a.due_monthly_minimum), { class: "dim" }));

    const out = [table(null, rows.filter((r) => r && r.cells[1] !== DASH))];
    if (nem3) {
      const facts = [];
      const d = (v) => date(hass, localDate(v), { month: "short", day: "numeric", year: "numeric" });
      if (a.true_up_date) facts.push(t("true_up", { date: d(a.true_up_date) }));
      if (a.relevant_period_start && isNum(a.relevant_period_import_kwh)) {
        facts.push(
          t("relevant_period", {
            date: d(a.relevant_period_start),
            imp: `${fmtNum(hass, a.relevant_period_import_kwh, 0)} kWh`,
            exp: `${fmtNum(hass, a.relevant_period_export_kwh ?? 0, 0)} kWh`,
          }),
        );
      }
      if (a.lock_in_end) facts.push(t("lock_in_end", { date: d(a.lock_in_end) }));
      if (facts.length) out.push(h("p", { class: "ct-note", text: facts.join(" · ") }));
    }
    return h("div", { class: "ct-section" }, ...out);
  }

  periods(a, nem3) {
    const hass = this.hass;
    const nowKey = attr(hass, this.entities.tou_period, "tariff") || `${attr(hass, this.entities.tou_period, "season")}_${state(hass, this.entities.tou_period)}`;
    const nowSeason = attr(hass, this.entities.tou_period, "season");
    const showAll = !!this.config.show_all_periods;
    const n1 = (v) => (isNum(v) ? fmtNum(hass, v, 1) : DASH);
    const amount = (v) => (isNum(v) ? { text: money(hass, v), class: v < 0 ? "credit" : undefined } : DASH);

    const used = (p) => (p.import_kwh || 0) !== 0 || (p.export_kwh || 0) !== 0;
    const shown = a.periods.filter((p) => showAll || used(p) || p.season === nowSeason || `${p.season}_${p.period}` === nowKey);
    const seasons = new Set(shown.map((p) => p.season));

    const rows = [];
    const sum = { i: 0, e: 0, n: 0, amt: 0, ch: 0, cr: 0 };
    for (const p of shown) {
      const now = `${p.season}_${p.period}` === nowKey;
      sum.i += p.import_kwh || 0;
      sum.e += p.export_kwh || 0;
      sum.n += p.net_kwh || 0;
      sum.amt += p.amount || 0;
      sum.ch += p.import_charge || 0;
      sum.cr += p.export_credit || 0;
      const name = seasons.size > 1 ? `${seasonLabel(p.season)} ${periodLabel(p.period)}` : periodLabel(p.period);
      const label = dotLabel(name, periodColor(p.period), now ? h("span", { class: "mark", text: t("now_mark") }) : null);
      const cells = [label, n1(p.import_kwh), n1(p.export_kwh)];
      if (nem3) cells.push(isNum(p.import_charge) ? money(hass, p.import_charge) : DASH, isNum(p.export_credit) ? { text: money(hass, -p.export_credit + 0), class: p.export_credit ? "credit" : undefined } : DASH);
      else cells.push(n1(p.net_kwh), isNum(p.energy_rate) ? price(hass, p.energy_rate, { unit: false, maxDigits: 4 }) : DASH);
      cells.push(amount(p.amount));
      rows.push({ cells, class: now ? "now" : !used(p) ? "dim" : undefined });
    }
    const totalCells = [t("total"), n1(sum.i), n1(sum.e)];
    if (nem3) totalCells.push(money(hass, sum.ch), { text: money(hass, -sum.cr + 0), class: sum.cr ? "credit" : undefined });
    else totalCells.push(n1(sum.n), "");
    totalCells.push(amount(sum.amt));
    rows.push({ cells: totalCells, class: "strong total" });

    const head = [t("period"), t("import_kwh"), t("export_kwh")];
    if (nem3) head.push(t("charge"), t("credit_col"));
    else head.push(t("net_kwh"), t("energy_rate"));
    head.push(t("amount"));
    return section(t("kwh_by_period"), table(head, rows));
  }
}

defineCard("daymill-billing-card", BillingCard, {
  name: "DayMill billing cycle",
  description: "Bill so far this cycle, and grid kWh per time-of-use period.",
});
