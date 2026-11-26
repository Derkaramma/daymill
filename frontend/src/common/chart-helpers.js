// Helpers shared by the chart and table cards (power chart, billing, totals,
// rates, history): their strings, small text helpers and the tracking start.

import { addStrings } from "./format.js";
import { attr, entityId } from "./entities.js";
import { fetchStatistics } from "./ws.js";

addStrings("en", {
  // charts
  "power_24h_title": "Last {hours} hours · kW",
  "loading": "Loading…",
  "now_label": "now",
  "chart_power_24h": "Power",
  "chart_price_24h": "Price",
  "chart_money_per_day": "Money / day",
  "chart_energy_per_day": "Energy / day",
  "chart_energy_per_month": "Energy / month",
  "title_power_24h": "Power, last {hours} hours",
  "title_price_24h": "Price, last {hours} hours",
  "title_money_per_day": "Money per day, last {days} days",
  "title_energy_per_day": "Energy per day, last {days} days",
  "title_energy_per_month": "Energy per month, last {months} months",
  "import_price": "Import",
  "export_price": "Export",
  "net_cost_no_base": "Net cost",
  "grid_in_out": "Grid (+ in / − out)",
  "days_n": "{n} d",

  // billing
  "billing_title": "This billing cycle",
  "billing_cycle_since": "Cycle started {date} · day {days}",
  "base_charges": "Daily charges",
  "base_charges_detail": "{days} days",
  "base_charges_before": "{days} days, {n} before DayMill started",
  "nbc_charges": "Non-bypassable charges",
  "adder_charges": "Other per-kWh charges",
  "energy_charges": "Energy charges",
  "energy_credits": "Energy credits",
  "nem_energy_balance": "NEM energy balance",
  "due_this_cycle": "Due this cycle",
  "due_monthly_minimum": "Due every month",
  "credit_carried_forward": "Credit carried forward",
  "export_credit_this_cycle": "Export credit this cycle",
  "export_credit_carried_in": "Export credit carried in",
  "export_credit_applied": "Export credit applied",
  "energy_due": "Energy due",
  "acc_plus_this_cycle": "ACC Plus this cycle",
  "acc_plus_applied": "ACC Plus applied",
  "acc_plus_carried_forward": "ACC Plus carried forward",
  "account_credit_applied": "Account credit applied",
  "account_credit_carried_forward": "Account credit carried forward",
  "due_before_credits": "Due before credits",
  "true_up": "True-up {date}",
  "lock_in_end": "Export prices locked until {date}",
  "relevant_period": "Since {date}: {imp} in, {exp} out",
  "from_grid_kwh": "From grid",
  "to_grid_kwh": "To grid",
  "kwh_by_period": "Grid kWh by TOU period, this cycle",
  "period": "Period",
  "import_kwh": "In",
  "export_kwh": "Out",
  "net_kwh": "Net",
  "energy_rate": "Rate",
  "amount": "Amount",
  "charge": "Charge",
  "credit_col": "Credit",
  "total": "Total",
  "now_mark": "(now)",
  "beta": "Beta",
  "tracking_since": "Tracking started {date}",

  // totals
  "totals_title": "Totals",
  "w_today": "Today",
  "w_d7": "7 days",
  "w_d30": "30 days",
  "w_month": "{month}",
  "w_year": "{year}",
  "row_produced": "Solar produced",
  "row_used": "Home used",
  "row_imported": "From grid",
  "row_exported": "To grid",
  "row_self": "Home use from solar",
  "row_netted": "NEM energy netted",
  "row_nbc": "Non-bypassable charges",
  "row_adders": "Other per-kWh charges",
  "row_base": "Daily charge",
  "row_net": "Net cost",
  "row_saved": "Saved by solar",
  "group_energy": "Energy",
  "group_money": "Money",
  "totals_note_rates": "Non-bypassable charges are {nbc}/kWh on net hourly import; other per-kWh charges {adders}/kWh.",
  "totals_note_window": "Windows that begin before tracking started only count from that date.",

  // rates
  "rates_title": "Rates",
  "price_now": "Price now",
  "export_now": "Export {price}",
  "changes_in": "{period} in {dur} · {price}",
  "changes_at": "{period} at {time}",
  "day_weekday": "Weekday",
  "day_weekend": "Weekend",
  "day_holiday": "Holiday",
  "col_import": "Import",
  "col_export": "Export",
  "col_total": "Energy",
  "season_table": "{season}",
  "season_from": "from {date}",
  "how_nem": "How {nem} bills you",
  "fine_print": "Fixed charges and fine print",
  "unverified": "Not yet checked against a bill",
  "sources": "Sources",
  "next_holidays": "Next holidays",
  "in_days": "in {n} days",
  "tomorrow": "Tomorrow",
  "no_holidays": "No holidays listed",
  "daily_charge": "Daily charge",
  "nbc_rate": "Non-bypassable charges",
  "adders_rate": "Other per-kWh charges",
  "climate_credit": "Climate credit",
  "climate_credit_months": "{amount} in {months}",
  "effective": "Rates effective",
  "plan": "Plan",
  "billing_day": "Billing cycle start day",
  "billing_day_hint": "Day of the month your bill starts, from your bill",
  "billing_day_options": "Change in the integration options",
  "billing_day_decrease": "Earlier billing day",
  "billing_day_increase": "Later billing day",
  "nscr": "Net surplus compensation rate",
  "per_day": "/day",
  "dur_h_m": "{h} h {m} min",
  "dur_m": "{m} min",

  "nem_nem1":
    "Every kWh you send to the grid is credited at the full energy rate of the period it is sent in. Imports and exports in the same period cancel out. Credits roll forward month to month and settle at true-up once a year.",
  "nem_nem2":
    "Exports are credited at the period's energy rate minus non-bypassable charges ({nbc}/kWh), so imports and exports in the same period mostly cancel out. Non-bypassable charges and other per-kWh charges ({adders}/kWh) are billed on each hour's net import and are never credited. The daily charge is due every month. Credit rolls forward and settles at true-up; a surplus for the year is paid at the net surplus compensation rate{nscr}.",
  "nem_nem3":
    "Net billing: imports are charged at the full import price and exports are credited at an hourly export price set by the utility's export table, which changes by month, day type and hour. There is no netting within a period. Export credit offsets energy charges only; the daily charge, non-bypassable charges and other per-kWh charges are due every month.",
  "nem_none": "Exports are not credited. Every imported kWh is charged at the import price of its period.",
});

// "fixed_recovery" -> "Fixed recovery"
export function humanize(key) {
  const s = String(key ?? "").replace(/_/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

// NEM mode of the install, from the bill estimate, else the export rate.
export function nemMode(hass, ids) {
  const fromBill = attr(hass, ids.bill_estimate, "nem");
  if (typeof fromBill === "string") return fromBill;
  const v = String(attr(hass, ids.export_rate, "nem_version", "")).toLowerCase();
  if (v.includes("3")) return "nem3";
  if (v.includes("2")) return "nem2";
  if (v.includes("1")) return "nem1";
  return v ? "none" : "nem2";
}

// Minutes -> "3 h 20 min" / "12 min".
export function duration(minutes, t) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return t("dur_m", { m });
  return t("dur_h_m", { h: Math.floor(m / 60), m: m % 60 });
}

// Local date from "YYYY-MM-DD" (noon, so no zone can push it a day off).
export function localDate(isoDate) {
  if (!isoDate) return undefined;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? `${isoDate}T12:00:00` : isoDate);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// ---- tracking start ----

const START_ATTRS = ["tracking_start", "tracking_started", "first_run", "started"];
const startCache = new WeakMap();

function fromAttributes(hass, overrides) {
  for (const key of ["totals", "bill_estimate"]) {
    const id = entityId(hass, key, overrides);
    for (const name of START_ATTRS) {
      const d = localDate(attr(hass, id, name));
      if (d) return d;
    }
  }
  return undefined;
}

// Tracking start from config or attributes only (no websocket).
export function knownTrackingStart(hass, config = {}) {
  return localDate(config.tracking_start) || fromAttributes(hass, config.entities);
}

// When DayMill started counting: a config value, an attribute on the totals
// or bill sensor, else the first long-term statistics row of the produced
// energy sensor. Resolves to a Date or undefined.
export async function trackingStart(hass, config = {}) {
  const fixed = localDate(config.tracking_start);
  if (fixed) return fixed;
  const fromAttr = fromAttributes(hass, config.entities);
  if (fromAttr) return fromAttr;
  const id = entityId(hass, "energy_produced", config.entities);
  if (!id || !hass?.callWS) return undefined;

  // one lookup per connection and sensor
  const conn = hass.connection || hass;
  let byId = startCache.get(conn);
  if (!byId) startCache.set(conn, (byId = new Map()));
  if (!byId.has(id)) byId.set(id, firstStatistic(hass, id).catch(() => undefined));
  return byId.get(id);
}

async function firstStatistic(hass, id) {
  const ttl = 6 * 3_600_000;
  // Only the last year or so matters (the longest totals window), so look
  // from Jan 1 of last year. A first row at that bound means "earlier".
  const now = new Date();
  const bound = new Date(now.getFullYear() - 1, 0, 1);
  const ms = (r) => (typeof r.start === "number" ? r.start : Date.parse(r.start));
  // months first, then days inside the first month
  const months = await fetchStatistics(hass, { statisticIds: [id], start: bound, period: "month", types: ["change"], ttl });
  const first = months?.[id]?.[0];
  if (!first) return undefined;
  const m0 = new Date(ms(first));
  const m1 = new Date(m0.getFullYear(), m0.getMonth() + 1, 1);
  const days = await fetchStatistics(hass, { statisticIds: [id], start: m0, end: m1, period: "day", types: ["change"], ttl });
  const d = days?.[id]?.[0];
  const start = new Date(d ? ms(d) : ms(first));
  if (Number.isNaN(start.getTime()) || start.getTime() <= bound.getTime()) return undefined;
  return start;
}

// ---- chart labels ----

function dtf(hass, opts) {
  const o = { ...opts };
  const tf = hass?.locale?.time_format;
  if ("hour" in o) {
    if (tf === "12") o.hour12 = true;
    else if (tf === "24") o.hour12 = false;
  }
  if (!o.timeZone && hass?.locale?.time_zone === "server" && hass?.config?.time_zone) o.timeZone = hass.config.time_zone;
  const loc = hass?.locale?.language || hass?.language || "en";
  try {
    return new Intl.DateTimeFormat(loc, o);
  } catch {
    return new Intl.DateTimeFormat("en", o);
  }
}

// Axis label for an hour: "3 PM" / "15". Midnight shows the weekday.
export function hourLabel(hass, d) {
  if (d.getHours() === 0) return dtf(hass, { weekday: "short" }).format(d);
  return dtf(hass, { hour: "numeric" }).format(d);
}

// Tooltip time: "Tue 3:40 PM".
export function dayTime(hass, d) {
  return dtf(hass, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(d);
}

// "24", "Mon", "Nov" or "November 2026", depending on opts.
export function dayLabel(hass, d, opts = { day: "numeric" }) {
  return dtf(hass, opts).format(d);
}
