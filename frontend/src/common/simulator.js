// Synthetic data for the demo, the editor preview and tests.
//
// simulate() is a line-for-line port of custom_components/daymill/simulator.py
// (and the few helpers it uses from sources.py). Keep the two in sync: the
// Python tests and test/sim-check.mjs compare them.
//
// The history helpers at the bottom are JS only. They make a plausible day
// curve around the snapshot so charts have something to draw.

export const SCENARIOS = [
  "normal",
  "high-generation",
  "high-usage",
  "car-charging",
  "both-plugged",
  "car-away",
  "cloudy",
  "battery-charging",
  "battery-discharging",
];
export const TIMES = ["day", "night"];

export const BATTERY_CAPACITY_KWH = 13.5;
export const BASE_CHARGE = 0.5;

// scenario -> [solar_day, home_day, home_night, battery_day, battery_night]
const BASE = {
  "normal": [5.2, 1.6, 1.9, 0.0, 0.0],
  "high-generation": [9.4, 1.2, 1.6, 0.0, 0.0],
  "high-usage": [5.2, 6.8, 5.4, 0.0, 0.0],
  "car-charging": [5.2, 1.6, 1.9, 0.0, 0.0],
  "both-plugged": [5.2, 1.6, 1.9, 0.0, 0.0],
  "car-away": [5.2, 1.4, 1.7, 0.0, 0.0],
  "cloudy": [1.1, 1.6, 1.9, 0.0, 0.0],
  // at night the charged battery just sits; it never charges from the grid
  "battery-charging": [6.5, 1.5, 1.5, -3.0, 0.0],
  "battery-discharging": [0.8, 2.4, 2.4, 2.0, 2.4],
};

// scenario -> [soc by day, soc at night]
const BATTERY_SOC = { "battery-charging": [55.0, 95.0], "battery-discharging": [70.0, 70.0] };
const BATTERY_SOC_DEFAULT = 80.0;

export const RATES = {
  day: { period: "off_peak", label: "Off-Peak", import: 0.31, export: 0.05 },
  night: { period: "on_peak", label: "On-Peak", import: 0.52, export: 0.09 },
};

const TODAY = { day: [18.0, 14.0], night: [32.0, 30.0] };
const SELF_USE_SHARE = 0.55;
// Share of the day's use that happened while the sun was up. After sunset
// everything comes from the grid (or the battery), so at night solar can't
// have covered more than this.
const DAYLIGHT_USE = { day: 1.0, night: 0.5 };

// Car slots: [name, charger kW, soc when charging, soc when idle, limit]
const CARS = [
  ["Car 1", 7.2, 46.0, 80.0, 80.0],
  ["Car 2", 9.6, 58.0, 90.0, 90.0],
];

// scenario -> per-car mode: "charging", "full" (plugged, at limit), "home", "away"
const CAR_MODES = {
  "car-charging": ["charging", "home"],
  "both-plugged": ["charging", "full"],
  "car-away": ["away", "home"],
};
const CAR_MODES_DEFAULT = ["full", "home"];

const CAR_HOURS_TODAY = { day: 1.5, night: 3.0 };

// ---- helpers mirrored from sources.py ----

const STATUS_THRESHOLD_KW = 0.025;

// Python's round(): correctly rounded, ties to even.
export function pyRound(x, n = 0) {
  if (!Number.isFinite(x)) return x;
  const abs = Math.abs(x);
  const exact = abs.toFixed(Math.min(100, n + 60));
  const [ip, fp = ""] = exact.split(".");
  const tail = fp.slice(n);
  let out;
  if (/^50*$/.test(tail)) {
    let digits = BigInt(ip + fp.slice(0, n));
    if (digits % 2n === 1n) digits += 1n;
    const str = digits.toString().padStart(n + 1, "0");
    out = Number(n ? `${str.slice(0, -n)}.${str.slice(-n)}` : str);
  } else {
    out = Number(abs.toFixed(n));
  }
  return x < 0 ? -out : out;
}

// Python's f"{x:.2f}".
const fixed = (x, n) => pyRound(x, n).toFixed(n);

export const gridImportKw = (grid) => Math.max(grid, 0.0);
export const gridExportKw = (grid) => Math.max(-grid, 0.0);

export function selfSufficiency(solar, home) {
  if (home <= 0) return 100;
  return pyRound((Math.min(solar, home) / home) * 100);
}

export function status(solar, grid) {
  if (grid < -STATUS_THRESHOLD_KW) return "Exporting";
  if (solar > STATUS_THRESHOLD_KW) return "Producing";
  return "Importing";
}

export function statusSummary(solar, grid, home) {
  let gridText;
  if (grid < -STATUS_THRESHOLD_KW) gridText = `exporting ${fixed(-grid, 2)} kW`;
  else if (grid > STATUS_THRESHOLD_KW) gridText = `importing ${fixed(grid, 2)} kW`;
  else gridText = "grid balanced";
  return `Solar ${fixed(solar, 2)} kW, home ${fixed(home, 2)} kW, ${gridText}`;
}

// ---- simulator ----

const wave = (t, period, phase = 0.0) => Math.sin((2 * Math.PI * t) / period + phase);

export function normalizeScenario(scenario) {
  const key = String(scenario).trim().toLowerCase().replace(/_/g, "-");
  if (!(key in BASE)) throw new Error(`unknown scenario: ${scenario}`);
  return key;
}

function cars(scenario, t) {
  const modes = CAR_MODES[scenario] || CAR_MODES_DEFAULT;
  const socDrift = 0.5 * wave(t, 600);
  return CARS.map(([name, chargerKw, socCharging, socIdle, limit], i) => {
    const mode = modes[i];
    const charging = mode === "charging";
    let power;
    let soc;
    if (charging) {
      power = pyRound(chargerKw + 0.05 * wave(t, 31), 3);
      soc = pyRound(Math.min(socCharging + socDrift, limit), 1);
    } else {
      power = 0.0;
      // A full car sits at its limit; an unplugged one floats below it.
      soc = mode === "full" ? limit : pyRound(Math.min(socIdle - 12 + socDrift, limit), 1);
    }
    return {
      name,
      home: mode !== "away",
      plugged: mode === "charging" || mode === "full",
      charging,
      power_kw: power,
      soc,
      limit,
    };
  });
}

// One snapshot of synthetic values. Same keys and numbers as simulator.py.
export function simulate(scenario = "normal", timeOfDay = "day", t = 0.0) {
  const key = normalizeScenario(scenario);
  const tod = String(timeOfDay).trim().toLowerCase();
  if (!TIMES.includes(tod)) throw new Error(`unknown time_of_day: ${timeOfDay}`);
  const isDay = tod === "day";

  const [solarBase, homeDay, homeNight, battDay, battNight] = BASE[key];
  let solar;
  if (isDay) {
    const [amp, period] = key === "cloudy" ? [0.3, 23.0] : [0.04, 90.0];
    solar = solarBase * (1 + amp * wave(t, period));
  } else {
    solar = 0.0;
  }
  const homeBase = (isDay ? homeDay : homeNight) * (1 + 0.06 * wave(t, 47, 1.0));

  const carList = cars(key, t);
  const carKw = carList.reduce((a, c) => a + c.power_kw, 0);
  let home = homeBase + carKw;

  let battery = isDay ? battDay : battNight;
  const [socDay, socNight] = BATTERY_SOC[key] ?? [BATTERY_SOC_DEFAULT, BATTERY_SOC_DEFAULT];
  const batterySoc = (isDay ? socDay : socNight) + 0.5 * wave(t, 600);

  solar = pyRound(solar, 3);
  home = pyRound(home, 3);
  battery = pyRound(battery, 3);
  const grid = pyRound(home - solar - battery, 3);

  const rate = RATES[tod];
  const price = grid > 0 ? rate.import : rate.export;

  // Today totals, scaled from "normal".
  const [nSolar, nHomeDay, nHomeNight] = BASE.normal;
  const [baseProd, baseUsed] = TODAY[tod];
  const nHome = isDay ? nHomeDay : nHomeNight;
  const produced = baseProd * (solarBase / nSolar);
  const carKwh = carList.filter((c) => c.charging).reduce((a, c) => a + c.power_kw * CAR_HOURS_TODAY[tod], 0);
  const used = baseUsed * ((isDay ? homeDay : homeNight) / nHome) + carKwh;
  const selfUsed = Math.min(produced * SELF_USE_SHARE, used * DAYLIGHT_USE[tod]);
  const exported = produced - selfUsed;
  const imported = used - selfUsed;
  const costToday = imported * rate.import - exported * rate.export + BASE_CHARGE;

  return {
    scenario: key,
    time_of_day: tod,
    is_day: isDay,
    sun_elevation: isDay ? 45.0 : -20.0,
    solar_kw: solar,
    grid_kw: grid,
    home_kw: home,
    grid_import_kw: pyRound(gridImportKw(grid), 3),
    grid_export_kw: pyRound(gridExportKw(grid), 3),
    self_sufficiency: selfSufficiency(solar, home),
    status: status(solar, grid),
    summary: statusSummary(solar, grid, home),
    battery_kw: battery,
    battery_soc: pyRound(batterySoc, 1),
    battery_capacity_kwh: BATTERY_CAPACITY_KWH,
    cars: carList,
    period: rate.period,
    period_label: rate.label,
    rate: rate.import,
    import_rate: rate.import,
    export_rate: rate.export,
    cost_rate: pyRound(grid * price, 3),
    cost_today: pyRound(costToday, 2),
    produced_today: pyRound(produced, 2),
    used_today: pyRound(used, 2),
    imported_today: pyRound(imported, 2),
    exported_today: pyRound(exported, 2),
    self_sufficiency_today: used > 0 ? pyRound((selfUsed / used) * 100) : 100,
  };
}

// ---- history (JS only) ----

const SUNRISE = 6.5;
const SUNSET = 18.0;

// Solar kW at a local hour for a scenario's peak, a smooth bell over daylight.
function solarAt(peak, hour, cloudy, seed) {
  if (hour <= SUNRISE || hour >= SUNSET) return 0;
  const x = (hour - SUNRISE) / (SUNSET - SUNRISE);
  let kw = peak * Math.sin(Math.PI * x) ** 1.5;
  if (cloudy) kw *= 0.75 + 0.25 * Math.sin(hour * 5.3 + seed);
  return Math.max(0, kw);
}

// Home load: night base, small morning bump, bigger evening bump.
function homeAt(dayKw, nightKw, hour) {
  const base = hour >= 7 && hour < 17 ? dayKw : nightKw;
  const morning = 0.6 * Math.exp(-((hour - 7.5) ** 2) / 0.8);
  const evening = 1.2 * Math.exp(-((hour - 19) ** 2) / 2.5);
  return base * 0.8 + morning + evening;
}

// 24 h of power samples ending at `now`, every stepMin minutes.
// Returns [{t, solar_kw, home_kw, grid_kw, battery_kw}].
export function powerHistory({ scenario = "normal", now = Date.now(), hours = 24, stepMin = 5 } = {}) {
  const key = normalizeScenario(scenario);
  const [solarPeak, homeDay, homeNight, battDay, battNight] = BASE[key];
  const modes = CAR_MODES[key] || CAR_MODES_DEFAULT;
  const chargingKw = CARS.reduce((a, c, i) => a + (modes[i] === "charging" ? c[1] : 0), 0);
  const step = stepMin * 60_000;
  const end = Math.floor(now / step) * step;
  const out = [];
  for (let ts = end - hours * 3_600_000; ts <= end; ts += step) {
    const d = new Date(ts);
    const hour = d.getHours() + d.getMinutes() / 60;
    const solar = solarAt(solarPeak / 0.92, hour, key === "cloudy", d.getDate());
    // cars charge late morning, when solar is good
    const car = chargingKw && hour >= 10 && hour < 12.5 ? chargingKw : 0;
    const home = homeAt(homeDay, homeNight, hour) + car;
    const day = hour >= SUNRISE && hour < SUNSET;
    const battery = day ? battDay * Math.min(1, solar / 2) : battNight;
    out.push({
      t: ts,
      solar_kw: pyRound(solar, 3),
      home_kw: pyRound(home, 3),
      battery_kw: pyRound(battery, 3),
      grid_kw: pyRound(home - solar - battery, 3),
    });
  }
  return out;
}

// Per-day totals for the last `days` days (oldest first), today last and partial.
// Returns [{start, produced, used, imported, exported, net_cost, savings}].
export function dailyHistory({ scenario = "normal", now = Date.now(), days = 30 } = {}) {
  const key = normalizeScenario(scenario);
  const [solarPeak, homeDay, homeNight] = BASE[key];
  const nPeak = BASE.normal[0];
  const out = [];
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const n = Math.floor(d.getTime() / 86_400_000);
    const weather = 0.8 + 0.2 * Math.sin(n * 1.7) * Math.cos(n * 0.6);
    const share = i === 0 ? Math.min(1, (now - d.getTime()) / 86_400_000) : 1;
    const produced = 32 * (solarPeak / nPeak) * weather * share;
    const used = (13 * homeDay + 11 * homeNight) * (0.95 + 0.08 * Math.sin(n * 2.3)) * share;
    const selfUsed = Math.min(produced * 0.45, used);
    const exported = produced - selfUsed;
    const imported = used - selfUsed;
    const netCost = imported * RATES.night.import * 0.7 - exported * RATES.day.export * 1.6 + BASE_CHARGE * share;
    out.push({
      start: d.getTime(),
      produced: pyRound(produced, 3),
      used: pyRound(used, 3),
      imported: pyRound(imported, 3),
      exported: pyRound(exported, 3),
      net_cost: pyRound(netCost, 2),
      savings: pyRound(selfUsed * RATES.day.import, 2),
    });
  }
  return out;
}
