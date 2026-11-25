// Panel groups (roof faces) for the panels card and the dashboard strategy.
// No DOM in here, so node scripts can import it.
//
// Groups come from the card config first, then from the panel_health
// sensor's `groups` attribute. Both use the integration's own shape:
//
//   groups:
//     - label: Front
//       facing: 135            # degrees, or any text ("South-east")
//       note: Shaded after 3 PM
//       color: "#e8a33d"
//       panels:
//         - sensor.front_1_power          # just the power entity
//         - power: sensor.front_2_power
//           energy: sensor.front_2_lifetime_energy   # lifetime kWh
//           today: sensor.front_2_energy_today       # optional, else from statistics
//           name: Front 2

import { addStrings } from "./format.js";
import { attr, entityId } from "./entities.js";

addStrings("en", {
  "panels_title": "Solar panels",
  "panels_power_now": "Power now",
  "panels_today": "Today",
  "panels_lifetime": "Lifetime",
  "panels_lifetime_kwh": "Lifetime kWh per panel",
  "panels_diagnostics": "Gateway",
  "panels_health": "Health check",
  "panels_problem": "Problem alert",
  "panels_problem_on": "Needs attention since {time}",
  "panels_problem_off": "No problems",
  "panels_all_ok": "All panels OK",
  "panels_count": "{n} panels",
  "panels_count_one": "1 panel",
  "panels_facing": "Facing {dir}",
  "panels_total_now": "{power} now",
  "panels_low_lifetime": "{name} has made {pct} of its group's median",
  "panels_health_note": "Each panel is compared with the others on the same roof face while the sun is above 10°. An alert is raised after 30 minutes.",
  "panels_flag_stale": "no recent data",
  "panels_flag_no_output": "no output",
  "panels_none": "No panels configured",
  "panels_resting": "Resting",
});

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

// 135 -> "SE (135°)". Text passes through unchanged.
export function facingText(facing) {
  if (facing === undefined || facing === null || facing === "") return "";
  const n = typeof facing === "number" ? facing : /^\s*-?\d+(\.\d+)?\s*°?\s*$/.test(String(facing)) ? parseFloat(facing) : NaN;
  if (!Number.isFinite(n)) return String(facing);
  const deg = ((Math.round(n) % 360) + 360) % 360;
  return `${COMPASS[Math.round(deg / 22.5) % 16]} (${deg}°)`;
}

// Default group colors: warm ambers that sit next to the solar color.
export const GROUP_COLORS = ["var(--sf-solar)", "#ff7a45", "#ffd95a", "#e8a33d", "#ff9f7a", "#c9a227"];

const str = (v) => (typeof v === "string" && v ? v : undefined);

function normPanel(p, label, i) {
  if (typeof p === "string") p = { power: p };
  if (!p || typeof p !== "object") return null;
  const power = str(p.power) || str(p.entity);
  const energy = str(p.energy) || str(p.lifetime) || str(p.lifetime_energy);
  const today = str(p.today) || str(p.energy_today);
  if (!power && !energy && !today) return null;
  return {
    power,
    energy,
    today,
    lastReported: str(p.last_reported),
    name: str(p.name) || `${label} ${i + 1}`,
    short: str(p.short) || String(i + 1),
  };
}

// Raw list -> [{label, facing, note, color, panels: [...]}], empty groups dropped.
export function normalizeGroups(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  raw.forEach((g, gi) => {
    if (!g || typeof g !== "object") return;
    const label = str(g.label) || str(g.name) || `Face ${gi + 1}`;
    const list = Array.isArray(g.panels) ? g.panels : [];
    const panels = list.map((p, i) => normPanel(p, label, i)).filter(Boolean);
    if (!panels.length) return;
    out.push({
      label,
      facing: g.facing ?? g.azimuth,
      note: str(g.note),
      color: str(g.color) || GROUP_COLORS[out.length % GROUP_COLORS.length],
      panels,
    });
  });
  return out;
}

// Groups for a card or strategy config.
export function panelGroups(hass, config = {}) {
  if (Array.isArray(config.groups)) return normalizeGroups(config.groups);
  const health = entityId(hass, "panel_health", config.entities);
  return normalizeGroups(attr(hass, health, "groups"));
}

// Gateway diagnostics: config list first, then the panel_health attribute.
export function diagnosticEntities(hass, config = {}) {
  const pick = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" || (x && typeof x.entity === "string")) : []);
  if (Array.isArray(config.diagnostics)) return pick(config.diagnostics);
  const health = entityId(hass, "panel_health", config.entities);
  return pick(attr(hass, health, "diagnostics"));
}

// Per panel flags parsed from the health findings text
// ("Front 2 no output, Side 4 stale").
export function panelFlags(findings, names) {
  const out = {};
  if (typeof findings !== "string" || findings === "OK") return out;
  for (const part of findings.split(",").map((x) => x.trim())) {
    for (const name of names) {
      if (part === `${name} stale`) out[name] = "stale";
      else if (part === `${name} no output`) out[name] = "no_output";
    }
  }
  return out;
}

// Median of finite numbers.
export function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return undefined;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
