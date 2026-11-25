// Browser tests for the house card editor, under the same strict CSP as
// the screenshots. Drags handles with the mouse (and one touch drag),
// checks the config-changed events, uploads, undo/redo, import/export,
// and saves screenshots at 600 and 900 px.
//
//   node test/editor-test.mjs [--shots <dir>]
//
// Needs esbuild and playwright-core (NODE_PATH works) and a Chromium
// (CHROMIUM_PATH, or any Playwright browser).

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const { chromium } = require("playwright-core");

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const ORIGIN = "http://harness.test";
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'";
const argv = process.argv.slice(2);
const shotsAt = argv.includes("--shots") ? resolve(argv[argv.indexOf("--shots") + 1]) : null;

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    const p = chromium.executablePath();
    if (p && existsSync(p)) return p;
  } catch {
    // fall through
  }
  for (const dir of [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), "Library", "Caches", "ms-playwright"), join(homedir(), ".cache", "ms-playwright")].filter(Boolean)) {
    if (!existsSync(dir)) continue;
    const found = readdirSync(dir).filter((d) => /^chromium(_headless_shell)?-\d+$/.test(d)).sort((a, b) => Number(b.split("-").pop()) - Number(a.split("-").pop()));
    for (const d of found) {
      for (const parts of [["chrome-headless-shell-mac-arm64", "chrome-headless-shell"], ["chrome-headless-shell-mac-x64", "chrome-headless-shell"], ["chrome-headless-shell-linux64", "chrome-headless-shell"], ["chrome-linux", "headless_shell"]]) {
        const p = join(dir, d, ...parts);
        if (existsSync(p)) return p;
      }
    }
  }
  throw new Error("No Chromium found. Set CHROMIUM_PATH or run: npx playwright-core install chromium-headless-shell");
}

const bundle = async (entry) =>
  (await esbuild.build({ entryPoints: [entry], bundle: true, format: "esm", write: false, target: "es2022", define: { __SUNFLOW_VERSION__: '"test"' }, logLevel: "silent" })).outputFiles[0].text;

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="harness.css">
<script type="module" src="harness.js"></script><script type="module" src="cards.js"></script><script type="module" src="editor-page.js"></script>
</head><body><main id="stage"></main></body></html>`;

const files = {
  "/editor.html": [HTML, "text/html"],
  "/harness.css": [readFileSync(join(here, "harness.css"), "utf8"), "text/css"],
  "/harness.js": [await bundle(join(here, "harness.js")), "text/javascript"],
  "/cards.js": [await bundle(join(root, "src", "index.js")), "text/javascript"],
  "/editor-page.js": [await bundle(join(here, "editor-page.mjs")), "text/javascript"],
};
const stored = new Map();

let failed = 0;
let passed = 0;
const ok = (cond, msg, extra) => {
  if (cond) passed++;
  else failed++;
  console.log(`${cond ? "ok  " : "FAIL"}  ${msg}${!cond && extra !== undefined ? `\n      ${JSON.stringify(extra)}` : ""}`);
};

const browser = await chromium.launch({ executablePath: findChromium() });
const problems = [];

async function open(width = 600, opts = {}) {
  const page = await browser.newPage({ viewport: { width: width + 32, height: 1400 }, deviceScaleFactor: 2, hasTouch: true });
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const headers = { "content-security-policy": CSP, "cache-control": "no-store" };
    if (url.origin !== ORIGIN) return route.abort();
    if (files[url.pathname]) return route.fulfill({ status: 200, headers: { ...headers, "content-type": files[url.pathname][1] }, body: files[url.pathname][0] });
    if (url.pathname === "/upload-sink" && req.method() === "POST") {
      const id = `img${stored.size + 1}`;
      stored.set(id, { body: req.postDataBuffer(), type: req.headers()["content-type"] });
      return route.fulfill({ status: 200, headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ id, filesize: req.postDataBuffer().length }) });
    }
    const m = /^\/api\/image\/serve\/([^/]+)\/original$/.exec(url.pathname);
    if (m && stored.has(m[1])) return route.fulfill({ status: 200, headers: { ...headers, "content-type": stored.get(m[1]).type }, body: stored.get(m[1]).body });
    return route.fulfill({ status: 404, headers, body: "" });
  });
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP violation: ${e.violatedDirective}`)));
  const d = new Date();
  d.setHours(12, 30, 0, 0);
  await page.clock.setFixedTime(d.getTime());
  await page.goto(`${ORIGIN}/editor.html`);
  await page.waitForFunction(() => window.editorHarness?.render);
  await page.evaluate((o) => window.editorHarness.render(o), { config: opts.config, hass: { now: d.getTime(), ...(opts.hass || {}) }, width });
  await page.waitForTimeout(250);
  return page;
}

const E = "sunflow-house-card-editor";
const events = (page) => page.evaluate(() => window.editorHarness.events.map((c) => JSON.parse(JSON.stringify(c))));
const last = async (page) => (await events(page)).at(-1);
const center = async (loc) => {
  const b = await loc.boundingBox();
  return [b.x + b.width / 2, b.y + b.height / 2];
};
async function drag(page, from, to, steps = 6) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps });
  await page.mouse.up();
  await page.waitForTimeout(80);
}
const tab = async (page, id) => {
  await page.locator(`${E} #tab-${id}`).click();
  await page.waitForTimeout(150);
};
const settle = (page) => page.waitForTimeout(450); // past the emit debounce
async function shot(page, name) {
  if (!shotsAt) return;
  mkdirSync(shotsAt, { recursive: true });
  await page.locator("#stage > .slot").screenshot({ path: join(shotsAt, `${name}.png`), animations: "disabled" });
}

try {
  // ---- panel: move, resize, tilt, junction, keyboard, undo ----
  {
    const page = await open(600);
    await tab(page, "panel");
    await shot(page, "panel-600");
    const body = page.locator(`${E} [data-id="panel-move"]`);
    ok(await body.count() === 1, "panel handle is drawn over the preview");
    const c = await center(body);
    await drag(page, c, [c[0] + 60, c[1] + 30]);
    ok((await events(page)).length === 0, "no config-changed before the debounce runs out");
    await settle(page);
    let ev = await events(page);
    ok(ev.length === 1, "one config-changed per drag", ev.length);
    const p = ev[0]?.layout?.panel;
    ok(p && p.x > 0.25 && p.x < 0.32 && p.y > 0.49, "panel moved right and down", ev[0]);
    ok(ev[0]?.type === "custom:sunflow-house-card", "event config keeps the card type");

    const size = await center(page.locator(`${E} [data-id="panel-size"]`));
    await drag(page, size, [size[0] + 20, size[1] + 40]);
    await settle(page);
    const p2 = (await last(page)).layout.panel;
    ok(p2.w > p.w && p2.h > p.h, "corner handle resizes the panel", { p, p2 });

    const skew = await center(page.locator(`${E} [data-id="panel-skew"]`));
    await drag(page, skew, [skew[0], skew[1] + 12]);
    await settle(page);
    const p3 = (await last(page)).layout.panel;
    ok(p3.skew > 10 && p3.skew <= 75, "side handle tilts the panel", p3.skew);

    // junction: free it, drag it away, then back onto the panel snaps it to follow
    ok(await page.locator(`${E} [data-id="junction"]`).count() === 0, "junction follows the panel by default");
    await page.locator(`${E} [data-k="j-follow"]`).uncheck();
    await settle(page);
    const j = await center(page.locator(`${E} [data-id="junction"]`));
    await drag(page, j, [j[0] - 50, j[1] + 40]);
    await settle(page);
    ok(Array.isArray((await last(page)).layout.junction), "junction can be placed by hand");
    const j2 = await center(page.locator(`${E} [data-id="junction"]`));
    await drag(page, j2, [j[0] + 3, j[1] - 2]);
    await settle(page);
    ok((await last(page)).layout.junction === undefined, "junction snaps back onto the panel");

    // keyboard: arrow keys nudge the focused handle; ctrl+z undoes
    const before = (await last(page)).layout.panel.x;
    await page.locator(`${E} [data-id="panel-move"]`).focus();
    await page.keyboard.press("Shift+ArrowRight");
    await settle(page);
    const after = (await last(page)).layout.panel.x;
    ok(after > before, "Shift+ArrowRight nudges the focused panel", { before, after });
    await page.keyboard.press("Control+z");
    await settle(page);
    ok((await last(page)).layout.panel.x === before, "Ctrl+Z undoes the nudge");
    await page.keyboard.press("Control+Shift+z");
    await settle(page);
    ok((await last(page)).layout.panel.x === after, "Ctrl+Shift+Z redoes it");

    // the preview card is in edit mode and can't take focus
    const pv = await page.evaluate(() => {
      const card = window.editorHarness.el.shadowRoot.querySelector("sunflow-house-card");
      return { edit: card.editMode, inert: card.inert, scene: card.shadowRoot.querySelector(".scene")?.classList.contains("editing") };
    });
    ok(pv.edit && pv.inert && pv.scene, "preview card is in edit mode and inert", pv);
    await page.close();
  }

  // ---- lines: add, drag, insert, delete, undo, round corners ----
  {
    const page = await open(900);
    await tab(page, "lines");
    await page.locator(`${E} [data-k="line-home"]`).click();
    await page.waitForTimeout(100);
    await shot(page, "lines-900");
    const pts = page.locator(`${E} [data-kind="pt"][data-key="home"]`);
    ok(await pts.count() === 2, "home line shows its two points", await pts.count());
    // click an empty spot: a point is added at the end
    const ov = await page.locator(`${E} .edov`).boundingBox();
    await page.mouse.click(ov.x + ov.width * 0.4, ov.y + ov.height * 0.62);
    await settle(page);
    let home = (await last(page))?.layout?.lines?.home;
    ok(Array.isArray(home) && home.length === 3, "click adds a point to the end", home);
    // drag the new point
    const p3 = await center(pts.nth(2));
    await drag(page, p3, [p3[0] + 40, p3[1] + 25]);
    await settle(page);
    const moved = (await last(page)).layout.lines.home;
    ok(moved[2][0] > home[2][0] && moved[2][1] > home[2][1], "dragging a point moves it", { home, moved });
    // click on the first segment: inserts a point in between
    const a = await center(pts.nth(0));
    const b = await center(pts.nth(1));
    await page.mouse.click((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    await settle(page);
    const ins = (await last(page)).layout.lines.home;
    ok(ins.length === 4, "clicking a segment inserts a point", ins);
    // select + Delete
    await page.locator(`${E} [data-kind="pt"][data-key="home"]`).nth(1).click();
    await page.waitForTimeout(80);
    ok(!(await page.locator(`${E} [data-k="del-pt"]`).isDisabled()), "delete button turns on for a selected point");
    await page.keyboard.press("Delete");
    await settle(page);
    ok((await last(page)).layout.lines.home.length === 3, "Delete removes the selected point");
    // undo / redo buttons
    await page.locator(`${E} button`, { hasText: "Undo" }).click();
    await settle(page);
    ok((await last(page)).layout.lines.home.length === 4, "Undo button brings the point back");
    await page.locator(`${E} button`, { hasText: "Redo" }).click();
    await settle(page);
    ok((await last(page)).layout.lines.home.length === 3, "Redo removes it again");
    // add a solar line, draw it with two clicks
    await page.locator(`${E} [data-k="add-solar"]`).click();
    await page.waitForTimeout(100);
    await page.mouse.click(ov.x + ov.width * 0.3, ov.y + ov.height * 0.2);
    await page.waitForTimeout(80);
    let ev = await last(page);
    await settle(page);
    ev = await last(page);
    ok(ev.layout.lines.solar.length === 1, "a one-point line is not sent to HA yet", ev.layout.lines.solar.length);
    await page.mouse.click(ov.x + ov.width * 0.3, ov.y + ov.height * 0.35);
    await settle(page);
    ev = await last(page);
    ok(ev.layout.lines.solar.length === 2 && ev.layout.lines.solar[1].length === 2, "second click finishes the new solar line", ev.layout.lines.solar);
    const flows = await page.evaluate(() => window.editorHarness.el.shadowRoot.querySelector("sunflow-house-card").shadowRoot.querySelectorAll('[data-flow^="solar"]').length);
    ok(flows === 2, "preview draws both solar lines", flows);
    await page.locator(`${E} [data-k="round"]`).check();
    await settle(page);
    ok((await last(page)).layout.round_corners === true, "round corners toggle");
    const d = await page.evaluate(() => window.editorHarness.el.shadowRoot.querySelector("sunflow-house-card").shadowRoot.querySelector('[data-flow="grid"] .track').getAttribute("d"));
    ok(/Q/.test(d), "preview rounds the corners", d);
    // HA sends the config back: tab and history survive
    const tabNow = await page.locator(`${E} #tab-lines`).getAttribute("aria-selected");
    ok(tabNow === "true" && !(await page.locator(`${E} button`, { hasText: "Undo" }).isDisabled()), "echoed config keeps the tab and undo history");
    await page.close();
  }

  // ---- cars: found cars, drag, size, picture, cable, alpha check ----
  {
    const page = await open(900);
    await tab(page, "cars");
    await shot(page, "cars-900");
    const car = page.locator(`${E} [data-id="car-move|0"]`);
    ok(await car.count() === 1, "first car has a handle");
    const c = await center(car);
    await drag(page, c, [c[0] - 80, c[1] + 10]);
    await settle(page);
    let ev = await last(page);
    ok(Array.isArray(ev.cars) && ev.cars.length === 2 && ev.cars[0].sunflow && ev.cars[0].slot.x < 0.5, "dragging a found car saves the cars, linked by slug", ev.cars);
    const sz = await center(page.locator(`${E} [data-id="car-size|0"]`));
    await drag(page, sz, [sz[0] + 30, sz[1]]);
    await settle(page);
    ev = await last(page);
    ok(ev.cars[0].slot.w > 0.135, "corner handle scales the car", ev.cars[0].slot);
    await page.locator(`${E} [data-k="car-flip"]`).check();
    await settle(page);
    ok((await last(page)).cars[0].flip === true, "flip checkbox");
    await page.locator(`${E} [data-k="car-pic"]`).selectOption("builtin:suv");
    await settle(page);
    ok((await last(page)).cars[0].image === "builtin:suv", "built-in SUV picture");
    // port handle
    const port = await center(page.locator(`${E} [data-id="port|0"]`));
    await drag(page, port, [port[0] + 10, port[1] - 6]);
    await settle(page);
    ok(Array.isArray((await last(page)).cars[0].port), "charge port can be moved");
    // draw a cable
    await page.locator(`${E} [data-k="car-cable"]`).selectOption("draw");
    await page.waitForTimeout(100);
    const ov = await page.locator(`${E} .edov`).boundingBox();
    for (const [fx, fy] of [[0.5, 0.55], [0.52, 0.72], [0.56, 0.7]]) await page.mouse.click(ov.x + ov.width * fx, ov.y + ov.height * fy);
    await settle(page);
    ok((await last(page)).cars[0].cable?.length === 3, "cable drawn point by point", (await last(page)).cars[0].cable);
    // upload an opaque PNG: warns about the missing see-through background
    await page.locator(`${E} [data-k="car-pic"]`).selectOption("custom");
    await page.waitForTimeout(100);
    const opaque = await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 200;
      c.height = 120;
      const x = c.getContext("2d");
      x.fillStyle = "#88a";
      x.fillRect(0, 0, 200, 120);
      const b = await new Promise((r) => c.toBlob(r, "image/png"));
      return [...new Uint8Array(await b.arrayBuffer())];
    });
    await page.locator(`${E} input[type="file"]`).first().setInputFiles({ name: "car.png", mimeType: "image/png", buffer: Buffer.from(opaque) });
    await page.waitForTimeout(600);
    ok(await page.locator(`${E} .msg.warn`, { hasText: "see-through" }).count() === 1, "opaque car picture gets a warning");
    const see = await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 200;
      c.height = 120;
      c.getContext("2d").fillRect(40, 30, 120, 60);
      const b = await new Promise((r) => c.toBlob(r, "image/png"));
      return [...new Uint8Array(await b.arrayBuffer())];
    });
    await page.locator(`${E} [data-k="car-pic"]`).selectOption("custom");
    await page.waitForTimeout(100);
    await page.locator(`${E} input[type="file"]`).first().setInputFiles({ name: "car2.png", mimeType: "image/png", buffer: Buffer.from(see) });
    await page.waitForTimeout(600);
    ok(await page.locator(`${E} .msg.ok`).count() === 1, "cutout with transparency is accepted");
    await settle(page);
    ev = await last(page);
    ok(/^\/api\/image\/serve\/img\d+\/original$/.test(ev.cars[0].image), "car picture stored as an image serve URL", ev.cars[0].image);
    const up = await page.evaluate(() => window.editorHarness.uploads.at(-1));
    ok(up.field && up.type === "image/png", "car cutouts upload as PNG in the 'file' field", up);
    await page.close();
  }

  // ---- photo upload: EXIF stripped, size capped, size shown ----
  {
    const page = await open(600);
    const jpeg = await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 3000;
      c.height = 1800;
      const x = c.getContext("2d");
      const g = x.createLinearGradient(0, 0, 0, 1800);
      g.addColorStop(0, "#7ab");
      g.addColorStop(1, "#465");
      x.fillStyle = g;
      x.fillRect(0, 0, 3000, 1800);
      const b = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.8));
      return [...new Uint8Array(await b.arrayBuffer())];
    });
    // splice an EXIF block with a marker string in right after SOI
    const tiff = Buffer.concat([Buffer.from("MM\x00\x2a\x00\x00\x00\x08\x00\x00\x00\x00\x00\x00", "latin1"), Buffer.from("GPSMARKER-37.0-122.0")]);
    const app1Body = Buffer.concat([Buffer.from("Exif\x00\x00", "latin1"), tiff]);
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (app1Body.length + 2) >> 8, (app1Body.length + 2) & 255]), app1Body]);
    const withExif = Buffer.concat([Buffer.from(jpeg.slice(0, 2)), app1, Buffer.from(jpeg.slice(2))]);
    ok(withExif.includes("GPSMARKER"), "test photo carries EXIF");
    await page.locator(`${E} input[type="file"]`).first().setInputFiles({ name: "house.jpg", mimeType: "image/jpeg", buffer: withExif });
    await page.waitForTimeout(1200);
    await settle(page);
    const ev = await last(page);
    ok(/^\/api\/image\/serve\/img\d+\/original$/.test(ev?.image_day), "day photo saved as /api/image/serve/<id>/original", ev);
    const id = /serve\/([^/]+)\//.exec(ev?.image_day || "")?.[1];
    const body = stored.get(id)?.body;
    ok(body && !body.includes("GPSMARKER") && !body.includes("Exif"), "uploaded photo has no EXIF");
    ok(stored.get(id)?.type === "image/jpeg", "photo uploads as JPEG");
    const dims = await page.evaluate(async (u) => {
      const i = new Image();
      i.src = u;
      await i.decode();
      return [i.naturalWidth, i.naturalHeight];
    }, ev.image_day);
    ok(dims[0] === 2400 && dims[1] === 1440, "photo scaled to 2400 px wide", dims);
    await page.waitForTimeout(300);
    ok(await page.locator(`${E} .msg`, { hasText: "2400 × 1440 px" }).count() === 1, "photo size is shown");
    ok(await page.locator(`${E} .msg`, { hasText: "Anyone with the picture's link" }).count() === 1, "public link note is shown");
    await shot(page, "photo-600");
    await page.close();
  }

  // ---- labels: drag a chip, unstack Today, touch drag ----
  {
    const page = await open(600);
    await tab(page, "labels");
    await shot(page, "labels-600");
    const solar = await center(page.locator(`${E} [data-id="chip|solar"]`));
    await drag(page, solar, [solar[0] - 60, solar[1] + 20]);
    await settle(page);
    let ev = await last(page);
    ok(ev.layout.chips.solar.x < 0.35 && ev.layout.chips.solar.y > 0.025, "dragging a chip moves it", ev.layout.chips.solar);
    const today = await center(page.locator(`${E} [data-id="chip|today"]`));
    await drag(page, today, [today[0] - 30, today[1] + 30]);
    await settle(page);
    ev = await last(page);
    ok(typeof ev.layout.chips.today.x === "number" && !ev.layout.chips.today.stack, "dragging Today takes it out of the stack", ev.layout.chips.today);
    await page.locator(`${E} [data-k="show-grid"]`).uncheck();
    await settle(page);
    ok((await last(page)).layout.chips.grid.show === false, "hide a chip");
    await page.locator(`${E} [data-k="align-home"]`).selectOption("right");
    await settle(page);
    ok((await last(page)).layout.chips.home.align === "right", "chip alignment");
    // touch: synthetic pointer events with pointerType touch
    const h = await center(page.locator(`${E} [data-id="chip|home"]`));
    await page.evaluate(([x, y]) => {
      const ov = window.editorHarness.el.shadowRoot.querySelector(".edov");
      const target = window.editorHarness.el.shadowRoot.querySelector('[data-id="chip|home"] rect');
      const ev = (type, cx, cy, el) => el.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: "touch", isPrimary: true, clientX: cx, clientY: cy, bubbles: true, composed: true, button: 0 }));
      ev("pointerdown", x, y, target);
      for (let i = 1; i <= 5; i++) ev("pointermove", x + i * 8, y + i * 6, ov);
      ev("pointerup", x + 40, y + 30, ov);
    }, h);
    await settle(page);
    const homeChip = (await last(page)).layout.chips.home;
    ok(homeChip.x > 0.295 && homeChip.y > 0.39, "touch drag moves a chip", homeChip);
    await page.close();
  }

  // ---- battery tab (beta) ----
  {
    const page = await open(900);
    await tab(page, "battery");
    await shot(page, "battery-900");
    const pvBatt = await page.evaluate(() => !!window.editorHarness.el.shadowRoot.querySelector("sunflow-house-card").shadowRoot.querySelector(".battery"));
    ok(pvBatt, "battery is shown in the preview on the battery tab");
    const b = await center(page.locator(`${E} [data-id="battery-move"]`));
    await drag(page, [b[0] + 7, b[1] - 12], [b[0] + 37, b[1] - 12]);
    await settle(page);
    ok((await last(page))?.layout?.battery?.x > 0.2325, "battery can be moved", await last(page));
    const pts = await page.locator(`${E} [data-kind="pt"][data-key="battery"]`).count();
    ok(pts === 3, "battery line points are editable", pts);
    await page.close();
  }

  // ---- scenarios, colors, export/import ----
  {
    const page = await open(900);
    await page.locator(`${E} .scen button`, { hasText: "Night" }).click();
    await page.waitForTimeout(150);
    const night = await page.evaluate(() => window.editorHarness.el.shadowRoot.querySelector("sunflow-house-card").shadowRoot.querySelector(".scene").classList.contains("is-night"));
    ok(night, "Night button switches the preview to night");
    await page.locator(`${E} .scen button`, { hasText: "Car charging" }).click();
    await page.waitForTimeout(150);
    const charging = await page.evaluate(() => window.editorHarness.el.shadowRoot.querySelector("sunflow-house-card").shadowRoot.querySelector('[data-flow="car0"]').classList.contains("on"));
    ok(charging, "Car charging scenario lights up the cable");
    await settle(page);
    ok((await events(page)).length === 0, "scenarios don't change the config");
    await shot(page, "scenario-night-900");

    await tab(page, "colors");
    await page.locator(`${E} [data-k="color-solar"]`).fill("#ff0000");
    await page.locator(`${E} [data-k="color-solar"]`).dispatchEvent("change");
    await settle(page);
    ok((await last(page))?.colors?.solar === "#ff0000", "color picker sets colors.solar", await last(page));
    await shot(page, "colors-900");

    await tab(page, "backup");
    const json = JSON.parse(await page.locator(`${E} textarea`).inputValue());
    ok(json.sunflow_layout === 1 && json.colors?.solar === "#ff0000", "export JSON has the layout", json);
    const imported = { sunflow_layout: 1, layout: { panel: { x: 0.5, y: 0.5, w: 0.02, h: 0.08, skew: 10 } }, image_aspect: "16/9" };
    await page.locator(`${E} textarea`).fill(JSON.stringify(imported));
    await page.locator(`${E} [data-k="apply"]`).click();
    await settle(page);
    const ev = await last(page);
    ok(ev.layout.panel.x === 0.5 && ev.image_aspect === "16/9" && ev.colors.solar === "#ff0000", "import merges the layout", ev);
    await page.locator(`${E} textarea`).fill("{nope");
    await page.locator(`${E} [data-k="apply"]`).click();
    await page.waitForTimeout(100);
    ok(await page.locator(`${E} .msg.err`).count() === 1, "bad JSON shows an error");
    await page.locator(`${E} textarea`).fill(JSON.stringify({ layout: { panel: { x: "left" } } }));
    await page.locator(`${E} [data-k="apply"]`).click();
    await page.waitForTimeout(100);
    ok(await page.locator(`${E} .msg.err`).count() === 1, "broken layout is refused");
    await page.locator(`${E} input[type="file"]`).first().setInputFiles({ name: "layout.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ sunflow_layout: 1, layout: { chips: { solar: { x: 0.1, y: 0.1 } } } })) });
    await settle(page);
    ok((await last(page)).layout.chips.solar.x === 0.1, "layout file can be loaded");
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator(`${E} [data-k="download"]`).click()]);
    ok(download.suggestedFilename() === "sunflow-layout.json", "download gives a layout file");
    await shot(page, "backup-900");
    await page.close();
  }

  // ---- narrow + tab keyboard nav + photo layout with a picture ----
  {
    const page = await open(500);
    await page.locator(`${E} #tab-photo`).focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(100);
    ok(await page.locator(`${E} #tab-panel`).getAttribute("aria-selected") === "true", "arrow keys move between tabs");
    const wide = await page.evaluate(() => {
      const el = window.editorHarness.el;
      return el.getBoundingClientRect().width >= el.shadowRoot.querySelector(".ed").scrollWidth - 1;
    });
    ok(wide, "nothing overflows at 500 px");
    await shot(page, "panel-500");
    await page.close();
  }
  for (const w of [600, 900]) {
    const page = await open(w);
    await tab(page, "lines");
    await shot(page, `lines-${w}`);
    await tab(page, "cars");
    await shot(page, `cars-${w}`);
    await page.close();
  }
} finally {
  await browser.close();
}

for (const p of problems) console.log(`problem: ${p}`);
ok(problems.length === 0, "no console errors or CSP violations", problems.length);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
