// The demo's light look. hostSheet sizes the element; cardSheet is added on
// top of the house card's own sheets.

import { sheet } from "../common/dom.js";

export const hostSheet = sheet(`
:host { display: block; position: relative; width: 100%; aspect-ratio: 16 / 10; contain: content; }
.wrap { position: absolute; inset: 0; display: flex; align-items: center; }
sunflow-house-card { display: block; width: 100%; }
`);

export const cardSheet = sheet(`
:host {
  --sf-text: #143222;
  --sf-text-2: #3d5a49;
  --sf-solar: #f2b705;
  --sf-solar-halo: #f5e625;
  --sf-solar-pulse: #fffbd1;
  --sf-dot-solar: #f5e625;
  --sf-home: #2f86e6;
  --sf-export: #18b86a;
  --sf-export-halo: #3fe08f;
  --sf-dot-export: #18b86a;
  --sf-ev: #2fe08a;
  --primary-color: #1e4d35;
}
ha-card { background: transparent; border: 0; box-shadow: none; }
.scene { background: transparent; }
/* the 2:1 picture runs full width in the 16:10 card; keep in step with
   PICTURE_Y in layout.js */
.scene img.day, .scene img.night { object-fit: contain; object-position: 50% 70%; }
/* the picture already has a battery on the wall; only the line and chip are drawn */
.battery { display: none; }
.node .nglow { fill: #f5e625; opacity: .55; }
.node .ncore { fill: #fff; stroke: #1e4d35; stroke-width: 2; }

/* frosted light chips */
.chip {
  background: rgb(255 255 255 / .78); color: #143222;
  border: 1px solid rgb(22 53 37 / .12);
  box-shadow: 0 6px 18px rgb(20 50 34 / .12), 0 1px 2px rgb(20 50 34 / .08);
  backdrop-filter: blur(10px) saturate(1.3); -webkit-backdrop-filter: blur(10px) saturate(1.3);
  font-size: clamp(9px, 1.45cqw, 15px);
}
.chip .k { opacity: .7; }
.chip .s { opacity: .78; }
.chip .dot { box-shadow: 0 0 0 1px rgb(20 50 34 / .18); }
.chip:focus-visible { outline-color: #1e4d35; }
/* both car chips the same size, tied to their cars by a thin line */
.chip[data-k^="car"] { min-width: 12.4cqw; box-sizing: border-box; }
.tether line { stroke: rgb(20 50 34 / .62); stroke-width: 2; }
.tether circle { fill: #fff; stroke: #143222; stroke-width: 1.6; }
.bar { background: rgb(20 50 34 / .12); }
.bar b { background: #143222; }
.share .rg { stroke: rgb(20 50 34 / .18); }
.share .rs { stroke: #f2b705; }

/* night: the chips stay light (the site's stage is light either way), just
   a little more solid against the dark picture */
.scene.is-night .chip { background: rgb(255 255 255 / .86); }

/* charging: a clear green line in the cable, even with motion turned off */
.cable .ctint { stroke-width: calc(1.8px * var(--k)); }
.cable.on .ctint { opacity: .85; }

/* small screens: fewer, smaller chips */
@container (max-width: 640px) {
  .chip { font-size: clamp(8px, 2.1cqw, 11px); padding: 2px 6px; border-radius: 6px; }
  .chip .s, .chip[data-k="today"] { display: none; }
  .chip.unconfigured { display: none; }
}
@container (max-width: 420px) {
  .chip[data-k^="car"] { min-width: 4.6em; }
}
`);
