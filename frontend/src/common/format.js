// Number, money and text formatting. Currency and locale come from HA.

export const DASH = "–";

// ---- strings ----

const STRINGS = {
  en: {
    // generic
    "unavailable": "Unavailable",
    "no_data": "No data yet",
    "not_found": "SunFlow entities not found. Is the integration set up?",
    "missing_entity": "Entity not found: {entity}",
    "data_old": "Data {minutes} min old",
    "live": "Live data",
    "meter": "Meter data",
    "today": "Today",
    "d7": "7 days",
    "d30": "30 days",
    "month": "This month",
    "year": "This year",
    "per_kwh": "/kWh",
    "per_hour": "/h",
    "credit": "{amount} credit",

    // power flow
    "solar": "Solar",
    "home": "Home",
    "grid": "Grid",
    "battery": "Battery",
    "rate": "Rate",
    "producing": "producing",
    "night": "night",
    "idle": "idle",
    "using_now": "using now",
    "importing": "importing",
    "exporting": "exporting",
    "balanced": "balanced",
    "charging": "charging",
    "discharging": "discharging",
    "head_export": "Sending {power} to the grid",
    "head_covering": "Solar is covering {pct}% of your home",
    "head_import": "Pulling {power} from the grid",
    "head_balanced": "Home is balanced",
    "head_unavailable": "Energy data unavailable",
    "sub_covering": "Solar covers {pct}% of what the home uses",
    "sub_night": "Solar is resting for the night",
    "sub_cars": "{cars} charging",
    "earning": "Earning {amount}/h",
    "costing": "Costing {amount}/h",

    // today box
    "cost_today": "Cost today",
    "home_used": "Home used",
    "sent_to_grid": "Sent to grid",
    "from_solar": "from solar",
    "pct_from_solar": "{pct}% from solar",
    "grid_used": "Grid",
    "solar_used": "Solar",
    "extra_solar": "Plus {energy} of extra solar sent to the grid",
    "no_usage": "No home usage recorded yet",

    // cars
    "car_n": "Car {n}",
    "car_not_connected": "not connected",
    "car_charging": "charging {power}",
    "car_full": "plugged in · full",
    "car_plugged": "plugged in",
    "car_away": "away",
    "car_parked": "parked",

    // TOU
    "period_on_peak": "On-Peak",
    "period_mid_peak": "Mid-Peak",
    "period_off_peak": "Off-Peak",
    "period_super_off_peak": "Super Off-Peak",
    "season_summer": "Summer",
    "season_winter": "Winter",
    "next_change": "Next: {period} at {time}",
    "holiday": "Holiday",

    // energy and money
    "produced": "Produced",
    "used": "Used",
    "imported": "Imported",
    "exported": "Exported",
    "net_cost": "Net cost",
    "saved": "Saved by solar",
    "nbc": "Non-bypassable charges",
    "adders": "Adders",
    "base_charge": "Base charge",
    "bill_so_far": "Bill so far",
    "since": "since {date}",
    "panels_ok": "{n} panels OK",
    "panels_check": "Panels: see details",
    "solar_now": "{pct}% solar now",
  },
};

let lang = "en";

export function setLanguage(language) {
  const base = String(language || "en").toLowerCase().split("-")[0];
  lang = STRINGS[language] ? language : STRINGS[base] ? base : "en";
}

// Merge more strings, e.g. addStrings("de", {...}).
export function addStrings(language, table) {
  STRINGS[language] = { ...(STRINGS[language] || {}), ...table };
}

// t("head_export", {power: "2.1 kW"}). Unknown keys come back as the key.
export function t(key, vars) {
  const str = STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

// Has a string for this key (handy for optional labels like period names).
export const hasString = (key) => key in (STRINGS[lang] || {}) || key in STRINGS.en;

// ---- locale ----

export function locale(hass) {
  return hass?.locale?.language || hass?.language || navigator.language || "en";
}

export function currency(hass) {
  return hass?.config?.currency || "USD";
}

const fmtCache = new Map();
function nf(loc, opts) {
  const key = String(loc) + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(loc, opts);
    } catch {
      f = new Intl.NumberFormat("en", opts);
    }
    fmtCache.set(key, f);
  }
  return f;
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// Locale and grouping for numbers, from the number format in the HA profile.
// Same mapping as the HA frontend.
function numberOpts(hass, opts) {
  switch (hass?.locale?.number_format) {
    case "comma_decimal":
      return ["en-US", opts];
    case "decimal_comma":
      return ["de", opts];
    case "space_comma":
      return ["fr", opts];
    case "system":
      return [undefined, opts];
    case "none":
      return [locale(hass), { ...opts, useGrouping: false }];
    default:
      return [locale(hass), opts];
  }
}

export const numFmt = (hass, opts) => nf(...numberOpts(hass, opts));

// Plain number with fixed decimals.
export function num(hass, value, digits = 1, maxDigits = digits) {
  if (!isNum(value)) return DASH;
  return numFmt(hass, { minimumFractionDigits: digits, maximumFractionDigits: maxDigits }).format(value);
}

// Money in HA's currency. money(hass, -1.5) -> "-$1.50".
export function money(hass, value, opts = {}) {
  if (!isNum(value)) return DASH;
  const { digits = 2, maxDigits = digits, abs = false } = opts;
  return numFmt(hass, {
    style: "currency",
    currency: currency(hass),
    minimumFractionDigits: digits,
    maximumFractionDigits: maxDigits,
  }).format(abs ? Math.abs(value) : value);
}

// Price per kWh: 2 to 4 decimals, trailing zeros dropped. "$0.2641/kWh".
export function price(hass, value, opts = {}) {
  if (!isNum(value)) return DASH;
  const { unit = true, maxDigits = 4 } = opts;
  return money(hass, value, { digits: 2, maxDigits }) + (unit ? t("per_kwh") : "");
}

// Currency symbol alone, e.g. "$" or "EUR" when the locale has no symbol.
export function currencySymbol(hass) {
  const parts = numFmt(hass, { style: "currency", currency: currency(hass) }).formatToParts(0);
  return parts.find((p) => p.type === "currency")?.value || currency(hass);
}

// Power from a kW value. unit: "kW" (default), "W", or "auto" (W below 1 kW).
export function kw(hass, value, opts = {}) {
  if (!isNum(value)) return DASH;
  const { digits = 2, unit = "kW" } = opts;
  if (unit === "W" || (unit === "auto" && Math.abs(value) < 1)) {
    return `${num(hass, value * 1000, 0)} W`;
  }
  return `${num(hass, value, digits)} kW`;
}

export function kwh(hass, value, digits = 1) {
  if (!isNum(value)) return DASH;
  return `${num(hass, value, digits)} kWh`;
}

// value is 0..100.
export function pct(hass, value, digits = 0) {
  if (!isNum(value)) return DASH;
  return numFmt(hass, {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value / 100);
}

// Local time of an ISO string or Date, e.g. "4:00 PM".
export function time(hass, when) {
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) return DASH;
  const opts = { hour: "numeric", minute: "2-digit" };
  const tf = hass?.locale?.time_format;
  if (tf === "12") opts.hour12 = true;
  else if (tf === "24") opts.hour12 = false;
  if (hass?.locale?.time_zone === "server" && hass?.config?.time_zone) opts.timeZone = hass.config.time_zone;
  try {
    return new Intl.DateTimeFormat(locale(hass), opts).format(d);
  } catch {
    return d.toLocaleTimeString();
  }
}

// Short date, e.g. "Nov 3".
export function date(hass, when, opts = { month: "short", day: "numeric" }) {
  const d = when instanceof Date ? when : new Date(typeof when === "string" && when.length === 10 ? `${when}T12:00:00` : when);
  if (Number.isNaN(d.getTime())) return DASH;
  return new Intl.DateTimeFormat(locale(hass), opts).format(d);
}

// TOU period label: attribute label if given, else the string table, else title case.
export function periodLabel(period, label) {
  if (label) return label;
  if (!period) return DASH;
  const key = `period_${period}`;
  if (hasString(key)) return t(key);
  return String(period).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function seasonLabel(season) {
  if (!season) return "";
  const key = `season_${season}`;
  if (hasString(key)) return t(key);
  return String(season).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
