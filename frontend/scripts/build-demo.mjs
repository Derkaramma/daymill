// Build the website demo: <daymill-demo> as one file plus its pictures.
//
//   node scripts/build-demo.mjs [out-dir]
//
// Writes daymill-demo.js and img/ to out-dir (default ./dist/demo). The site
// serves the folder as-is; the script finds its pictures next to itself.
// This is separate from the integration bundle and never goes into it.

import { createRequire } from "node:module";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const src = join(root, "src", "demo");
const out = resolve(process.argv[2] || join(root, "dist", "demo"));
const manifest = join(root, "..", "custom_components", "daymill", "manifest.json");
const { version } = JSON.parse(readFileSync(manifest, "utf8"));

mkdirSync(join(out, "img"), { recursive: true });
await esbuild.build({
  entryPoints: [join(src, "demo.js")],
  outfile: join(out, "daymill-demo.js"),
  bundle: true,
  format: "esm",
  target: ["es2022", "chrome109", "safari16.4", "firefox115"],
  minify: true,
  legalComments: "none",
  charset: "utf8",
  define: { __DAYMILL_VERSION__: JSON.stringify(version) },
  logLevel: "warning",
});
for (const f of readdirSync(join(src, "img"))) copyFileSync(join(src, "img", f), join(out, "img", f));

for (const f of ["daymill-demo.js", ...readdirSync(join(out, "img")).map((f) => `img/${f}`)]) {
  console.log(`${relative(process.cwd(), join(out, f))}  ${(statSync(join(out, f)).size / 1024).toFixed(1)} KB`);
}
