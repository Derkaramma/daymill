// Render one card with the fake hass in headless Chromium and save a PNG.
//
//   node test/shoot.mjs --card '{"type":"custom:daymill-test-card"}' --out /tmp/card.png
//
// Options:
//   --card <json>        card config (or --card-file <path.json>)
//   --out <path.png>     where to write the screenshot (required)
//   --scenario <id>      simulator scenario (default normal)
//   --time day|night     (default day)
//   --hass <json>        more createFakeHass options, e.g. '{"staleMinutes":30}'
//   --width <px>         card width (default 500)
//   --light              light theme
//   --scale <n>          device scale factor (default 2)
//   --bundle             load the built daymill-cards.js instead of src/
//   --assets <dir>       serve a folder at /assets/ (images for the card)
//   --strict             exit 1 on page errors or CSP violations
//   --eval <js>          run an expression after rendering (window.harness.el
//                        is the card) and print its result
//
// The page runs under a strict CSP (no inline styles or scripts, same-origin
// only), so anything that would break on a locked-down site shows up here.
// Set CHROMIUM_PATH to pick the browser binary.

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const { chromium } = require("playwright-core");

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const ORIGIN = "http://harness.test";
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
].join("; ");

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    const p = chromium.executablePath();
    if (p && existsSync(p)) return p;
  } catch {
    // fall through
  }
  // Any Playwright browser already downloaded, newest first.
  const caches = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), "Library", "Caches", "ms-playwright"),
    join(homedir(), ".cache", "ms-playwright"),
  ].filter(Boolean);
  const bins = [
    ["chrome-headless-shell-mac-arm64", "chrome-headless-shell"],
    ["chrome-headless-shell-mac-x64", "chrome-headless-shell"],
    ["chrome-headless-shell-linux64", "chrome-headless-shell"],
    ["chrome-linux", "headless_shell"],
    ["chrome-linux", "chrome"],
    ["chrome-mac", "Chromium.app/Contents/MacOS/Chromium"],
  ];
  for (const dir of caches) {
    if (!existsSync(dir)) continue;
    const found = readdirSync(dir)
      .filter((d) => /^chromium(_headless_shell)?-\d+$/.test(d))
      .sort((a, b) => Number(b.split("-").pop()) - Number(a.split("-").pop()));
    for (const d of found) {
      for (const parts of bins) {
        const p = join(dir, d, ...parts);
        if (existsSync(p)) return p;
      }
    }
  }
  throw new Error("No Chromium found. Set CHROMIUM_PATH or run: npx playwright-core install chromium-headless-shell");
}

async function bundle(entry) {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    write: false,
    target: "es2022",
    define: { __DAYMILL_VERSION__: '"harness"' },
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json" };

async function main() {
  const opt = args(process.argv.slice(2));
  if (!opt.out || opt.out === true) throw new Error("--out <path.png> is required");
  let card = opt["card-file"] ? JSON.parse(readFileSync(opt["card-file"], "utf8")) : opt.card ? JSON.parse(opt.card) : { type: "custom:daymill-test-card" };
  if (typeof card !== "object") throw new Error("--card must be a JSON object");
  const hass = { ...(opt.hass ? JSON.parse(opt.hass) : {}) };
  if (opt.scenario) hass.scenario = opt.scenario;
  if (opt.time) hass.time = opt.time;
  const width = Number(opt.width || 500);

  const harnessJs = await bundle(join(here, "harness.js"));
  const cardsJs = opt.bundle
    ? readFileSync(join(root, "..", "custom_components", "daymill", "frontend", "daymill-cards.js"), "utf8")
    : await bundle(join(root, "src", "index.js"));
  const files = {
    "/harness.html": readFileSync(join(here, "harness.html"), "utf8"),
    "/harness.css": readFileSync(join(here, "harness.css"), "utf8"),
    "/harness.js": harnessJs,
    "/cards.js": cardsJs,
  };
  const assets = opt.assets && opt.assets !== true ? resolve(opt.assets) : null;

  const browser = await chromium.launch({ executablePath: findChromium() });
  const problems = [];
  try {
    const page = await browser.newPage({ viewport: { width: width + 32, height: 800 }, deviceScaleFactor: Number(opt.scale || 2) });
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") problems.push(`console.${m.type()}: ${m.text()}`);
    });
    page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== ORIGIN) return route.abort();
      const headers = { "content-security-policy": CSP, "cache-control": "no-store" };
      if (files[url.pathname] !== undefined) {
        return route.fulfill({ status: 200, headers: { ...headers, "content-type": TYPES[extname(url.pathname)] }, body: files[url.pathname] });
      }
      if (assets && url.pathname.startsWith("/assets/")) {
        const p = normalize(join(assets, decodeURIComponent(url.pathname.slice(8))));
        if (p.startsWith(assets) && existsSync(p)) {
          return route.fulfill({ status: 200, headers: { ...headers, "content-type": TYPES[extname(p).toLowerCase()] || "application/octet-stream" }, body: readFileSync(p) });
        }
      }
      return route.fulfill({ status: 404, headers, body: "" });
    });
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (e) => {
        console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI || ""} ${e.sourceFile || ""}:${e.lineNumber || ""}`);
      });
    });
    // Freeze the page clock at the fake "now" so data ages come out right.
    if (hass.now === undefined) {
      const d = new Date();
      d.setHours(hass.time === "night" ? 20 : 12, 30, 0, 0);
      hass.now = d.getTime();
    }
    await page.clock.setFixedTime(hass.now);
    await page.goto(`${ORIGIN}/harness.html`);
    await page.waitForFunction(() => window.harness?.render);
    const info = await page.evaluate((o) => window.harness.render(o), { card, hass, width, light: !!opt.light });
    await page.waitForTimeout(Number(opt.wait || 150));
    if (opt.eval && opt.eval !== true) console.log(JSON.stringify(await page.evaluate(opt.eval)));
    mkdirSync(dirname(resolve(opt.out)), { recursive: true });
    await page.locator("#stage > .slot").screenshot({ path: opt.out, animations: "disabled" });
    console.log(JSON.stringify({ out: resolve(opt.out), ...info }));
  } finally {
    await browser.close();
  }
  for (const p of problems) console.error(p);
  if (opt.strict && problems.length) process.exit(1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
