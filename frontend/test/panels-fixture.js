// Made-up panel entities for previews of the panels card. Adds per-panel
// power and lifetime energy sensors, a few gateway sensors and the
// panel_health `groups` attribute to a hass from createFakeHass().
//
//   addPanels(hass, {layout: "two", fault: true, viaAttribute: true})
//
// layouts: "two" (6 + 4), "three" (8 + 8 + 6), "one" (3), "none".

const LAYOUTS = {
  none: [],
  one: [{ label: "Garage", facing: 200, n: 3, factor: 0.95 }],
  two: [
    { label: "South", facing: 180, n: 6, factor: 1, note: "Clear sky most of the day." },
    { label: "West", facing: 265, n: 4, factor: 0.72 },
  ],
  three: [
    { label: "East", facing: 95, n: 8, factor: 0.62 },
    { label: "South", facing: 175, n: 8, factor: 1 },
    { label: "West", facing: 270, n: 6, factor: 0.7 },
  ],
};

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_");

export function addPanels(hass, opts = {}) {
  const layout = LAYOUTS[opts.layout || "two"] || LAYOUTS.two;
  const states = { ...hass.states };
  const solarId = Object.values(hass.entities).find((e) => e.platform === "sunflow_solar" && e.translation_key === "solar_power")?.entity_id;
  const solarW = Math.max(0, Number(states[solarId]?.state) || 0);
  const total = layout.reduce((a, g) => a + g.n * g.factor, 0) || 1;
  const now = new Date(hass._now ?? Date.now()).toISOString();
  const groups = [];
  const energyIds = {};
  let k = 0;
  const fault = opts.fault ? `${layout[0]?.label} 3` : null;
  for (const g of layout) {
    const panels = [];
    for (let i = 0; i < g.n; i++) {
      k++;
      const name = `${g.label} ${i + 1}`;
      const base = `sensor.${slug(g.label)}_panel_${i + 1}`;
      const wobble = 1 + Math.sin(k * 1.7) * 0.04;
      let w = Math.round((solarW / total) * g.factor * wobble);
      if (name === fault) w = 0;
      const life = Math.round(2900 * g.factor * (1 + Math.cos(k * 2.3) * 0.03) * (opts.lowPanel && k === 2 ? 0.55 : 1));
      states[`${base}_power`] = {
        entity_id: `${base}_power`,
        state: String(w),
        attributes: { friendly_name: `${name} power`, unit_of_measurement: "W", device_class: "power" },
        last_changed: now,
        last_updated: now,
      };
      states[`${base}_lifetime_energy`] = {
        entity_id: `${base}_lifetime_energy`,
        state: String(life),
        attributes: { friendly_name: `${name} lifetime energy`, unit_of_measurement: "kWh", device_class: "energy", state_class: "total_increasing" },
        last_changed: now,
        last_updated: now,
      };
      energyIds[`${base}_lifetime_energy`] = { share: (g.factor * wobble) / total, dead: name === fault };
      panels.push({ power: `${base}_power`, energy: `${base}_lifetime_energy`, name });
    }
    groups.push({ label: g.label, facing: g.facing, note: g.note, panels });
  }

  const diag = [];
  if (opts.gateway !== false && layout.length) {
    const add = (id, state, attrs) => {
      states[id] = { entity_id: id, state: String(state), attributes: attrs, last_changed: now, last_updated: now };
      diag.push(id);
    };
    add("sensor.gateway_uptime", 1_123_200, { friendly_name: "Gateway uptime", unit_of_measurement: "s", device_class: "duration" });
    add("sensor.gateway_cpu", 7.4, { friendly_name: "Gateway CPU", unit_of_measurement: "%" });
    add("sensor.gateway_memory", 41, { friendly_name: "Gateway memory", unit_of_measurement: "%" });
    add("sensor.gateway_firmware", "2025.6.1", { friendly_name: "Gateway firmware" });
  }

  const healthId = Object.values(hass.entities).find((e) => e.platform === "sunflow_solar" && e.translation_key === "panel_health")?.entity_id;
  const problemId = Object.values(hass.entities).find((e) => e.platform === "sunflow_solar" && e.translation_key === "solar_problem")?.entity_id;
  if (healthId) {
    const findings = fault ? `${fault} no output` : states[healthId].state;
    const attributes = { ...states[healthId].attributes };
    if (opts.viaAttribute !== false) {
      attributes.groups = groups;
      attributes.diagnostics = diag;
    }
    states[healthId] = { ...states[healthId], state: layout.length || diag.length ? findings : "OK", attributes };
  }
  if (problemId && fault) {
    const since = new Date((hass._now ?? Date.now()) - 50 * 60_000).toISOString();
    states[problemId] = { ...states[problemId], state: "on", attributes: { ...states[problemId].attributes, findings: `${fault} no output`, problem_since: since } };
  }

  // Hourly statistics for the lifetime counters: today's share of the solar day.
  const callWS = hass.callWS.bind(hass);
  const fakeCall = (msg) => {
    if (msg.type === "recorder/statistics_during_period" && msg.statistic_ids.some((id) => energyIds[id])) {
      const start = Date.parse(msg.start_time);
      const end = hass._now ?? Date.now();
      const out = {};
      for (const id of msg.statistic_ids) {
        const info = energyIds[id];
        if (!info) continue;
        out[id] = [];
        for (let t = start; t + 3_600_000 <= end; t += 3_600_000) {
          const hour = new Date(t).getHours() + 0.5;
          const sun = Math.max(0, Math.sin(((hour - 6.5) / 12.5) * Math.PI));
          const kwhAll = 7.2 * sun; // a mid-size array at this hour
          out[id].push({ start: t, end: t + 3_600_000, change: info.dead && hour > 10 ? 0 : Math.round(kwhAll * info.share * 10000) / 10000 });
        }
      }
      return Promise.resolve(out);
    }
    return callWS(msg);
  };
  return { ...hass, states, callWS: fakeCall, _panelGroups: groups, _diagnostics: diag };
}
