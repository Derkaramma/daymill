// Shared colors and CSS. Every color is a CSS variable so a card config
// (or a theme) can override it.

import { sheet } from "./dom.js";

export const COLORS = {
  solar: "#ffb020",
  solar_pulse: "#fff3c4",
  solar_halo: "#ffc233",
  import: "#ff4d4d",
  import_pulse: "#ffd0cc",
  import_halo: "#ff6b5e",
  export: "#2fe08a",
  export_pulse: "#d2ffe6",
  export_halo: "#4dff9e",
  home: "#4fa3ff",
  home_pulse: "#dcefff",
  home_halo: "#7cbcff",
  battery: "#b98cff",
  battery_pulse: "#efe4ff",
  battery_halo: "#c9a6ff",
  ev: "#3dffa0",
  ev_pulse: "#8dffc6",
  ev_core: "#e6fff2",
  // chip dots
  dot_solar: "#ffc233",
  dot_home: "#4fa3ff",
  dot_grid: "#ff5a4f",
  dot_export: "#3ddc84",
  dot_rate: "#9b8cff",
  dot_today: "#c792ea",
  dot_credit: "#2fe08a",
  dot_car: "#33d6ff",
  // ring and charts
  ring_grid: "#8a96a8",
  ring_solar: "#ffb020",
  scene_bg: "#222",
};

// TOU period dot colors. Unknown periods fall back to the rate color.
export const PERIOD_COLORS = {
  on_peak: "#ff5a4f",
  mid_peak: "#ffb020",
  off_peak: "#4fa3ff",
  super_off_peak: "#3ddc84",
};

export const cssVar = (key) => `--sf-${key.replace(/_/g, "-")}`;

export function periodColor(period) {
  return PERIOD_COLORS[period] || COLORS.dot_rate;
}

// Only colors that look like colors get through; this ends up in CSSOM, but
// keeping junk out avoids silent no-ops.
const COLOR_RE = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|oklch|color-mix)\(.*\)|var\(--[\w-]+\)|[a-z]+)$/i;

const applied = new WeakMap();

// Apply config.colors ({solar: "#..."}) to an element as CSS variables.
// Variables set by an earlier config and gone from this one are removed.
export function applyColors(el, colors) {
  const next = new Set();
  if (colors && typeof colors === "object") {
    for (const [key, value] of Object.entries(colors)) {
      if (typeof value === "string" && COLOR_RE.test(value.trim())) {
        el.style.setProperty(cssVar(key), value.trim());
        next.add(cssVar(key));
      }
    }
  }
  for (const name of applied.get(el) || []) if (!next.has(name)) el.style.removeProperty(name);
  applied.set(el, next);
}

const defaults = Object.entries(COLORS)
  .map(([k, v]) => `${cssVar(k)}: ${v};`)
  .join("\n  ");

export const baseStyles = sheet(`
:host {
  display: block;
  ${defaults}
  --sf-text: var(--primary-text-color, #e1e1e1);
  --sf-text-2: var(--secondary-text-color, #9b9b9b);
  --sf-divider: var(--divider-color, rgba(127, 127, 127, 0.25));
  --sf-warn: var(--warning-color, #ffa600);
  /* amber text pulled toward the text color: darker on light themes,
     lighter on dark ones, readable on both */
  --sf-warn-text: color-mix(in srgb, var(--sf-warn) 55%, var(--sf-text));
  --sf-error: var(--error-color, #db4437);
  --sf-radius: var(--ha-card-border-radius, 12px);
  --sf-pad: 16px;
  --sf-gap: 12px;
}
[hidden] { display: none !important; }
ha-card {
  display: block;
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
}
.sf-pad { padding: var(--sf-pad); }
.sf-title {
  font-size: 1.1em;
  font-weight: 500;
  color: var(--sf-text);
  margin: 0 0 8px;
}
.sf-muted { color: var(--sf-text-2); }
.sf-row { display: flex; align-items: center; gap: 8px; }
.sf-num { font-variant-numeric: tabular-nums; }
.sf-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
}
.sf-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 0.85em;
  border: 1px solid var(--sf-divider);
  color: var(--sf-text);
  white-space: nowrap;
}
.sf-pill.warn { border-color: var(--sf-warn); color: var(--sf-warn-text); }
.sf-pill.error { border-color: var(--sf-error); color: var(--sf-error); }
.sf-empty {
  padding: var(--sf-pad);
  color: var(--sf-text-2);
}
[role="button"] { cursor: pointer; }
[role="button"]:focus-visible {
  outline: 2px solid var(--primary-color, #03a9f4);
  outline-offset: 2px;
}
`);
