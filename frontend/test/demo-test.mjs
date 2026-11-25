// Checks the website demo bundle in headless Chromium, under the site's CSP,
// and shoots every scenario by day and night.
//
//   node scripts/build-demo.mjs <dist>
//   node test/demo-test.mjs <dist> <shots-dir>
//
// Exits 1 if any check fails.

import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const here = dirname(fileURLToPath(import.meta.url));
const dist = process.argv[2] || join(here, "..", "dist", "demo");
const shots = process.argv[3] || "";

// The website's header, word for word.
const CSP =
  "default-src 'self'; script-src 'self' 'nonce-TEST'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; media-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".png": "image/png" };
const SCENARIOS = ["normal", "high-generation", "high-usage", "car-charging", "both-plugged", "car-away", "cloudy", "battery-charging", "battery-discharging"];

const requests = [];
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  requests.push(path);
  let file = null;
  if (path === "/") file = join(here, "demo-page.html");
  else if (path.startsWith("/test/")) file = join(here, normalize(path.slice(6)));
  else if (path.startsWith("/demo/")) file = join(dist, normalize(path.slice(6)));
  if (!file || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "content-security-policy": CSP });
  res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const origin = `http://127.0.0.1:${server.address().port}`;

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
      for (const parts of [["chrome-headless-shell-mac-arm64", "chrome-headless-shell"], ["chrome-headless-shell-mac-x64", "chrome-headless-shell"], ["chrome-headless-shell-linux64", "chrome-headless-shell"], ["chrome-mac", "Chromium.app/Contents/MacOS/Chromium"]]) {
        const p = join(dir, d, ...parts);
        if (existsSync(p)) return p;
      }
    }
  }
  throw new Error("No Chromium found. Set CHROMIUM_PATH.");
}

const fails = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};

// SUNFLOW_BROWSER=webkit runs the same checks in WebKit (Safari's engine).
const engine = process.env.SUNFLOW_BROWSER === "webkit" ? require("playwright-core").webkit : null;
const browser = engine ? await engine.launch() : await chromium.launch({ executablePath: findChromium() });

async function open({ width, height, scale = 2, mobile = false, reducedMotion = "no-preference" }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale, reducedMotion });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(m.text()));
  await page.goto(origin + "/");
  if (mobile) await page.evaluate(() => document.body.classList.add("mobile"));
  await page.waitForFunction(() => window.demoLog?.ready.length > 0, null, { timeout: 15000 });
  return { page, errors };
}

const settle = (page) => page.waitForTimeout(1900); // the day/night crossfade is 1.5 s

// ---- behavior ----
{
  const { page, errors } = await open({ width: 1100, height: 760 });
  const log = () => page.evaluate(() => JSON.parse(JSON.stringify(window.demoLog)));
  let l = await log();
  check(l.ready.length === 1, "ready fires once");
  check(l.ready[0]?.time === "day" && l.ready[0]?.scenario === "normal", "ready carries the starting state");

  await page.evaluate(() => document.getElementById("demo").setScenario("car-charging"));
  l = await log();
  check(JSON.stringify(l.change.at(-1)) === JSON.stringify({ time: "day", scenario: "car-charging" }), "setScenario fires change with detail");
  check((await page.getAttribute("#demo", "scenario")) === "car-charging", "setScenario reflects the attribute");

  await page.evaluate(() => document.getElementById("demo").setTime("night"));
  l = await log();
  check(JSON.stringify(l.change.at(-1)) === JSON.stringify({ time: "night", scenario: "car-charging" }), "setTime fires change with detail");

  await page.evaluate(() => document.getElementById("demo").setAttribute("scenario", "cloudy"));
  l = await log();
  check(l.change.at(-1)?.scenario === "cloudy", "attribute change works");

  const before = l.change.length;
  const r = await page.evaluate(() => {
    const el = document.getElementById("demo");
    const a = el.setScenario("nope");
    el.setAttribute("scenario", "also-nope");
    el.setTime("noon");
    return { a, scenario: el.getAttribute("scenario"), time: el.getAttribute("time"), s: el.scenario };
  });
  l = await log();
  check(r.a === false && r.scenario === "cloudy" && r.s === "cloudy" && r.time === "night" && l.change.length === before, "unknown ids are ignored");

  await page.evaluate(() => document.getElementById("demo").setScenario("cloudy"));
  l = await log();
  check(l.change.length === before, "same scenario again doesn't fire change");

  // every scenario renders without errors
  for (const sc of SCENARIOS) await page.evaluate((s) => document.getElementById("demo").setScenario(s), sc);
  await page.waitForTimeout(300);
  const night = await page.evaluate(() => document.getElementById("demo").shadowRoot.querySelector("sunflow-house-card").shadowRoot.querySelector(".scene").classList.contains("is-night"));
  check(night, "night shows the night picture");

  l = await log();
  check(l.csp.length === 0, `no CSP violations${l.csp.length ? ": " + l.csp.join(", ") : ""}`);
  check(errors.length === 0, `no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  const outside = requests.filter((p) => !(p === "/" || p.startsWith("/test/") || p === "/demo/sunflow-demo.js" || p.startsWith("/demo/img/")));
  check(outside.length === 0, `only its own files are requested${outside.length ? ": " + outside.join(", ") : ""}`);
  check(requests.includes("/demo/img/house-day.webp") && requests.includes("/demo/img/house-night.webp"), "pictures load next to the script (with ?v=)");
  await page.close();
}

// ---- switching keeps the state right ----
// Each step has to look exactly like a fresh page load of the same time and
// scenario, and the cars have to be where the scenario says.
{
  const fresh = {};
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  for (const time of ["day", "night"]) {
    for (const sc of SCENARIOS) {
      await page.goto(`${origin}/?time=${time}&scenario=${sc}`);
      await page.waitForFunction(() => window.demoLog?.ready.length > 0);
      fresh[`${time}/${sc}`] = await page.evaluate(() => window.demoSnapshot());
    }
  }
  // which cars are on the driveway, plugged in and charging
  const CARS = {
    "car-charging": { here: [true, true], plugged: [true, false], on: [true, false] },
    "both-plugged": { here: [true, true], plugged: [true, true], on: [true, false] },
    "car-away": { here: [false, true], plugged: [false, false], on: [false, false] },
  };
  const DEFAULT = { here: [true, true], plugged: [true, false], on: [false, false] };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let bad = 0;
  const expect = (snap, time, sc, step) => {
    const want = CARS[sc] || DEFAULT;
    const okCars = same(snap.cars, want.here) && same(snap.cables.map((c) => c.plugged), want.plugged) && same(snap.cables.map((c) => c.on), want.on);
    const okFresh = same(snap, fresh[`${time}/${sc}`]);
    if (!okCars || !okFresh) {
      bad++;
      let diff = "";
      if (!okFresh) {
        const f = fresh[`${time}/${sc}`];
        const part = Object.keys(snap).find((k) => !same(snap[k], f[k]));
        diff = `differs from a fresh load in ${part}: ${JSON.stringify(snap[part])} vs ${JSON.stringify(f[part])}`;
      }
      console.log(`     ${step}: ${!okCars ? "cars " + JSON.stringify(snap.cars) + " " : ""}${diff}`);
    }
  };
  for (const [key, snap] of Object.entries(fresh)) {
    const [time, sc] = key.split("/");
    expect(snap, time, sc, `fresh ${key}`);
  }

  await page.goto(origin + "/");
  await page.waitForFunction(() => window.demoLog?.ready.length > 0);
  const go = (fn, arg) => page.evaluate(([f, a]) => document.getElementById("demo")[f](a), [fn, arg]);
  const snap = () => page.evaluate(() => window.demoSnapshot());
  for (const sc of SCENARIOS) {
    await go("setScenario", sc);
    expect(await snap(), "day", sc, `${sc} day`);
    await go("setTime", "night");
    expect(await snap(), "night", sc, `${sc} -> night`);
    await go("setTime", "day");
    expect(await snap(), "day", sc, `${sc} -> back to day`);
  }
  check(bad === 0, "every scenario survives day -> night -> day and matches a fresh load");

  // away, flip the time a couple of times, then back to normal: the first car returns
  bad = 0;
  await go("setScenario", "car-away");
  await go("setTime", "night");
  expect(await snap(), "night", "car-away", "away at night");
  await go("setTime", "day");
  await go("setTime", "night");
  expect(await snap(), "night", "car-away", "away, flipped twice");
  await page.waitForTimeout(1500);
  expect(await snap(), "night", "car-away", "away, a moment later");
  await go("setTime", "day");
  await go("setScenario", "normal");
  expect(await snap(), "day", "normal", "back to normal");
  check(bad === 0, "car away -> time flips -> normal brings the first car back");
  check(errors.length === 0, "switching: no errors");
  await page.close();
}

// ---- reduced motion: nothing animates ----
{
  const { page, errors } = await open({ width: 900, height: 700, scale: 1, reducedMotion: "reduce" });
  await page.evaluate(() => document.getElementById("demo").setScenario("car-charging"));
  await page.waitForTimeout(400);
  const running = await page.evaluate(() => {
    const card = document.getElementById("demo").shadowRoot.querySelector("sunflow-house-card");
    return card.shadowRoot.getAnimations().filter((a) => a.playState === "running" && a.effect?.getKeyframes?.().some((k) => "strokeDashoffset" in k)).length;
  });
  check(running === 0, "reduced motion: no flow animations running");
  check(errors.length === 0, "reduced motion: no errors");
  await page.close();
}

// ---- screenshots ----
if (shots) {
  mkdirSync(shots, { recursive: true });
  const sets = [
    { name: "desktop", width: 1100, height: 760, times: ["day", "night"] },
    { name: "mobile", width: 390, height: 520, mobile: true, times: ["day", "night"] },
  ];
  for (const set of sets) {
    const { page } = await open(set);
    for (const time of set.times) {
      for (const sc of set.name === "mobile" ? ["normal", "car-charging", "both-plugged", "battery-discharging"] : SCENARIOS) {
        await page.evaluate(([t, s]) => {
          const el = document.getElementById("demo");
          el.setTime(t);
          el.setScenario(s);
        }, [time, sc]);
        await settle(page);
        await page.locator(".stage").screenshot({ path: join(shots, `${set.name}-${time}-${sc}.png`), animations: "disabled" });
      }
    }
    await page.close();
  }
  console.log(`shots in ${shots}`);
}

await browser.close();
server.close();
if (fails.length) {
  console.log(`\n${fails.length} failed`);
  process.exit(1);
}
console.log("\nall good");
