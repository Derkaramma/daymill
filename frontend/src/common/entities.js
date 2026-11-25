// Finding SunFlow entities and reading them safely.
//
// Cards never hardcode entity ids. They look in the entity registry
// (hass.entities) for entries of the sunflow_solar platform and match on
// translation_key, so renamed entities keep working. A card config can still
// point any key at another entity:
//
//   entities:
//     solar_power: sensor.my_solar
//     cost_today: sensor.my_cost

export const PLATFORM = "sunflow_solar";

// translation_key -> domain. Car keys repeat once per car.
export const KEYS = {
  solar_power: "sensor",
  grid_power: "sensor",
  home_power: "sensor",
  grid_import_power: "sensor",
  grid_export_power: "sensor",
  self_sufficiency: "sensor",
  status: "sensor",
  energy_produced: "sensor",
  energy_imported: "sensor",
  energy_exported: "sensor",
  energy_consumed: "sensor",
  tou_period: "sensor",
  tou_holiday: "sensor",
  import_rate: "sensor",
  export_rate: "sensor",
  cost_rate: "sensor",
  import_energy_charge: "sensor",
  export_credit: "sensor",
  nbc_charges: "sensor",
  adder_charges: "sensor",
  import_cost: "sensor",
  net_cost: "sensor",
  solar_savings: "sensor",
  cost_today: "sensor",
  self_sufficiency_today: "sensor",
  bill_estimate: "sensor",
  totals: "sensor",
  data_age: "sensor",
  panel_health: "sensor",
  battery_soc: "sensor",
  battery_power: "sensor",
  battery_charge_power: "sensor",
  battery_discharge_power: "sensor",
  car_home_charging_power: "sensor",
  solar_problem: "binary_sensor",
  car_charging_at_home: "binary_sensor",
};

export const BAD_STATES = new Set(["unavailable", "unknown", "none", ""]);
export const ON_STATES = new Set(["on", "true", "charging", "starting", "home"]);

// ---- registry lookup ----

const indexCache = new WeakMap();

// {translation_key: [entity_id, ...]} for all SunFlow entities. Cached per
// hass.entities object, which HA replaces whenever the registry changes.
export function sunflowIndex(hass) {
  const reg = hass?.entities;
  if (!reg) return {};
  let idx = indexCache.get(reg);
  if (idx) return idx;
  idx = {};
  for (const entry of Object.values(reg)) {
    if (entry?.platform !== PLATFORM || !entry.translation_key) continue;
    (idx[entry.translation_key] ||= []).push(entry.entity_id);
  }
  for (const list of Object.values(idx)) list.sort();
  indexCache.set(reg, idx);
  return idx;
}

// True when at least one SunFlow entity is registered.
export const hasSunflow = (hass) => Object.keys(sunflowIndex(hass)).length > 0;

// Entity id for a key: config override first, then the registry.
// overrides is usually config.entities.
export function entityId(hass, key, overrides) {
  const o = overrides?.[key];
  if (typeof o === "string" && o) return o;
  return sunflowIndex(hass)[key]?.[0];
}

// All entity ids for a key (for keys with one entity per car).
export function entityIds(hass, key, overrides) {
  const o = overrides?.[key];
  if (Array.isArray(o)) return o.filter((x) => typeof x === "string");
  if (typeof o === "string" && o) return [o];
  return sunflowIndex(hass)[key] || [];
}

// Resolve many keys at once: {solar_power: "sensor.x", ...}. Missing keys are left out.
export function resolve(hass, keys, overrides) {
  const out = {};
  for (const key of keys) {
    const id = entityId(hass, key, overrides);
    if (id) out[key] = id;
  }
  return out;
}

// SunFlow cars, paired by the slug in car_<slug>_charging_at_home /
// car_<slug>_home_charging_power. Entities renamed past recognition are
// paired by order.
export function sunflowCars(hass) {
  const idx = sunflowIndex(hass);
  const charging = idx.car_charging_at_home || [];
  const power = idx.car_home_charging_power || [];
  const slug = (id, re) => id.split(".")[1]?.match(re)?.[1];
  const cars = charging.map((id) => ({ slug: slug(id, /car_(.+)_charging_at_home$/), charging: id }));
  const leftover = [];
  for (const id of power) {
    const s = slug(id, /car_(.+)_home_charging_power$/);
    const car = s && cars.find((c) => c.slug === s && !c.power);
    if (car) car.power = id;
    else leftover.push(id);
  }
  for (const car of cars) if (!car.power && leftover.length) car.power = leftover.shift();
  for (const id of leftover) cars.push({ slug: slug(id, /car_(.+)_home_charging_power$/), power: id });
  for (const car of cars) {
    car.name = carName(hass, car);
    // picture and extra sensors picked in SunFlow's setup
    const at = hass?.states?.[car.charging]?.attributes || {};
    if (["sedan", "suv", "truck"].includes(at.car_image)) car.image = `builtin:${at.car_image}`;
    for (const key of ["battery_entity", "plugged_entity", "limit_entity"]) {
      if (typeof at[key] === "string" && at[key]) car[key] = at[key];
    }
  }
  return cars;
}

// Car name from the entity name "SunFlow <car> charging at home" (English
// names only); otherwise the slug in title case.
function carName(hass, car) {
  const fn = hass?.states?.[car.charging]?.attributes?.friendly_name;
  const m = typeof fn === "string" && fn.match(/^(?:SunFlow\s+)?(.+?)\s+charging at home$/i);
  if (m) return m[1];
  if (!car.slug) return null;
  return car.slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---- reading state ----

export function stateObj(hass, id) {
  return id ? hass?.states?.[id] : undefined;
}

export function isAvailable(st) {
  return !!st && !BAD_STATES.has(String(st.state).toLowerCase());
}

// Raw state string, or undefined when missing or unavailable.
export function state(hass, id) {
  const st = stateObj(hass, id);
  return isAvailable(st) ? st.state : undefined;
}

export function toNumber(v) {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : undefined;
}

// Numeric state, or undefined.
export function num(hass, id) {
  return toNumber(state(hass, id));
}

export function attr(hass, id, name, fallback) {
  const v = stateObj(hass, id)?.attributes?.[name];
  return v === undefined || v === null ? fallback : v;
}

export function numAttr(hass, id, name) {
  return toNumber(attr(hass, id, name));
}

export function isOn(hass, id) {
  const s = state(hass, id);
  return s !== undefined && ON_STATES.has(String(s).toLowerCase());
}

// ---- units ----

const POWER = { w: 0.001, kw: 1, mw: 1000, gw: 1e6 };
const ENERGY = { wh: 0.001, kwh: 1, mwh: 1000, gwh: 1e6 };

export function unit(hass, id) {
  return attr(hass, id, "unit_of_measurement");
}

export function toKw(value, unitStr) {
  const n = toNumber(value);
  if (n === undefined) return undefined;
  const f = POWER[String(unitStr || "kw").trim().toLowerCase()];
  return n * (f ?? 1);
}

export function toKwh(value, unitStr) {
  const n = toNumber(value);
  if (n === undefined) return undefined;
  const f = ENERGY[String(unitStr || "kwh").trim().toLowerCase()];
  return n * (f ?? 1);
}

// Power of an entity in kW, whatever unit it reports in.
export function powerKw(hass, id) {
  return toKw(state(hass, id), unit(hass, id));
}

export function energyKwh(hass, id) {
  return toKwh(state(hass, id), unit(hass, id));
}

// ---- freshness ----

// Last time the source reported a value, in ms. Uses last_reported when HA sends it.
export function reportedAt(st) {
  const raw = st?.last_reported || st?.last_updated || st?.last_changed;
  const t = raw ? Date.parse(raw) : NaN;
  return Number.isNaN(t) ? undefined : t;
}

// Age in seconds of the freshest of the given entities.
export function ageSeconds(hass, ids, now = Date.now()) {
  let best;
  for (const id of [ids].flat()) {
    const t = reportedAt(stateObj(hass, id));
    if (t !== undefined && (best === undefined || t > best)) best = t;
  }
  return best === undefined ? undefined : Math.max(0, (now - best) / 1000);
}

// Data age in seconds. Uses the integration's data_age sensor plus the time
// since it was written (it only changes when the coordinator writes). The
// frontend often has no last_reported, so an unchanged data_age can look
// older than it is; the freshest of fallbackIds caps it.
export function dataAge(hass, overrides, fallbackIds = [], now = Date.now()) {
  const st = stateObj(hass, entityId(hass, "data_age", overrides));
  const v = toNumber(isAvailable(st) ? st.state : undefined);
  const fallback = ageSeconds(hass, fallbackIds, now);
  if (v === undefined) return fallback;
  const since = reportedAt(st);
  const age = v + (since !== undefined ? Math.max(0, (now - since) / 1000) : 0);
  return fallback === undefined ? age : Math.min(age, fallback);
}
