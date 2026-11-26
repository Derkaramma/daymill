// Editor CSS. Uses HA's theme variables so it fits the card editor dialog.

export const editorStyles = `
:host {
  display: block;
  --ed-accent: var(--primary-color, #03a9f4);
  --ed-text: var(--primary-text-color, #e1e1e1);
  --ed-text-2: var(--secondary-text-color, #9b9b9b);
  --ed-line: var(--divider-color, rgba(127, 127, 127, .3));
  --ed-bg: var(--card-background-color, #1c1c1c);
  --ed-bg-2: var(--secondary-background-color, rgba(127, 127, 127, .12));
  color: var(--ed-text);
  font-size: 14px;
}
.ed { display: flex; flex-direction: column; gap: 10px; min-width: 0; }

/* preview with handles */
.pv { position: relative; touch-action: none; user-select: none; -webkit-user-select: none; }
.pv daymill-house-card { display: block; }
.edov { position: absolute; left: 0; top: 0; width: 0; height: 0; touch-action: none; overflow: visible; }
.edov.add { cursor: crosshair; }
.edov svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.edov [data-kind] { cursor: grab; outline: none; }
.edov.dragging, .edov.dragging [data-kind] { cursor: grabbing; }
.edov .hit { fill: transparent; stroke: transparent; }
.edov .seg { fill: none; stroke: transparent; stroke-width: 16px; stroke-linecap: round; cursor: copy; }
.edov .guide { fill: none; stroke: rgba(255, 255, 255, .55); stroke-width: 1.5px; stroke-dasharray: 4 4; pointer-events: none; }
.edov .path { fill: none; stroke: #fff; stroke-width: 2.5px; stroke-linejoin: round; pointer-events: none; filter: drop-shadow(0 0 2px rgba(0, 0, 0, .8)); }
.edov .box { fill: rgba(3, 169, 244, .12); stroke: var(--ed-accent); stroke-width: 2px; stroke-dasharray: 5 3; }
.edov .still { pointer-events: none; }
.edov .box.soft { fill: transparent; stroke: rgba(255, 255, 255, .6); }
.edov .dot { fill: #fff; stroke: var(--ed-accent); stroke-width: 2.5px; pointer-events: none; }
.edov .dot.end { fill: var(--ed-accent); stroke: #fff; }
.edov .dot.port { fill: #3dffa0; stroke: #0b3; }
.edov .dot.start { fill: #ffd24d; stroke: #a70; }
.edov .snapmark { fill: none; stroke: #ffd24d; stroke-width: 1.5px; pointer-events: none; }
.edov [data-kind].sel .dot, .edov [data-kind]:focus-visible .dot { stroke: #ffd24d; stroke-width: 3.5px; }
.edov [data-kind].sel .box, .edov [data-kind]:focus-visible .box, .edov .box.sel { stroke: #ffd24d; stroke-dasharray: none; }
.edov [data-kind]:focus-visible .hit { stroke: #ffd24d; stroke-width: 2px; }
.edov .tag { font: 600 11px/1 sans-serif; fill: #fff; paint-order: stroke; stroke: rgba(0, 0, 0, .75); stroke-width: 3px; pointer-events: none; }

/* scenario bar */
.scen { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.scen button { font-size: .8em; padding: 3px 10px; min-height: 28px; }
.scen .lbl { color: var(--ed-text-2); font-size: .85em; margin-right: 2px; }
.scen .note { flex-basis: 100%; color: var(--ed-text-2); font-size: .8em; }
.seg-group { display: inline-flex; border: 1px solid var(--ed-line); border-radius: 999px; overflow: hidden; }
.seg-group button { border: 0; border-radius: 0; }

button, .btn {
  font: inherit; font-size: .88em; color: var(--ed-text); background: var(--ed-bg-2);
  border: 1px solid var(--ed-line); border-radius: 999px; padding: 5px 12px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px; min-height: 30px; box-sizing: border-box;
}
button:hover:not([disabled]) { border-color: var(--ed-accent); }
button[aria-pressed="true"], button.on { background: var(--ed-accent); border-color: var(--ed-accent); color: var(--text-primary-color, #fff); }
button[disabled] { opacity: .45; cursor: default; }
button.danger { color: var(--error-color, #db4437); }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, [role="tab"]:focus-visible, summary:focus-visible {
  outline: 2px solid var(--ed-accent); outline-offset: 2px;
}

/* toolbar + tabs */
.bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.bar .sp { flex: 1; }
.hint { color: var(--ed-text-2); font-size: .88em; line-height: 1.4; }
.tabs { display: flex; flex-wrap: wrap; gap: 2px; border-bottom: 1px solid var(--ed-line); }
.tabs [role="tab"] {
  border: 0; border-radius: 0; background: none; padding: 8px 10px; min-height: 36px;
  border-bottom: 2px solid transparent; color: var(--ed-text-2); white-space: nowrap; flex: none;
}
.tabs [role="tab"][aria-selected="true"] { color: var(--ed-accent); border-bottom-color: var(--ed-accent); }
.beta { font-size: .7em; text-transform: uppercase; letter-spacing: .05em; border: 1px solid currentColor; border-radius: 4px; padding: 0 4px; opacity: .8; }
.body { display: flex; flex-direction: column; gap: 12px; padding: 4px 0 8px; }

/* form bits */
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.field > span, .lab { font-size: .85em; color: var(--ed-text-2); }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px 14px; }
input[type="text"], input[type="url"], select, textarea {
  font: inherit; color: var(--ed-text); background: var(--ed-bg); border: 1px solid var(--ed-line);
  border-radius: 6px; padding: 6px 8px; min-height: 32px; box-sizing: border-box; width: 100%; min-width: 0;
}
textarea { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .82em; min-height: 140px; resize: vertical; }
input[type="range"] { width: 100%; margin: 0; box-sizing: border-box; accent-color: var(--ed-accent); }
input[type="checkbox"] { width: 18px; height: 18px; accent-color: var(--ed-accent); margin: 0; flex: none; }
input[type="color"] { width: 40px; height: 30px; border: 1px solid var(--ed-line); border-radius: 6px; padding: 2px; background: var(--ed-bg); }
.check { display: inline-flex; gap: 8px; align-items: center; cursor: pointer; min-height: 30px; }
.rangev { font-variant-numeric: tabular-nums; color: var(--ed-text); margin-left: 6px; }
.file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.msg { font-size: .85em; color: var(--ed-text-2); line-height: 1.4; }
.msg.warn { color: var(--warning-color, #ffa600); }
.msg.err { color: var(--error-color, #db4437); }
.msg.ok { color: var(--success-color, #43a047); }
.card { border: 1px solid var(--ed-line); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }
.card h4 { margin: 0; font-size: .95em; font-weight: 500; display: flex; align-items: center; gap: 8px; }
.list { display: flex; flex-direction: column; gap: 6px; }
.chiprow { display: grid; grid-template-columns: minmax(70px, 1fr) auto minmax(90px, 130px) auto; gap: 8px; align-items: center; }
.colrow { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: center; }
details summary { cursor: pointer; color: var(--ed-text-2); font-size: .9em; }
details[open] summary { margin-bottom: 8px; }
@media (max-width: 560px) {
  .chiprow { grid-template-columns: 1fr auto; }
}
`;
