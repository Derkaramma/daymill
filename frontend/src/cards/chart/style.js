// Look shared by the chart and table cards: header, glass panels, tables,
// chart axes, tooltip and legend. Adopted after the base sheet.

import { sheet } from "../../common/dom.js";

export const chartStyles = sheet(`
:host {
  --ct-glass: color-mix(in srgb, var(--sf-text) 4%, transparent);
  --ct-glass-edge: color-mix(in srgb, var(--sf-text) 10%, transparent);
  --ct-line: color-mix(in srgb, var(--sf-text) 9%, transparent);
  --ct-grid: color-mix(in srgb, var(--sf-text) 8%, transparent);
  --ct-axis: color-mix(in srgb, var(--sf-text) 22%, transparent);
  --ct-now: var(--sf-dot-rate);
  --sf-credit: color-mix(in srgb, var(--sf-dot-credit) 72%, var(--sf-text));
  --sf-price-import: var(--sf-dot-rate);
  --sf-price-export: var(--sf-export);
}
ha-card { display: flex; flex-direction: column; container-type: inline-size; }
.ct { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.ct-body { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.ct-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.ct-title { font-size: 1.05em; font-weight: 500; color: var(--sf-text); flex: 1 1 auto; margin: 0; }
.ct-meta { font-size: 0.85em; color: var(--sf-text-2); }
.ct-label {
  font-size: 0.72em;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--sf-text-2);
  display: flex;
  align-items: center;
  gap: 0.45em;
}
.ct-panel {
  background: var(--ct-glass);
  border: 1px solid var(--ct-glass-edge);
  border-radius: 10px;
}
.ct-hero { display: flex; align-items: flex-end; gap: 16px; padding: 12px 14px; flex-wrap: wrap; }
.ct-hero .big { font-size: 2em; font-weight: 600; line-height: 1.1; color: var(--sf-text); font-variant-numeric: tabular-nums; }
.ct-hero .unit { font-size: 0.5em; font-weight: 500; color: var(--sf-text-2); margin-left: 2px; }
.ct-hero .side { display: flex; flex-direction: column; gap: 3px; font-size: 0.88em; color: var(--sf-text-2); margin-left: auto; text-align: right; }
.ct-hero .side b { color: var(--sf-text); font-weight: 500; }
.ct-pad-note { padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.ct-section { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.ct-note { font-size: 0.82em; color: var(--sf-text-2); line-height: 1.45; margin: 0; }
.ct-note b { color: var(--sf-text); font-weight: 500; }
.ct-warn {
  font-size: 0.82em;
  line-height: 1.45;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--sf-warn) 45%, transparent);
  background: color-mix(in srgb, var(--sf-warn) 10%, transparent);
  color: var(--sf-text);
}
.ct-warn .tag { color: var(--sf-warn-text); font-weight: 600; margin-right: 6px; text-transform: uppercase; font-size: 0.85em; letter-spacing: 0.05em; }
.ct-list { margin: 0; padding-left: 18px; font-size: 0.82em; color: var(--sf-text-2); line-height: 1.5; }
.ct-link {
  color: var(--primary-color, #03a9f4);
  font-size: 0.88em;
  text-decoration: none;
  cursor: pointer;
}

/* tables */
.ct-scroll { overflow-x: auto; min-width: 0; }
table.ct-table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
  font-size: 0.9em;
  color: var(--sf-text);
}
.ct-table th {
  font-weight: 500;
  font-size: 0.74em;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--sf-text-2);
  text-align: right;
  padding: 4px 8px 6px;
  border-bottom: 1px solid var(--ct-glass-edge);
  white-space: nowrap;
}
.ct-table td {
  text-align: right;
  padding: 6px 8px;
  border-bottom: 1px solid var(--ct-line);
  white-space: nowrap;
}
.ct-table th:first-child, .ct-table td:first-child { text-align: left; padding-left: 10px; }
.ct-table th:last-child, .ct-table td:last-child { padding-right: 10px; }
.ct-table td:first-child { color: var(--sf-text-2); white-space: normal; }
.ct-table tr:last-child td { border-bottom: none; }
.ct-table tr.group td {
  font-size: 0.72em;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--sf-text-2);
  padding-top: 10px;
  border-bottom: none;
}
.ct-table tr.strong td { font-weight: 600; color: var(--sf-text); }
.ct-table tr.strong td:first-child { color: var(--sf-text); }
.ct-table tr.total td { border-top: 1px solid var(--ct-glass-edge); }
.ct-table tr.now td { font-weight: 600; color: var(--sf-text); background: color-mix(in srgb, var(--ct-now) 13%, transparent); }
.ct-table tr.now td:first-child { color: var(--sf-text); box-shadow: inset 3px 0 0 var(--ct-now); }
.ct-table tr.dim td { opacity: 0.55; }
.ct-table .mark { font-weight: 500; font-size: 0.85em; color: var(--ct-now); margin-left: 4px; }
.ct-table .sub { display: block; font-size: 0.82em; color: var(--sf-text-2); font-weight: 400; }
.ct-table .credit, .ct-table tr td.credit { color: var(--sf-credit); }
.ct-table .cell-label { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.ct-table .sf-dot { width: 8px; height: 8px; }

/* pill tabs */
.ct-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.ct-tab {
  border-radius: 999px;
  padding: 3px 11px;
  font-size: 0.8em;
  border: 1px solid var(--ct-glass-edge);
  background: transparent;
  color: var(--sf-text-2);
  user-select: none;
}
.ct-tab[aria-pressed="true"] {
  color: var(--sf-text);
  background: color-mix(in srgb, var(--sf-text) 10%, transparent);
  border-color: color-mix(in srgb, var(--sf-text) 22%, transparent);
}

/* charts */
.ct-chart { position: relative; min-width: 0; outline: none; }
.ct-chart svg { display: block; width: 100%; overflow: visible; }
.ct-chart .axis text { fill: var(--sf-text-2); font-size: 10.5px; font-variant-numeric: tabular-nums; }
.ct-chart .gridline { stroke: var(--ct-grid); stroke-width: 1; shape-rendering: crispEdges; }
.ct-chart .zero { stroke: var(--ct-axis); stroke-width: 1; shape-rendering: crispEdges; }
.ct-chart .series-line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.ct-chart .series-area-line { fill: none; stroke-width: 1.6; stroke-linejoin: round; }
.ct-chart .cross { stroke: color-mix(in srgb, var(--sf-text) 40%, transparent); stroke-width: 1; stroke-dasharray: 3 3; shape-rendering: crispEdges; }
.ct-chart .hover-dot { stroke: var(--card-background-color, #1c1c1c); stroke-width: 2; }
.ct-chart .band { fill: color-mix(in srgb, var(--sf-text) 7%, transparent); }
.ct-chart .bar { shape-rendering: geometricPrecision; }
.ct-chart .overlay { fill: transparent; cursor: crosshair; }
.ct-chart .empty { fill: var(--sf-text-2); font-size: 12px; }
.ct-chart:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: 4px; border-radius: 4px; }
.ct-tip {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 2;
  min-width: 120px;
  padding: 7px 10px;
  border-radius: 8px;
  background: rgba(20, 24, 30, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  color: #fff;
  font-size: 0.8em;
  line-height: 1.35;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.12s;
}
.ct-tip.on { opacity: 1; }
.ct-tip .when { font-size: 0.85em; letter-spacing: 0.04em; opacity: 0.75; margin-bottom: 3px; }
.ct-tip .row { display: flex; align-items: center; gap: 6px; }
.ct-tip .row .v { margin-left: auto; padding-left: 12px; font-weight: 600; }
.ct-tip .sf-dot { width: 8px; height: 8px; }
.ct-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 0.8em; color: var(--sf-text-2); }
.ct-legend .item { display: inline-flex; align-items: center; gap: 6px; }
.ct-legend .item b { color: var(--sf-text); font-weight: 600; font-variant-numeric: tabular-nums; }
.ct-legend .swatch { width: 12px; height: 3px; border-radius: 2px; }
.ct-legend .swatch.area { height: 8px; border-radius: 2px; opacity: 0.85; }
.ct-legend .swatch.bar { width: 8px; height: 8px; border-radius: 2px; }
@container (max-width: 480px) {
  table.ct-table { font-size: 0.84em; }
  .ct-table th, .ct-table td { padding-left: 5px; padding-right: 5px; }
  .ct-table th:first-child, .ct-table td:first-child { padding-left: 8px; }
  .ct-table th:last-child, .ct-table td:last-child { padding-right: 8px; }
  /* "(now)" shrinks to a dot; the text stays for screen readers */
  .ct-table .mark { font-size: 0; margin-left: 6px; }
  .ct-table .mark::before { content: ""; display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--ct-now); vertical-align: middle; }
  .ct-hero .big { font-size: 1.7em; }
  .ct-hero .side { margin-left: 0; text-align: left; }
}
@media (prefers-reduced-motion: reduce) {
  .ct-tip { transition: none; }
}
`);
