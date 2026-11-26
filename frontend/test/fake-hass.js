// A fake `hass` object for card previews, screenshots and the demo.
//
// Values come from simulate() so they match the Python simulator. The shape
// follows what the real frontend hands to cards: states, the entity registry
// display entries (hass.entities), config.currency, locale, callWS and
// connection.subscribeMessage. Everything here is made up.

import {
  BASE_CHARGE,
  RATES,
  dailyHistory,
  powerHistory,
  pyRound,
  simulate,
} from "../src/common/simulator.js";

export const PLATFORM = "daymill";
const DEVICE_ID = "daymill_device";

// Example tariff. Not a real utility.
const ADDERS = { fixed_recovery: 0.002, program_charge: 0.002 };
const ADDER_SUM = ADDERS.fixed_recovery + ADDERS.program_charge;
const NBC = 0.025;
const RATE_TABLE = {
  summer: { on_peak: 0.52, mid_peak: 0.41, off_peak: 0.31 },
  winter: { mid_peak: 0.47, off_peak: 0.3, super_off_peak: 0.27 },
};
const LABELS = { on_peak: "On-Peak", mid_peak: "Mid-Peak", off_peak: "Off-Peak", super_off_peak: "Super Off-Peak" };

function tables() {
  const map = (fn) =>
    Object.fromEntries(
      Object.entries(RATE_TABLE).map(([s, ps]) => [s, Object.fromEntries(Object.entries(ps).map(([p, r]) => [p, fn(r)]))]),
    );
  const total = (r) => pyRound(r - ADDER_SUM, 5);
  return {
    delivery_table: map((r) => pyRound(total(r) * 0.45, 5)),
    generation_table: map((r) => pyRound(total(r) - pyRound(total(r) * 0.45, 5), 5)),
    period_total_table: map(total),
    rate_table: map((r) => r),
    energy_rate_table: map((r) => pyRound(total(r) - NBC, 5)),
  };
}

// The example tariff is NEM 2.0: export is credited at the period's energy
// rate minus the non-bypassable charge. The shared simulator uses a flat
// export price, so the export side is redone here to match the rate tables.
const EXPORT_TABLE = tables().energy_rate_table.summer;
const exportPrice = (period) => EXPORT_TABLE[period] ?? EXPORT_TABLE.off_peak;
const periodAt = (ts) => {
  const h = new Date(ts).getHours();
  return h >= 16 && h < 21 ? RATES.night : RATES.day;
};

function withNemExport(sim) {
  const ex = exportPrice(sim.period);
  const price = sim.grid_kw > 0 ? sim.import_rate : ex;
  const cost = sim.imported_today * sim.import_rate - sim.exported_today * ex + BASE_CHARGE;
  return { ...sim, export_rate: ex, cost_rate: pyRound(sim.grid_kw * price, 3), cost_today: pyRound(cost, 2) };
}

function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

// Local time today at h:m.
function at(now, h, m = 0, addDays = 0) {
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  d.setDate(d.getDate() + addDays);
  return d;
}

/**
 * opts:
 *   scenario, time ("day" | "night"), t (seconds, for drift)
 *   now (ms; default today 12:30 for day, 20:30 for night)
 *   currency ("USD"), language ("en")
 *   staleMinutes (age of the source data, default 0)
 *   battery (bool; default on for battery scenarios)
 *   cars (number of DayMill cars, 0-2, default 2)
 *   health ("OK" or a findings string)
 *   problem (bool)
 *   decoys (bool, default true): add non-DayMill look-alike entities
 */
export function createFakeHass(opts = {}) {
  const scenario = opts.scenario || "normal";
  const time = opts.time || "day";
  const sim = withNemExport(simulate(scenario, time, opts.t || 0));
  const now = opts.now ?? at(Date.now(), time === "day" ? 12 : 20, 30).getTime();
  const currency = opts.currency || "USD";
  const language = opts.language || "en";
  const battery = opts.battery ?? scenario.startsWith("battery");
  const carCount = Math.max(0, Math.min(2, opts.cars ?? 2));
  const ageMs = (opts.staleMinutes || 0) * 60_000;
  const health = opts.health || "OK";
  const platform = PLATFORM;
  const [prefix, brand] = ["daymill", "DayMill"];

  const nowIso = new Date(now).toISOString();
  const srcIso = new Date(now - ageMs).toISOString();
  const states = {};
  const entities = {};

  const add = (entityId, state, attributes = {}, extra = {}) => {
    const { reg, updated = nowIso } = extra;
    states[entityId] = {
      entity_id: entityId,
      state: state === null || state === undefined ? "unavailable" : String(state),
      attributes,
      last_changed: updated,
      last_updated: updated,
      last_reported: updated,
      context: { id: "fake", parent_id: null, user_id: null },
    };
    if (reg) entities[entityId] = { entity_id: entityId, ...reg };
  };

  // A DayMill entity: registry entry with platform + translation_key.
  const sf = (domain, key, state, attrs = {}, extra = {}) => {
    const objectId = extra.objectId || `${prefix}_${key}`;
    const id = `${domain}.${objectId}`;
    add(id, state, { friendly_name: `${brand} ${extra.name || key.replace(/_/g, " ")}`, ...attrs }, {
      updated: extra.updated,
      reg: {
        platform,
        translation_key: extra.translationKey || key,
        device_id: DEVICE_ID,
        has_entity_name: true,
        entity_category: extra.category,
        labels: [],
      },
    });
    return id;
  };

  const W = { unit_of_measurement: "W", device_class: "power", state_class: "measurement" };
  const KWH = { unit_of_measurement: "kWh", device_class: "energy", state_class: "total_increasing" };
  const MONEY = { unit_of_measurement: currency, device_class: "monetary", state_class: "total" };
  const PCT = { unit_of_measurement: "%", state_class: "measurement" };
  const w = (kw) => Math.round(kw * 1000);

  // power
  sf("sensor", "solar_power", w(sim.solar_kw), { ...W, source: "live" }, { updated: srcIso, name: "Solar power" });
  sf("sensor", "grid_power", w(sim.grid_kw), { ...W, source: "live" }, { updated: srcIso, name: "Grid power" });
  sf("sensor", "home_power", w(sim.home_kw), { ...W, source: "live" }, { updated: srcIso, name: "Home power" });
  sf("sensor", "grid_import_power", w(sim.grid_import_kw), W, { updated: srcIso });
  sf("sensor", "grid_export_power", w(sim.grid_export_kw), W, { updated: srcIso });
  sf("sensor", "self_sufficiency", sim.self_sufficiency, PCT);
  sf("sensor", "status", sim.status, { summary: sim.summary });

  // lifetime energy
  sf("sensor", "energy_produced", 4210.5 + sim.produced_today, KWH);
  sf("sensor", "energy_imported", 1830.25 + sim.imported_today, KWH);
  sf("sensor", "energy_exported", 2475.75 + sim.exported_today, KWH);
  sf("sensor", "energy_consumed", 3565.0 + sim.used_today, KWH);

  // TOU
  const season = "summer";
  const isDay = time === "day";
  const nextChange = isDay ? at(now, 16) : at(now, 21);
  const nextPeriod = isDay ? "on_peak" : "off_peak";
  const plan = "Example Utility TOU-EX";
  sf("sensor", "tou_period", sim.period, {
    season,
    day_type: "weekday",
    holiday: null,
    label: sim.period_label,
    tariff: `${season}_${sim.period}`,
    next_change: nextChange.toISOString(),
    next_period: nextPeriod,
    next_period_label: LABELS[nextPeriod],
    next_season: season,
    metering_season: season,
    metering_period: sim.period,
    metering_tariff: `${season}_${sim.period}`,
    plan,
    source: null,
  });
  const year = new Date(now).getFullYear();
  const iso = (d) => d.toISOString().slice(0, 10);
  // Fixed-date holidays move to Monday when they land on a Sunday.
  const fixed = (y, m, day) => {
    const d = new Date(Date.UTC(y, m - 1, day));
    if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
    return iso(d);
  };
  const lastMonday = (y, m) => {
    const d = new Date(Date.UTC(y, m, 0));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return iso(d);
  };
  sf("sensor", "tou_holiday", "none", {
    dates: {
      [fixed(year, 12, 25)]: "Christmas Day",
      [fixed(year + 1, 1, 1)]: "New Year's Day",
      [lastMonday(year + 1, 5)]: "Memorial Day",
      [fixed(year + 1, 7, 4)]: "Independence Day",
    },
  });
  const tb = tables();
  const total = tb.period_total_table[season][sim.period];
  sf("sensor", "import_rate", sim.import_rate, {
    unit_of_measurement: `${currency}/kWh`,
    state_class: "measurement",
    period: sim.period,
    label: sim.period_label,
    season,
    delivery: tb.delivery_table[season][sim.period],
    generation: tb.generation_table[season][sim.period],
    period_total: total,
    ...ADDERS,
    interval_adders_per_kwh: ADDER_SUM,
    nbc_per_kwh: NBC,
    nbc_components: { public_purpose: 0.015, nuclear_decommissioning: 0.001, other: 0.009 },
    ...tb,
    daily_charge: BASE_CHARGE,
    net_surplus_compensation_rate: 0.03,
    effective_date: `${year}-01-01`,
    climate_credit: { months: [4, 10], amount: 40 },
    unverified_items: ["Example tariff for previews."],
  });
  sf("sensor", "export_rate", sim.export_rate, {
    unit_of_measurement: `${currency}/kWh`,
    state_class: "measurement",
    nem_version: "NEM 2.0",
    non_bypassable_charge: NBC,
    rule: "Energy rate of the period minus non-bypassable charges. Interval adders are not credited.",
  });
  const costText =
    sim.cost_rate < -0.005 ? `Earning $${(-sim.cost_rate).toFixed(2)}/h` : sim.cost_rate > 0.005 ? `Paying $${sim.cost_rate.toFixed(2)}/h` : "About $0.00/h";
  sf("sensor", "cost_rate", sim.cost_rate, { unit_of_measurement: `${currency}/h`, state_class: "measurement", text: costText });

  // lifetime money
  sf("sensor", "import_energy_charge", 412.37, MONEY);
  sf("sensor", "export_credit", 298.12, MONEY);
  sf("sensor", "nbc_charges", 38.4, MONEY);
  sf("sensor", "adder_charges", 6.2, MONEY);
  sf("sensor", "import_cost", 456.97, MONEY);
  sf("sensor", "net_cost", 158.85, MONEY);
  sf("sensor", "solar_savings", 731.6, MONEY);

  // today and cycle
  const todayNet = pyRound(sim.cost_today - BASE_CHARGE, 2);
  sf("sensor", "cost_today", sim.cost_today, {
    unit_of_measurement: currency,
    device_class: "monetary",
    import_energy_charge: pyRound(sim.imported_today * sim.import_rate, 2),
    export_credit: pyRound(sim.exported_today * sim.export_rate, 2),
    acc_plus: 0,
    nbc: pyRound(sim.imported_today * NBC * 0.6, 2),
    adders: pyRound(sim.imported_today * ADDER_SUM, 2),
    savings: pyRound((sim.produced_today - sim.exported_today) * RATES.day.import, 2),
    net_cost: todayNet,
  });
  sf("sensor", "self_sufficiency_today", sim.self_sufficiency_today, PCT);

  const days = dailyHistory({ scenario, now, days: 400 });
  const sum = (list, k) => pyRound(list.reduce((a, d) => a + d[k], 0), 2);
  const last = (n) => days.slice(-n);
  const startOfMonth = new Date(now);
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const startOfYear = new Date(startOfMonth);
  startOfYear.setMonth(0);
  const since = (t0) => days.filter((d) => d.start >= t0);
  const windows = { d7: last(7), d30: last(30), month: since(startOfMonth.getTime()), year: since(startOfYear.getTime()) };
  const metricKey = { produced: "produced", used: "used", imported: "imported", exported: "exported", net_cost: "net_cost", savings: "savings" };
  const totals = {
    produced_today: sim.produced_today,
    used_today: sim.used_today,
    imported_today: sim.imported_today,
    exported_today: sim.exported_today,
    net_cost_today: todayNet,
    nbc_today: pyRound(sim.imported_today * NBC * 0.6, 2),
    adders_today: pyRound(sim.imported_today * ADDER_SUM, 2),
    savings_today: pyRound((sim.produced_today - sim.exported_today) * RATES.day.import, 2),
  };
  for (const [win, list] of Object.entries(windows)) {
    // replace the partial "today" from dailyHistory with the snapshot values
    const past = list.slice(0, -1);
    for (const [m, k] of Object.entries(metricKey)) totals[`${m}_${win}`] = pyRound(sum(past, k) + totals[`${m}_today`], 2);
    totals[`nbc_${win}`] = pyRound(totals[`imported_${win}`] * NBC * 0.6, 2);
    totals[`adders_${win}`] = pyRound(totals[`imported_${win}`] * ADDER_SUM, 2);
  }
  sf("sensor", "totals", sim.produced_today, { unit_of_measurement: "kWh", ...totals });

  const cycleStart = new Date(now);
  cycleStart.setDate(cycleStart.getDate() >= 5 ? 5 : cycleStart.getDate());
  cycleStart.setHours(0, 0, 0, 0);
  const cycleDays = Math.round((at(now, 0) - cycleStart) / 86_400_000) + 1;
  const cycleList = since(cycleStart.getTime());
  const imp = sum(cycleList, "imported");
  const exp = sum(cycleList, "exported");
  const rows = [];
  for (const [s, ps] of Object.entries(tb.energy_rate_table)) {
    for (const [p, rate] of Object.entries(ps)) {
      const share = s !== season ? 0 : p === "on_peak" ? 0.3 : p === "off_peak" ? 0.6 : 0.1;
      const exShare = s !== season ? 0 : p === "off_peak" ? 0.9 : p === "on_peak" ? 0.1 : 0;
      const i = pyRound(imp * share, 3);
      const e = pyRound(exp * exShare, 3);
      rows.push({ season: s, period: p, import_kwh: i, export_kwh: e, net_kwh: pyRound(i - e, 3), energy_rate: rate, amount: pyRound((i - e) * rate, 4) });
    }
  }
  const energy = rows.reduce((a, r) => a + r.amount, 0);
  const base = cycleDays * BASE_CHARGE;
  const nbcs = imp * NBC * 0.6;
  const adders = imp * ADDER_SUM;
  sf("sensor", "bill_estimate", pyRound(energy + nbcs + adders + base, 2), {
    unit_of_measurement: currency,
    device_class: "monetary",
    cycle_start: cycleStart.toISOString().slice(0, 10),
    days_in_cycle: cycleDays,
    base_charges: pyRound(base, 2),
    nbc_charges: pyRound(nbcs, 2),
    adder_charges: pyRound(adders, 2),
    adders: { fixed_recovery: pyRound(adders / 2, 2), program_charge: pyRound(adders / 2, 2) },
    nem_energy_balance: pyRound(energy, 2),
    energy_charges: pyRound(rows.filter((r) => r.amount > 0).reduce((a, r) => a + r.amount, 0), 2),
    energy_credits: pyRound(rows.filter((r) => r.amount < 0).reduce((a, r) => a + r.amount, 0), 2),
    due_this_cycle_mbo: pyRound(base + nbcs + adders + Math.max(energy, 0), 2),
    credit_carried_forward: pyRound(Math.min(energy, 0), 2),
    due_monthly_minimum: pyRound(base + nbcs + adders, 2),
    import_kwh: pyRound(imp, 2),
    export_kwh: pyRound(exp, 2),
    periods: rows,
    nem: "nem2",
    note: "Estimate for this cycle.",
  });

  sf("sensor", "data_age", Math.round(ageMs / 1000) + 4, {
    unit_of_measurement: "s",
    device_class: "duration",
  }, { category: "diagnostic", updated: srcIso });

  // health
  sf("sensor", "panel_health", health, {});
  sf("binary_sensor", "solar_problem", opts.problem ? "on" : "off", {
    device_class: "problem",
    findings: health,
    problem_since: opts.problem ? new Date(now - 45 * 60_000).toISOString() : null,
  });

  // battery (beta)
  if (battery) {
    sf("sensor", "battery_soc", sim.battery_soc, { unit_of_measurement: "%", device_class: "battery" });
    sf("sensor", "battery_power", w(sim.battery_kw), W, { updated: srcIso });
    sf("sensor", "battery_charge_power", w(Math.max(-sim.battery_kw, 0)), W, { updated: srcIso });
    sf("sensor", "battery_discharge_power", w(Math.max(sim.battery_kw, 0)), W, { updated: srcIso });
  }

  // cars: DayMill's own two entities, plus the car's own integration
  // entities that a house card config would point at.
  sim.cars.slice(0, carCount).forEach((car, i) => {
    const slug = slugify(car.name);
    sf("binary_sensor", `car_${slug}_charging_at_home`, car.charging && car.home ? "on" : "off", { device_class: "battery_charging" }, {
      translationKey: "car_charging_at_home",
      name: `${car.name} charging at home`,
    });
    sf("sensor", `car_${slug}_home_charging_power`, car.charging && car.home ? car.power_kw : 0, {
      unit_of_measurement: "kW",
      device_class: "power",
      state_class: "measurement",
    }, { translationKey: "car_home_charging_power", name: `${car.name} home charging power` });
    const reg = { platform: "example_car", device_id: `car_${i + 1}`, labels: [] };
    add(`device_tracker.${slug}`, car.home ? "home" : "not_home", { friendly_name: car.name }, { reg });
    add(`sensor.${slug}_battery`, car.soc, { friendly_name: `${car.name} battery`, unit_of_measurement: "%", device_class: "battery" }, { reg });
    add(`sensor.${slug}_charge_limit`, car.limit, { friendly_name: `${car.name} charge limit`, unit_of_measurement: "%" }, { reg });
    add(`binary_sensor.${slug}_plugged_in`, car.plugged ? "on" : "off", { friendly_name: `${car.name} plugged in`, device_class: "plug" }, { reg });
  });

  add("sun.sun", sim.is_day ? "above_horizon" : "below_horizon", {
    friendly_name: "Sun",
    elevation: sim.sun_elevation,
    rising: false,
  }, { reg: { platform: "sun", labels: [] } });

  // Look-alikes from other integrations: cards must not pick these up.
  if (opts.decoys !== false) {
    const reg = { platform: "template", translation_key: "solar_power", labels: [] };
    add("sensor.solar_power", 99999, { ...W, friendly_name: "Other solar power" }, { reg });
    add("sensor.grid_power", -99999, { ...W, friendly_name: "Other grid power" }, { reg: { ...reg, translation_key: "grid_power" } });
  }

  const ids = (key) => Object.values(entities).filter((e) => e.platform === platform && e.translation_key === key).map((e) => e.entity_id);
  const calls = [];

  const hass = {
    states,
    entities,
    devices: {
      [DEVICE_ID]: { id: DEVICE_ID, name: "DayMill", manufacturer: "DayMill", model: "Simulator", area_id: null, labels: [] },
    },
    areas: {},
    floors: {},
    config: {
      currency,
      time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      unit_system: { length: "mi", mass: "lb", temperature: "°F", volume: "gal" },
      country: "US",
      language,
      version: "2026.10.0",
      components: ["daymill", "history", "recorder", "sun"],
    },
    language,
    selectedLanguage: language,
    locale: { language, number_format: "language", time_format: "language", date_format: "language", time_zone: "local", first_weekday: "language" },
    themes: { darkMode: opts.dark !== false, theme: "default", themes: {} },
    selectedTheme: null,
    user: { id: "demo", name: "Demo", is_admin: true, is_owner: true },
    panelUrl: "lovelace",
    hassUrl: (path = "") => path,
    localize: (key) => key,
    _calls: calls,
    _now: now,

    callWS(msg) {
      calls.push(msg);
      if (msg.type === "history/history_during_period") return Promise.resolve(fakeHistory(msg, ids, scenario, now, sim));
      if (msg.type === "recorder/statistics_during_period") return Promise.resolve(fakeStatistics(msg, ids, scenario, now));
      return Promise.reject(new Error(`fake hass: no handler for ${msg.type}`));
    },
    callService(domain, service, data) {
      calls.push({ type: "call_service", domain, service, data });
      return Promise.resolve({ context: { id: "fake" } });
    },
    callApi(method, path) {
      calls.push({ type: "call_api", method, path });
      return Promise.resolve({});
    },
    fetchWithAuth() {
      return Promise.reject(new Error("fake hass: no network"));
    },
    connection: {
      subscribeMessage(cb, msg) {
        calls.push(msg);
        if (msg.type === "history/stream") {
          const data = fakeHistory(msg, ids, scenario, now, sim);
          queueMicrotask(() => cb({ states: data, start_time: Date.parse(msg.start_time) / 1000, end_time: now / 1000 }));
        }
        return Promise.resolve(() => {});
      },
      subscribeEvents() {
        return Promise.resolve(() => {});
      },
    },
  };
  return hass;
}

// ---- history / statistics ----

// Which simulated series feeds which entity.
function seriesFor(ids) {
  const map = {};
  const put = (key, field, scale) => {
    for (const id of ids(key)) map[id] = { field, scale };
  };
  put("solar_power", "solar_kw", 1000);
  put("home_power", "home_kw", 1000);
  put("grid_power", "grid_kw", 1000);
  put("battery_power", "battery_kw", 1000);
  put("grid_import_power", "import", 1000);
  put("grid_export_power", "export", 1000);
  put("import_rate", "import_rate", 1);
  put("export_rate", "export_rate", 1);
  return map;
}

function sample(p, field) {
  if (field === "import") return Math.max(p.grid_kw, 0);
  if (field === "export") return Math.max(-p.grid_kw, 0);
  if (field === "import_rate" || field === "export_rate") {
    const r = periodAt(p.t);
    return field === "import_rate" ? r.import : exportPrice(r.period);
  }
  return p[field];
}

// Bend the last hour of history so it ends on the live snapshot; otherwise
// the chart jumps at "now" and its legend disagrees with the other cards.
const TAIL_MS = 3_600_000;
function meetSnapshot(pts, sim, now) {
  const last = pts.at(-1);
  if (!sim || !last || now - last.t > TAIL_MS) return pts;
  const keys = ["solar_kw", "home_kw", "battery_kw"];
  const delta = Object.fromEntries(keys.map((k) => [k, (sim[k] ?? last[k]) - last[k]]));
  const out = pts.map((p) => {
    const w = Math.max(0, 1 - (last.t - p.t) / TAIL_MS);
    if (!w) return p;
    const q = { ...p };
    for (const k of keys) q[k] = pyRound(Math.max(k === "battery_kw" ? -Infinity : 0, p[k] + delta[k] * w), 3);
    q.grid_kw = pyRound(q.home_kw - q.solar_kw - q.battery_kw, 3);
    return q;
  });
  // the newest point is the snapshot itself
  out.push({ t: now, solar_kw: sim.solar_kw, home_kw: sim.home_kw, battery_kw: sim.battery_kw, grid_kw: sim.grid_kw });
  return out;
}

export function fakeHistory(msg, ids, scenario, now, sim) {
  const start = Date.parse(msg.start_time);
  const end = msg.end_time ? Date.parse(msg.end_time) : now;
  const hours = Math.max(1, Math.ceil((end - start) / 3_600_000));
  let pts = powerHistory({ scenario, now: end, hours }).filter((p) => p.t >= start);
  if (end >= now) pts = meetSnapshot(pts, sim, now);
  const map = seriesFor(ids);
  const out = {};
  for (const id of msg.entity_ids) {
    const src = map[id];
    if (!src) continue;
    let prev;
    out[id] = [];
    for (const p of pts) {
      const v = pyRound(sample(p, src.field) * src.scale, src.scale === 1 ? 5 : 0);
      if (v === prev) continue; // history only stores changes
      prev = v;
      out[id].push({ s: String(v), lu: p.t / 1000 });
    }
  }
  return out;
}

const STAT_FIELD = {
  energy_produced: "produced",
  energy_consumed: "used",
  energy_imported: "imported",
  energy_exported: "exported",
  net_cost: "net_cost",
  solar_savings: "savings",
};

export function fakeStatistics(msg, ids, scenario, now) {
  const start = Date.parse(msg.start_time);
  const end = msg.end_time ? Date.parse(msg.end_time) : now;
  const out = {};
  const byId = {};
  for (const [key, field] of Object.entries(STAT_FIELD)) for (const id of ids(key)) byId[id] = field;
  const days = Math.max(1, Math.ceil((end - start) / 86_400_000) + 1);

  let rows;
  if (msg.period === "hour" || msg.period === "5minute") {
    const step = msg.period === "hour" ? 60 : 5;
    const pts = powerHistory({ scenario, now: end, hours: Math.ceil((end - start) / 3_600_000) + 1, stepMin: step });
    rows = pts
      .filter((p) => p.t >= start && p.t < end)
      .map((p) => {
        const h = step / 60;
        const imp = Math.max(p.grid_kw, 0) * h;
        const exp = Math.max(-p.grid_kw, 0) * h;
        const r = periodAt(p.t);
        return {
          start: p.t,
          end: p.t + step * 60_000,
          produced: p.solar_kw * h,
          used: p.home_kw * h,
          imported: imp,
          exported: exp,
          net_cost: imp * r.import - exp * exportPrice(r.period),
          savings: Math.min(p.solar_kw, p.home_kw) * h * r.import,
        };
      });
  } else {
    const daily = dailyHistory({ scenario, now: end, days }).filter((d) => d.start + 86_400_000 > start);
    rows = daily.map((d) => ({ ...d, end: d.start + 86_400_000 }));
    if (msg.period === "week" || msg.period === "month") {
      const groups = new Map();
      for (const d of rows) {
        const dt = new Date(d.start);
        let key;
        if (msg.period === "month") key = new Date(dt.getFullYear(), dt.getMonth(), 1).getTime();
        else {
          const k = new Date(dt);
          k.setDate(k.getDate() - ((k.getDay() + 6) % 7));
          key = k.getTime();
        }
        const g = groups.get(key) || { start: key, end: d.end, produced: 0, used: 0, imported: 0, exported: 0, net_cost: 0, savings: 0 };
        for (const f of Object.values(STAT_FIELD)) g[f] += d[f];
        g.end = d.end;
        groups.set(key, g);
      }
      rows = [...groups.values()];
    }
  }

  for (const id of msg.statistic_ids) {
    const field = byId[id];
    if (!field) continue;
    let running = 1000;
    out[id] = rows.map((r) => {
      const change = pyRound(r[field], 4);
      running += change;
      const row = { start: r.start, end: r.end };
      for (const type of msg.types || ["change"]) {
        if (type === "change") row.change = change;
        else if (type === "sum" || type === "state") row[type] = pyRound(running, 4);
        else if (type === "mean" || type === "min" || type === "max") row[type] = change;
      }
      return row;
    });
  }
  return out;
}
