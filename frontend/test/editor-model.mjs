// Node checks for the editor's pure helpers (src/editor/model.js).
//   node test/editor-model.mjs

import assert from "node:assert/strict";
import * as M from "../src/editor/model.js";
import { linePath, normalizeConfig } from "../src/cards/house/layout.js";

let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${err.message.split("\n").join("\n      ")}`);
  }
};

check("path strings turn into points", () => {
  assert.deepEqual(M.pathPoints("M0.1,0.2 L0.3,0.2 V0.5 H0").pts, [[0.1, 0.2], [0.3, 0.2], [0.3, 0.5], [0, 0.5]]);
  assert.deepEqual(M.pathPoints("m0.1,0.1 0.1,0 l0,0.1").pts.map((p) => p.map((v) => +v.toFixed(3))), [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]]);
  const c = M.pathPoints("M0,0 C0.1,0 0.2,0.1 0.3,0.3");
  assert.equal(c.curved, true);
  assert.deepEqual(c.pts, [[0, 0], [0.3, 0.3]]);
});

check("effective lines fill in the defaults", () => {
  const l = M.effectiveLines({});
  assert.deepEqual(Object.keys(l), ["solar0", "home", "grid", "battery"]);
  assert.equal(l.home.pts.length, 2);
});

check("setLine writes one line and keeps the rest", () => {
  const cfg = { layout: { lines: { solar: ["M0,0 L0.1,0.1", [[0.5, 0.5], [0.6, 0.6]]] } } };
  const next = M.setLine(cfg, "solar1", [[0.123456, 0.2], [0.3, 0.4]]);
  assert.equal(next.layout.lines.solar[0], "M0,0 L0.1,0.1");
  assert.deepEqual(next.layout.lines.solar[1], [[0.1235, 0.2], [0.3, 0.4]]);
  assert.deepEqual(cfg.layout.lines.solar[1], [[0.5, 0.5], [0.6, 0.6]], "input untouched");
});

check("clean drops unfinished lines", () => {
  const cfg = M.addSolarLine({});
  assert.equal(M.solarCount(cfg), 2);
  const one = M.setLine(cfg, "solar1", [[0.2, 0.2]]);
  const out = M.clean(one);
  assert.equal(out.layout.lines.solar.length, 1);
  const home = M.clean(M.setLine({}, "home", [[0.1, 0.1]]));
  assert.equal(home.layout.lines.home, false);
  normalizeConfig(out);
});

check("clean removes empty objects", () => {
  assert.deepEqual(M.clean({ type: "x", layout: { chips: {} }, colors: {} }), { type: "x" });
});

check("cars: found cars become config cars linked by slug", () => {
  const known = [{ slug: "a", name: "A" }, { slug: "b", name: "B" }];
  const next = M.setCar({}, known, 1, { slot: { x: 0.1, y: 0.5, w: 0.2 } });
  assert.deepEqual(next.cars, [{ daymill: "a", name: "A" }, { daymill: "b", name: "B", flip: true, slot: { x: 0.1, y: 0.5, w: 0.2 } }]);
});

check("cars: old sunflow keys are saved as daymill", () => {
  const cfg = { type: "x", cars: [{ sunflow: "a", name: "A" }, { daymill: "b" }, { name: "C" }] };
  assert.deepEqual(M.renameCarKeys(cfg).cars, [{ name: "A", daymill: "a" }, { daymill: "b" }, { name: "C" }]);
  assert.deepEqual(M.renameCarKeys({ type: "x" }), { type: "x" });
});

check("snap prefers targets, then lines up with neighbors", () => {
  assert.deepEqual(M.snap([103, 100], [[100, 100]], []), [100, 100]);
  assert.deepEqual(M.snap([203, 150], [[100, 100]], [[200, 50]]), [200, 150]);
  assert.deepEqual(M.snap([230, 150], [[100, 100]], [[200, 50]]), [230, 150]);
});

check("nearest segment", () => {
  const r = M.nearestSegment([[0, 0], [100, 0], [100, 100]], [95, 50]);
  assert.equal(r.index, 1);
  assert.ok(Math.abs(r.dist - 5) < 1e-9);
});

check("history undo and redo", () => {
  const hs = new M.History();
  hs.push({ a: 1 });
  hs.push({ a: 2 });
  assert.deepEqual(hs.undo({ a: 3 }), { a: 2 });
  assert.deepEqual(hs.undo({ a: 2 }), { a: 1 });
  assert.equal(hs.canUndo, false);
  assert.deepEqual(hs.redo({ a: 1 }), { a: 2 });
});

check("export and import layouts", () => {
  const cfg = { type: "custom:daymill-house-card", layout: { panel: { x: 0.1, y: 0.2, w: 0.02, h: 0.08, skew: 0 } }, entities: { solar_power: "sensor.x" } };
  const out = M.exportLayout(cfg);
  assert.equal(out.entities, undefined);
  assert.equal(out.daymill_layout, 1);
  const back = M.importLayout({ type: "custom:daymill-house-card", entities: { solar_power: "sensor.y" } }, JSON.stringify(out));
  assert.equal(back.layout.panel.x, 0.1);
  assert.equal(back.entities.solar_power, "sensor.y");
  assert.throws(() => M.importLayout({}, "{x"), /bad_json/);
  assert.throws(() => M.importLayout({}, "{}"), /no_layout/);
  assert.throws(() => M.importLayout({}, JSON.stringify({ layout: { panel: { x: "a" } } })), /panel/);
});

check("rounded corners only change point lines with a radius", () => {
  const l = { pts: [[0, 0], [0.5, 0], [0.5, 0.5]] };
  assert.equal(linePath(l, 1600, 1000).d, "M0,0L800,0L800,500");
  assert.match(linePath(l, 1600, 1000, 12).d, /^M0,0L788,0Q800,0 800,12L800,500$/);
  assert.equal(linePath({ d: "M0,0 L1,1" }, 100, 100, 12).d, "M0,0L100,100");
  assert.equal(normalizeConfig({ layout: { round_corners: true } }).layout.round > 0, true);
  assert.equal(normalizeConfig({}).layout.round, 0);
});

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
