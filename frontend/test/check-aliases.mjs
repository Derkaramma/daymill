// The old sunflow-* element names still work, and the DayMill bundle can sit
// next to an old SunFlow bundle (both resources loaded while people move
// over) without either one throwing.
//
//   node test/check-aliases.mjs [old-bundle.js]
//
// Uses the built daymill-cards.js. The old bundle defaults to the one in the
// v0.1.1 tag. Needs playwright-core (NODE_PATH works) and a Chromium
// (CHROMIUM_PATH, or any Playwright browser).

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const ORIGIN = "http://aliases.test";

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

const ours = readFileSync(join(repo, "custom_components", "daymill", "frontend", "daymill-cards.js"), "utf8");
const old = process.argv[2]
  ? readFileSync(process.argv[2], "utf8")
  : execFileSync("git", ["show", "v0.1.1:custom_components/sunflow_solar/frontend/sunflow-cards.js"], { cwd: repo, encoding: "utf8", maxBuffer: 1 << 26 });

const CARDS = ["house", "share-ring", "now", "today", "power-chart", "billing", "totals", "rates", "panels", "history"].map((c) => `${c}-card`);
const NEW = [...CARDS.map((c) => `daymill-${c}`), "daymill-house-card-editor", "daymill-strategy-editor", "ll-strategy-dashboard-daymill"];
const OLD = NEW.map((t) => t.replace("daymill", "sunflow"));

let failed = 0;
const ok = (cond, msg, extra) => {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"}  ${msg}${!cond && extra !== undefined ? `\n      ${JSON.stringify(extra)}` : ""}`);
};

const browser = await chromium.launch({ executablePath: findChromium() });

async function load(scripts) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const files = { "/ours.js": ours, "/old.js": old };
  const tags = scripts.map((s) => `<script type="module" src="${s}"></script>`).join("");
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort();
    if (url.pathname === "/") return route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><html><head>${tags}</head><body></body></html>` });
    if (files[url.pathname]) return route.fulfill({ status: 200, contentType: "text/javascript", body: files[url.pathname] });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction((n) => customElements.get(n), NEW[0]);
  await page.waitForTimeout(100);
  return { page, errors };
}

const info = (page) =>
  page.evaluate(([fresh, stale]) => {
    const all = [...fresh, ...stale];
    return {
      missing: all.filter((t) => !customElements.get(t)),
      picker: (window.customCards || []).map((c) => c.type),
      // an alias is a subclass of the DayMill element when we defined it
      subclass: stale.filter((t, i) => customElements.get(t)?.prototype instanceof customElements.get(fresh[i])),
      strategy: typeof customElements.get("ll-strategy-dashboard-sunflow")?.generate,
    };
  }, [NEW, OLD]);

// DayMill on its own
{
  const { page, errors } = await load(["/ours.js"]);
  const r = await info(page);
  ok(errors.length === 0, "DayMill bundle loads cleanly", errors);
  ok(r.missing.length === 0, "every daymill-* and sunflow-* name is defined", r.missing);
  ok(r.subclass.length === OLD.length, "old names are subclasses of the DayMill elements", r.subclass);
  ok(r.strategy === "function", "custom:sunflow strategy still generates a dashboard");
  ok(CARDS.every((c) => r.picker.includes(`daymill-${c}`)), "card picker lists the DayMill cards", r.picker);
  ok(!r.picker.some((t) => t.startsWith("sunflow-")), "card picker has no sunflow-* duplicates", r.picker);
  const made = await page.evaluate(() => {
    const el = document.createElement("sunflow-now-card");
    el.setConfig({ type: "custom:sunflow-now-card" });
    document.body.append(el);
    return el.localName;
  });
  ok(made === "sunflow-now-card", "an old card config still builds");
  ok(errors.length === 0, "no errors building it", errors);
  await page.close();
}

// both resources, in either order
for (const order of [["/ours.js", "/old.js"], ["/old.js", "/ours.js"]]) {
  const { page, errors } = await load(order);
  const r = await info(page);
  const name = order[0] === "/ours.js" ? "DayMill then SunFlow" : "SunFlow then DayMill";
  ok(errors.length === 0, `${name}: nothing throws`, errors);
  ok(r.missing.length === 0, `${name}: every name is defined`, r.missing);
  await page.close();
}

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall good");
process.exit(failed ? 1 : 0);
