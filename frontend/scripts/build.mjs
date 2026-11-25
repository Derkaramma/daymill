// Bundle src/index.js into the integration's frontend folder.
//   node scripts/build.mjs           one minified build
//   node scripts/build.mjs --watch   rebuild on change (not minified)
//
// Dependencies resolve from ./node_modules, or from NODE_PATH when they are
// installed somewhere else.

import { createRequire } from "node:module";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const integration = join(root, "..", "custom_components", "sunflow_solar");
const outfile = join(integration, "frontend", "sunflow-cards.js");
const { version } = JSON.parse(readFileSync(join(integration, "manifest.json"), "utf8"));
const watch = process.argv.includes("--watch");

const options = {
  entryPoints: [join(root, "src", "index.js")],
  outfile,
  bundle: true,
  format: "esm",
  target: ["es2022", "chrome109", "safari16.4", "firefox115"],
  minify: !watch,
  sourcemap: false,
  legalComments: "none",
  charset: "utf8",
  define: { __SUNFLOW_VERSION__: JSON.stringify(version) },
  logLevel: "warning",
};

if (watch) {
  const ctx = await esbuild.context({
    ...options,
    plugins: [{ name: "log", setup: (b) => b.onEnd((r) => r.errors.length || console.log(`built ${new Date().toLocaleTimeString()}`)) }],
  });
  await ctx.watch();
  console.log(`watching, writing ${relative(process.cwd(), outfile)}`);
} else {
  await esbuild.build(options);
  const kb = (statSync(outfile).size / 1024).toFixed(1);
  console.log(`${relative(process.cwd(), outfile)}  ${kb} KB  v${version}`);
}
