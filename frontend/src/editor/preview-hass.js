// Preview data for the editor. Takes the real hass and lays simulator values
// over it, so every flow, chip and car can be seen while placing things.
// Only the copy handed to the preview card changes; nothing is written to HA.

import { PLATFORM, entityId } from "../common/entities.js";
import { simulate } from "../common/simulator.js";
import { ROLES } from "./model.js";

export const PREVIEW_KEYS = [
  "solar_power",
  "grid_power",
  "home_power",
  "import_rate",
  "cost_rate",
  "cost_today",
  "totals",
  "data_age",
  "battery_soc",
  "battery_power",
];

const ROLE_DOMAIN = {
  presence_entity: "device_tracker",
  charging_entity: "binary_sensor",
  power_entity: "sensor",
  battery_entity: "sensor",
  plugged_entity: "binary_sensor",
  limit_entity: "sensor",
};

// Every car gets an entity for each role, so the preview can show it
// parked, plugged in or charging. Real ids are kept where the car has them.
export function previewCars(cars) {
  return cars.map((c, i) => {
    const out = { ...c };
    for (const r of ROLES) if (!out[r]) out[r] = `${ROLE_DOMAIN[r]}.sunflow_preview_car${i + 1}_${r.replace("_entity", "")}`;
    return out;
  });
}

// {hass, ids} for a scenario. cars: the preview car list (from previewCars).
export function previewHass(hass, { scenario = "normal", time = "day", overrides, cars = [], battery = false } = {}) {
  const sim = simulate(scenario, time);
  const now = new Date().toISOString();
  const states = { ...(hass?.states || {}) };
  const entities = { ...(hass?.entities || {}) };
  const currency = hass?.config?.currency || "USD";
  const ids = {};

  const put = (id, value, attributes = {}) => {
    const old = states[id];
    states[id] = {
      entity_id: id,
      state: String(value),
      attributes: { ...(old?.attributes || {}), ...attributes },
      last_changed: now,
      last_updated: now,
      last_reported: now,
      context: { id: "preview", parent_id: null, user_id: null },
    };
  };

  const want = battery || String(sim.scenario).startsWith("battery");
  for (const key of PREVIEW_KEYS) {
    if (key.startsWith("battery") && !want) continue;
    let id = entityId(hass, key, overrides);
    if (!id) {
      id = `sensor.sunflow_preview_${key}`;
      entities[id] = { entity_id: id, platform: PLATFORM, translation_key: key, labels: [] };
    }
    ids[key] = id;
  }

  const kW = { unit_of_measurement: "kW" };
  put(ids.solar_power, sim.solar_kw, kW);
  put(ids.grid_power, sim.grid_kw, kW);
  put(ids.home_power, sim.home_kw, kW);
  put(ids.import_rate, sim.import_rate, { unit_of_measurement: `${currency}/kWh`, period: sim.period, label: sim.period_label, season: "summer" });
  put(ids.cost_rate, sim.cost_rate, { unit_of_measurement: `${currency}/h` });
  put(ids.cost_today, sim.cost_today, { unit_of_measurement: currency });
  put(ids.totals, sim.produced_today, {
    unit_of_measurement: "kWh",
    used_today: sim.used_today,
    produced_today: sim.produced_today,
    exported_today: sim.exported_today,
  });
  put(ids.data_age, 3, { unit_of_measurement: "s" });
  if (ids.battery_soc) put(ids.battery_soc, sim.battery_soc, { unit_of_measurement: "%" });
  if (ids.battery_power) put(ids.battery_power, sim.battery_kw, kW);
  put("sun.sun", sim.is_day ? "above_horizon" : "below_horizon", { elevation: sim.sun_elevation });

  cars.forEach((c, i) => {
    const s = sim.cars[i % sim.cars.length];
    const on = (v) => (v ? "on" : "off");
    put(c.presence_entity, s.home ? "home" : "not_home");
    put(c.charging_entity, on(s.charging && s.home));
    put(c.power_entity, s.charging && s.home ? s.power_kw : 0, kW);
    put(c.battery_entity, s.soc, { unit_of_measurement: "%" });
    put(c.plugged_entity, on(s.plugged && s.home));
    put(c.limit_entity, s.limit, { unit_of_measurement: "%" });
  });

  return { hass: { ...hass, states, entities }, ids };
}
