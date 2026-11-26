// Quick checks that need no browser:
//   - simulator.js gives the same numbers as simulator.py
//   - entity lookup, formatting and the websocket helpers against the fake hass
//
//   node test/check.mjs            (set PYTHON to a Python that can import homeassistant)

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SCENARIOS, TIMES, pyRound, simulate } from "../src/common/simulator.js";
import { createFakeHass } from "./fake-hass.js";
import * as E from "../src/common/entities.js";
import * as F from "../src/common/format.js";
import * as WS from "../src/common/ws.js";
import * as L from "../src/cards/house/layout.js";
import * as Z from "../src/cards/chart/zone.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
let failed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${err.message.split("\n").join("\n      ")}`);
  }
};

// ---- simulator parity ----

const TS = [0, 7.5, 13, 61, 600, 1234.5, 86400];
await check("pyRound matches Python rounding on ties", () => {
  assert.equal(pyRound(0.125, 2), 0.12);
  assert.equal(pyRound(0.375, 2), 0.38);
  assert.equal(pyRound(2.5), 2);
  assert.equal(pyRound(3.5), 4);
  assert.equal(pyRound(-2.5), -2);
  assert.equal(pyRound(2.675, 2), 2.67); // 2.67499999... in binary
  assert.equal(pyRound(1.0005, 3), 1.0); // 1.000499999... in binary
});

await check("simulate() matches simulator.py", () => {
  const python = process.env.PYTHON || "python3";
  const code = `
import json, sys
from custom_components.daymill.simulator import SCENARIOS, TIMES, simulate
ts = json.loads(sys.argv[1])
out = {f"{s}|{d}|{t}": simulate(s, d, t) for s in SCENARIOS for d in TIMES for t in ts}
print(json.dumps({"scenarios": list(SCENARIOS), "times": list(TIMES), "out": out}))
`;
  let py;
  try {
    py = JSON.parse(execFileSync(python, ["-c", code, JSON.stringify(TS)], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  } catch (err) {
    throw new Error(`could not run Python (${python}); set PYTHON. ${String(err.stderr || err.message).trim().split("\n").pop()}`);
  }
  assert.deepEqual(py.scenarios, SCENARIOS);
  assert.deepEqual(py.times, TIMES);
  let n = 0;
  for (const s of SCENARIOS) {
    for (const d of TIMES) {
      for (const t of TS) {
        assert.deepEqual(simulate(s, d, t), py.out[`${s}|${d}|${t}`], `${s} ${d} t=${t}`);
        n++;
      }
    }
  }
  console.log(`      ${n} snapshots identical`);
});

// ---- entities ----

const hass = createFakeHass({ scenario: "car-charging", time: "day", battery: true });

await check("registry lookup by translation_key ignores other platforms", () => {
  assert.equal(E.entityId(hass, "solar_power"), "sensor.daymill_solar_power");
  assert.equal(E.entityId(hass, "grid_power"), "sensor.daymill_grid_power");
  assert.equal(E.entityId(hass, "nope"), undefined);
  assert.equal(E.entityId(hass, "solar_power", { solar_power: "sensor.other" }), "sensor.other");
  assert.ok(E.hasDayMill(hass));
  assert.ok(!E.hasDayMill({ entities: {}, states: {} }));
  const r = E.resolve(hass, ["solar_power", "battery_soc", "missing"]);
  assert.deepEqual(Object.keys(r), ["solar_power", "battery_soc"]);
});

await check("lookup survives renamed entity ids", () => {
  const h = createFakeHass();
  const old = "sensor.daymill_cost_today";
  const renamed = "sensor.my_daily_cost";
  h.states[renamed] = { ...h.states[old], entity_id: renamed };
  h.entities[renamed] = { ...h.entities[old], entity_id: renamed };
  delete h.states[old];
  delete h.entities[old];
  assert.equal(E.entityId(h, "cost_today"), renamed);
});

await check("cars pair up by slug", () => {
  const cars = E.daymillCars(hass);
  assert.equal(cars.length, 2);
  assert.deepEqual(cars[0], {
    slug: "car_1",
    charging: "binary_sensor.daymill_car_car_1_charging_at_home",
    power: "sensor.daymill_car_car_1_home_charging_power",
    name: "Car 1",
  });
  assert.ok(E.isOn(hass, cars[0].charging));
  assert.ok(!E.isOn(hass, cars[1].charging));
});

await check("state readers and units", () => {
  const id = "sensor.daymill_solar_power";
  assert.equal(E.powerKw(hass, id), simulate("car-charging", "day").solar_kw);
  assert.equal(E.toKw(1500, "W"), 1.5);
  assert.equal(E.toKw(2, "MW"), 2000);
  assert.equal(E.toKwh(500, "Wh"), 0.5);
  assert.equal(E.num(hass, "sensor.missing"), undefined);
  const h = createFakeHass();
  h.states[id] = { ...h.states[id], state: "unavailable" };
  assert.equal(E.powerKw(h, id), undefined);
  assert.equal(E.attr(hass, "sensor.daymill_tou_period", "season"), "summer");
  assert.equal(E.numAttr(hass, "sensor.daymill_totals", "produced_today"), simulate("car-charging", "day").produced_today);
});

await check("data age and staleness inputs", () => {
  const h = createFakeHass({ staleMinutes: 20 });
  const age = E.dataAge(h, undefined, ["sensor.daymill_solar_power"], h._now);
  assert.ok(Math.abs(age - 1200) < 1, `age ${age}`);
  const fresh = createFakeHass();
  assert.ok(E.dataAge(fresh, undefined, ["sensor.daymill_solar_power"], fresh._now) < 10);
});

// ---- format ----

await check("formatting follows HA currency and locale", () => {
  assert.equal(F.money(hass, 1.5), "$1.50");
  assert.equal(F.money(hass, -0.62), "-$0.62");
  assert.equal(F.price(hass, 0.2641), "$0.2641/kWh");
  assert.equal(F.price(hass, 0.3), "$0.30/kWh");
  assert.equal(F.kw(hass, 2.07), "2.07 kW");
  assert.equal(F.kw(hass, 0.4, { unit: "auto" }), "400 W");
  assert.equal(F.kwh(hass, 12.345), "12.3 kWh");
  assert.equal(F.pct(hass, 42), "42%");
  assert.equal(F.money(hass, undefined), F.DASH);
  const eu = createFakeHass({ currency: "EUR", language: "de" });
  assert.equal(F.money(eu, 1234.5).replace(/\s/g, " "), "1.234,50 €");
  assert.equal(F.kw(eu, 2.5), "2,50 kW");
});

await check("number format from the HA profile", () => {
  const withFormat = (number_format) => ({ ...hass, locale: { ...hass.locale, language: "en", number_format } });
  assert.equal(F.num(withFormat("decimal_comma"), 1234.5, 1), "1.234,5");
  assert.equal(F.num(withFormat("comma_decimal"), 1234.5, 1), "1,234.5");
  assert.equal(F.num(withFormat("space_comma"), 1234.5, 1).replace(/\s/g, " "), "1 234,5");
  assert.equal(F.num(withFormat("none"), 1234.5, 1), "1234.5");
  assert.equal(F.money(withFormat("decimal_comma"), 1234.5).replace(/\s/g, " "), "1.234,50 $");
  assert.equal(F.num(withFormat("language"), 1234.5, 1), "1,234.5");
});

await check("path start points", () => {
  assert.deepEqual(L.scalePath("M0.5,0.25 C0.1,0.2 0.3,0.4 0.6,0.7", 1600, 1000).start, [800, 250]);
  assert.deepEqual(L.scalePath("M0.1,0.2 L0.3,0.4 M0.9,0.9", 100, 100).start, [10, 20]);
});

await check("cars DayMill finds on its own", () => {
  const n = L.normalizeConfig({});
  const car = L.placeCar(n.autoCar({ name: "A", flip: true }, 1), 1.6);
  assert.ok(car.flip);
  // the cable starts on the wall beside the car, above the car's top
  assert.ok(car.startPt[0] > car.slot.x + car.slot.w);
  assert.ok(car.startPt[1] < car.slot.y);
});

await check("calendar days in the server time zone", () => {
  assert.equal(new Date(Z.midnight(2026, 10, 24, "America/Los_Angeles")).toISOString(), "2026-11-24T08:00:00.000Z");
  assert.equal(new Date(Z.midnight(2026, 2, 8, "America/Los_Angeles")).toISOString(), "2026-03-08T08:00:00.000Z"); // DST starts that day
  assert.equal(new Date(Z.midnight(2026, 2, 9, "America/Los_Angeles")).toISOString(), "2026-03-09T07:00:00.000Z");
  assert.equal(new Date(Z.midnight(2026, 0, 1, "Asia/Kolkata")).toISOString(), "2025-12-31T18:30:00.000Z");
  assert.equal(Z.calendarDay(Date.parse("2026-11-24T07:59:00Z"), "America/Los_Angeles").toISOString().slice(0, 10), "2026-11-23");
  assert.equal(Z.offset(Date.parse("2026-07-01T00:00:00Z"), "Europe/Berlin"), 2 * 3_600_000);
});

await check("string table", () => {
  F.setLanguage("en");
  assert.equal(F.t("head_export", { power: "2 kW" }), "Sending 2 kW to the grid");
  assert.equal(F.t("unknown_key"), "unknown_key");
  F.addStrings("xx", { solar: "Sol" });
  F.setLanguage("xx-YY");
  assert.equal(F.t("solar"), "Sol");
  assert.equal(F.t("home"), "Home"); // falls back to English
  F.setLanguage("en");
  assert.equal(F.periodLabel("super_off_peak"), "Super Off-Peak");
  assert.equal(F.periodLabel("shoulder"), "Shoulder");
  assert.equal(F.periodLabel("on_peak", "Peak"), "Peak");
});

// ---- websocket helpers ----

await check("history fetch, cache and series", async () => {
  WS.clearCache();
  const start = WS.hoursAgo(24, hass._now);
  const ids = ["sensor.daymill_solar_power", "sensor.daymill_home_power"];
  const a = await WS.fetchHistory(hass, { entityIds: ids, start });
  const b = await WS.fetchHistory(hass, { entityIds: ids, start });
  assert.equal(a, b, "second call should come from the cache");
  assert.equal(hass._calls.filter((c) => c.type === "history/history_during_period").length, 1);
  const solar = WS.toSeries(a["sensor.daymill_solar_power"], (w) => w / 1000);
  assert.ok(solar.length > 50, `points ${solar.length}`);
  assert.ok(Math.max(...solar.map((p) => p.v)) > 3);
});

await check("statistics fetch by day and hour", async () => {
  const ids = ["sensor.daymill_energy_produced", "sensor.daymill_energy_imported"];
  const day = await WS.fetchStatistics(hass, { statisticIds: ids, start: WS.startOfDay(new Date(hass._now), 6), period: "day" });
  assert.equal(day["sensor.daymill_energy_produced"].length, 7);
  assert.ok(WS.statTotal(day["sensor.daymill_energy_produced"]) > 50);
  const month = await WS.fetchStatistics(hass, { statisticIds: ids, start: WS.startOfDay(new Date(hass._now), 90), period: "month", types: ["change", "sum"] });
  assert.ok(month["sensor.daymill_energy_imported"].length >= 3);
  assert.ok("sum" in month["sensor.daymill_energy_imported"][0]);
  const hour = await WS.fetchStatistics(hass, { statisticIds: ids, start: WS.hoursAgo(24, hass._now, 60), end: hass._now, period: "hour" });
  assert.ok(hour["sensor.daymill_energy_produced"].length >= 23);
});

await check("history stream subscription", async () => {
  const got = await new Promise((resolve) => {
    // a full day, so the series has daytime changes whatever time the test runs
    WS.subscribeHistory(hass, { entityIds: ["sensor.daymill_grid_power"], start: WS.hoursAgo(24, hass._now) }, resolve);
  });
  assert.ok(got["sensor.daymill_grid_power"].length > 5);
});

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall good");
