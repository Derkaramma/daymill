// Node checks for the panel group helpers and the dashboard strategy.
//   node test/check-panels-strategy.mjs

import assert from "node:assert/strict";
import { createFakeHass } from "./fake-hass.js";
import { addPanels } from "./panels-fixture.js";
import { facingText, normalizeGroups, panelFlags, panelGroups, median } from "../src/common/panel-groups.js";
import { generateDashboard, hasPanels } from "../src/cards/strategy.js";

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}

const cardTypes = (view) => view.sections.flatMap((s) => s.cards.map((c) => c.type));

check("facing text", () => {
  assert.equal(facingText(180), "S (180°)");
  assert.equal(facingText("265"), "W (265°)");
  assert.equal(facingText(-10), "N (350°)");
  assert.equal(facingText("South-east"), "South-east");
  assert.equal(facingText(undefined), "");
});

check("groups normalize: strings, objects, empties dropped", () => {
  const g = normalizeGroups([
    { label: "A", panels: ["sensor.a1", { power: "sensor.a2", name: "Left" }, 5, null] },
    { label: "Empty", panels: [] },
    { panels: [{ energy: "sensor.b1_energy" }] },
    "junk",
  ]);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0].panels.map((p) => p.name), ["A 1", "Left"]);
  assert.equal(g[1].label, "Face 3");
  assert.equal(g[1].panels[0].energy, "sensor.b1_energy");
  assert.ok(g[0].color && g[1].color && g[0].color !== g[1].color);
});

check("groups: card config wins over the attribute", () => {
  const hass = addPanels(createFakeHass({}), { layout: "two" });
  assert.equal(panelGroups(hass, {}).length, 2);
  assert.equal(panelGroups(hass, { groups: [{ label: "X", panels: ["sensor.x"] }] })[0].label, "X");
  assert.equal(panelGroups(hass, { groups: [] }).length, 0);
});

check("findings map to panels", () => {
  const f = panelFlags("South 3 no output, West 1 stale", ["South 3", "West 1", "West 2"]);
  assert.deepEqual(f, { "South 3": "no_output", "West 1": "stale" });
  assert.deepEqual(panelFlags("OK", ["a"]), {});
  assert.equal(median([3, 1, 2, NaN]), 2);
});

check("strategy: five views with panels", () => {
  const hass = addPanels(createFakeHass({}), { layout: "two" });
  const dash = generateDashboard({ type: "custom:sunflow" }, hass);
  assert.deepEqual(dash.views.map((v) => v.path), ["home", "totals", "rates", "panels", "history"]);
  for (const v of dash.views) {
    assert.equal(v.type, "sections");
    assert.equal(v.max_columns, 4);
  }
  const home = dash.views[0];
  assert.equal(home.sections[0].column_span, 3);
  assert.equal(home.sections[0].cards[0].type, "custom:sunflow-house-card");
  assert.deepEqual(cardTypes(home), [
    "custom:sunflow-house-card",
    "heading", "custom:sunflow-now-card",
    "heading", "custom:sunflow-today-card", "custom:sunflow-share-ring-card",
    "heading", "custom:sunflow-power-chart-card",
    "heading", "custom:sunflow-billing-card",
  ]);
});

check("strategy: only SunFlow and built-in cards", () => {
  const hass = addPanels(createFakeHass({}), { layout: "two" });
  const builtIn = new Set(["heading", "statistics-graph", "markdown"]);
  for (const v of generateDashboard({}, hass).views) {
    for (const type of cardTypes(v)) assert.ok(type.startsWith("custom:sunflow-") || builtIn.has(type), type);
  }
});

check("strategy: no Panels view without panels", () => {
  const hass = createFakeHass({});
  assert.equal(hasPanels(hass, {}), false);
  assert.deepEqual(generateDashboard({}, hass).views.map((v) => v.path), ["home", "totals", "rates", "history"]);
  assert.ok(generateDashboard({ panels: true }, hass).views.some((v) => v.path === "panels"));
});

check("strategy: statistics graphs use registry entity ids", () => {
  const hass = createFakeHass({});
  const totals = generateDashboard({}, hass).views.find((v) => v.path === "totals");
  const graphs = totals.sections.flatMap((s) => s.cards).filter((c) => c.type === "statistics-graph");
  assert.equal(graphs.length, 3);
  for (const g of graphs) for (const id of g.entities) assert.ok(hass.entities[id]?.platform === "sunflow_solar", id);
  assert.deepEqual(graphs.map((g) => g.period), ["day", "day", "month"]);
});

check("strategy: options pass through", () => {
  const hass = addPanels(createFakeHass({}), { layout: "two" });
  const groups = [{ label: "Only", panels: ["sensor.south_panel_1_power"] }];
  const dash = generateDashboard({ views: ["panels", "home", "bogus"], entities: { solar_power: "sensor.mine" }, house: { image_day: "/local/d.jpg" }, groups }, hass);
  assert.deepEqual(dash.views.map((v) => v.path), ["panels", "home"]);
  const panels = dash.views[0].sections[0].cards[0];
  assert.deepEqual(panels.groups, groups);
  assert.equal(panels.entities.solar_power, "sensor.mine");
  const house = dash.views[1].sections[0].cards[0];
  assert.equal(house.image_day, "/local/d.jpg");
  assert.equal(house.entities.solar_power, "sensor.mine");
});

check("strategy: hint when SunFlow is missing", () => {
  const dash = generateDashboard({}, { states: {}, entities: {} });
  assert.equal(dash.views.length, 1);
  assert.equal(dash.views[0].sections[0].cards[0].type, "markdown");
});

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all good");
