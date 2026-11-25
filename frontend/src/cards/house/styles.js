// House card CSS. Colors are the shared --sf-* variables, so a card config
// can recolor any flow with colors: {solar: "#ffaa00", ...}.

export const houseStyles = `
ha-card { overflow: hidden; }
.scene {
  position: relative; width: 100%; container-type: inline-size;
  background: var(--sf-scene-bg); overflow: hidden;
  --night-dim: 0.5;
}
.scene img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: opacity 1.5s ease, filter 1.5s ease; user-select: none; pointer-events: none; }
.scene img.night { opacity: 0; }
.scene.is-night img.night { opacity: 1; }
.scene.auto-night.is-night img.day { filter: brightness(.42) saturate(.7) hue-rotate(-8deg); }
.scene .tint { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity 1.5s ease; background: linear-gradient(180deg, rgba(10, 20, 50, .45), rgba(10, 16, 36, .25)); }
.scene.auto-night.is-night .tint { opacity: 1; }
.scene img.carimg { inset: auto; height: auto; object-fit: contain; opacity: 0; filter: drop-shadow(0 6px 6px rgba(0, 0, 0, .35)); transition: opacity 1s, filter 1.5s; }
.scene img.carimg.flip { transform: scaleX(-1); }
.scene img.carimg.here { opacity: 1; }
.scene.is-night img.carimg { filter: brightness(var(--night-dim)) saturate(.75) drop-shadow(0 6px 6px rgba(0, 0, 0, .5)); }
svg.ov { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }

/* built-in house */
.bg * { transition: fill 1.5s ease, opacity 1.5s ease; }
.bg .sky-n, .bg .stars, .bg .wlit, .bg .glow { opacity: 0; }
.is-night .bg .sky-n, .is-night .bg .stars, .is-night .bg .wlit, .is-night .bg .glow { opacity: 1; }
.bg .star { fill: #dfe8ff; opacity: .8; }
.bg .moon { fill: #f1f0e6; }
.bg .hill2 { fill: #8fa4b4; }
.bg .hill { fill: #71836c; }
.bg .walk { fill: #b9b6ae; }
.bg .street { fill: #4a4d52; }
.bg .curb { stroke: #d5d2ca; stroke-width: 4; }
.bg .gutter { stroke: rgba(0, 0, 0, .22); stroke-width: 10; }
.bg .lane { stroke: #e9d27a; stroke-width: 5; stroke-dasharray: 70 60; opacity: .85; }
.bg .drive, .bg .path { fill: #c7c3ba; }
.bg .leaf { fill: #55684a; }
.bg .leaf2 { fill: #48593f; }
.bg .trunk { fill: #5a4a3c; }
.bg .hshade { fill: rgba(0, 0, 0, .18); }
.bg .gshade { fill: rgba(0, 0, 0, .12); }
.bg .wall { fill: #d8cfc1; }
.bg .wall2 { fill: #cfc5b6; }
.bg .trim { stroke: #9c9385; stroke-width: 6; }
.bg .eave { stroke: #2d3036; stroke-width: 7; stroke-linecap: round; }
.bg .pv { fill: url(#pvg); stroke: #8b93a3; stroke-width: 1.2; }
.bg .pvline { stroke: rgba(160, 185, 230, .25); stroke-width: .8; fill: none; }
.bg .wframe { fill: #f1ede6; }
.bg .wglass { fill: #7d93a8; }
.bg .wlit { fill: #ffcf7f; }
.bg .wbar { stroke: #f1ede6; stroke-width: 3; fill: none; }
.bg .door { fill: #6b5444; }
.bg .knob { fill: #d8c38e; }
.bg .gdoor { fill: #ebe6dc; stroke: #b2ab9f; stroke-width: 2; }
.bg .gline { stroke: #c6bfb2; stroke-width: 2; fill: none; }
.bg .lamp rect { fill: #3a3a3a; }
.is-night .bg .hill2 { fill: #1b2436; }
.is-night .bg .hill { fill: #151e1b; }
.is-night .bg .ground { opacity: .3; }
.is-night .bg .walk { fill: #3d3e44; }
.is-night .bg .street { fill: #1d1f24; }
.is-night .bg .curb { stroke: #55565c; }
.is-night .bg .lane { stroke: #8a7d4d; opacity: .6; }
.is-night .bg .drive, .is-night .bg .path { fill: #4a4a4c; }
.is-night .bg .leaf { fill: #1f2a1e; }
.is-night .bg .leaf2 { fill: #192218; }
.is-night .bg .trunk { fill: #2a231d; }
.is-night .bg .wall { fill: #5a544c; }
.is-night .bg .wall2 { fill: #534d45; }
.is-night .bg .trim { stroke: #3e3a35; }
.is-night .bg .wframe, .is-night .bg .wbar { fill: #6e6960; stroke: #6e6960; }
.is-night .bg .door { fill: #3a2d24; }
.is-night .bg .gdoor { fill: #67625a; stroke: #4c4842; }
.is-night .bg .gline { stroke: #57534c; }
.is-night .bg .lamp rect { fill: #ffd37f; }
.is-night .bg .pv { stroke: #3c4250; }
.bcar, .charger { opacity: 0; transition: opacity 1s; }
.bcar.here, .charger.here { opacity: 1; }
.bcar .cbody { fill: #9aa3ad; }
.bcar .ctail { fill: #d23b3b; }
.is-night .bcar .cbody { fill: #4c5259; }
.is-night .bcar .ctail { fill: #ff4a4a; }

/* flows: five strokes per line. Wide static underlays fake the glow (an SVG
   filter would re-blur every animation frame). */
.track, .tglow { fill: none; stroke-width: 4.5; stroke-linecap: round; stroke-linejoin: round; opacity: 0; transition: opacity .8s, stroke .8s; }
.tglow { stroke-width: 11; }
.tglow.far { stroke-width: 18; }
.pulse { fill: none; stroke-width: 4.5; stroke-linecap: round; stroke-linejoin: round; stroke: #fff; stroke-dasharray: 110 890; opacity: 0; transition: opacity .8s; will-change: stroke-dashoffset; }
.halo { fill: none; stroke-width: 14; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 130 870; opacity: 0; transition: opacity .8s; will-change: stroke-dashoffset; }
g.on .track { opacity: .9; } g.on .pulse { opacity: .95; } g.on .halo { opacity: .35; } g.on .tglow { opacity: .22; } g.on .tglow.far { opacity: .1; }
.solar .track, .solar .tglow { stroke: var(--sf-solar); }
.import .track, .import .tglow { stroke: var(--sf-import); }
.export .track, .export .tglow { stroke: var(--sf-export); }
.home .track, .home .tglow { stroke: var(--sf-home); }
.batt .track, .batt .tglow { stroke: var(--sf-battery); }
.solar .pulse { stroke: var(--sf-solar-pulse); } .import .pulse { stroke: var(--sf-import-pulse); }
.export .pulse { stroke: var(--sf-export-pulse); } .home .pulse { stroke: var(--sf-home-pulse); } .batt .pulse { stroke: var(--sf-battery-pulse); }
.solar .halo { stroke: var(--sf-solar-halo); } .import .halo { stroke: var(--sf-import-halo); }
.export .halo { stroke: var(--sf-export-halo); } .home .halo { stroke: var(--sf-home-halo); } .batt .halo { stroke: var(--sf-battery-halo); }

/* EV cable: matte black cable on the ground, handle in the port, a soft
   light gliding along it while charging. Sizes scale with --k (car size). */
.cable { opacity: 0; transition: opacity .8s; --k: 1; }
.cable.on, .cable.plugged { opacity: 1; }
.cable path { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.cable .cshadow2 { stroke: rgba(0, 0, 0, .14); stroke-width: calc(10px * var(--k)); transform: translate(calc(1.8px * var(--k)), calc(3.2px * var(--k))); }
.cable .cshadow { stroke: rgba(0, 0, 0, .38); stroke-width: calc(6.5px * var(--k)); transform: translate(calc(1.2px * var(--k)), calc(2px * var(--k))); }
.cable .ccontact { stroke: rgba(0, 0, 0, .45); stroke-width: calc(4.4px * var(--k)); transform: translate(calc(.6px * var(--k)), calc(1.1px * var(--k))); }
.cable .ccore { stroke: #1a1b1e; stroke-width: calc(3.8px * var(--k)); }
.cable .chi { stroke: rgba(255, 255, 255, .16); stroke-width: calc(.9px * var(--k)); transform: translate(calc(-.5px * var(--k)), calc(-.9px * var(--k))); }
.cable .halo, .cable .pulse { stroke: var(--sf-ev); stroke-linecap: butt; will-change: stroke-dashoffset; }
/* stacked dashes around one point read as a single soft light */
.cable .halo { stroke-width: calc(8px * var(--k)); stroke-dasharray: 0 50 300 650; }
.cable .pulse.p1 { stroke-width: calc(5px * var(--k)); stroke-dasharray: 0 90 220 690; }
.cable .pulse.p2 { stroke-width: calc(3.6px * var(--k)); stroke-dasharray: 0 125 150 725; }
.cable .pulse.p3 { stroke: var(--sf-ev-pulse); stroke-width: calc(2.6px * var(--k)); stroke-dasharray: 0 155 90 755; }
.cable .pulse.p4 { stroke: var(--sf-ev-core); stroke-width: calc(1.5px * var(--k)); stroke-dasharray: 0 180 40 780; }
.cable.on .halo { opacity: .08; } .cable.on .pulse.p1 { opacity: .14; } .cable.on .pulse.p2 { opacity: .26; } .cable.on .pulse.p3 { opacity: .55; } .cable.on .pulse.p4 { opacity: .95; }
/* steady thin green line inside the cable: reads as charging without motion */
.cable .ctint { stroke: var(--sf-export); stroke-width: calc(1.2px * var(--k)); opacity: 0; transition: opacity .8s; }
.cable.on .ctint { opacity: .35; }
.cable .cseal { fill: #2a2622; opacity: .75; }
.cable .hshadow { fill: #000; opacity: .3; }
.cable .hbody { fill: url(#hgrad); stroke: #0c0d0f; stroke-width: .6; }
.cable .hhi { fill: none; stroke: rgba(255, 255, 255, .35); stroke-width: .7; stroke-linecap: round; }
.cable .hhi.dim { stroke-width: 1.4; stroke: rgba(255, 255, 255, .12); }
.cable .hled { fill: #cfd6dc; opacity: .85; }
.cable .hglow { fill: url(#hglowg); opacity: 0; transition: opacity .8s; }
.cable.on .hled { fill: #4dffa6; opacity: 1; }
.cable.on .hglow { opacity: 1; animation: hbreathe 2.4s ease-in-out infinite; }
@keyframes hbreathe { 50% { opacity: .45; } }
.is-night .cable .chi, .is-night .cable .hhi { stroke: rgba(255, 255, 255, .22); }

/* panel, battery, junction */
.is-night .panel, .is-night .battery { filter: brightness(.5); }
.battery .bfill { fill: var(--sf-battery); opacity: .9; }
.battery .bled { fill: #9aa0a6; }
.battery.charging .bled, .battery.discharging .bled { fill: var(--sf-battery); }
.node .nglow { fill: var(--sf-export); opacity: .4; }
.node .ncore { fill: #f2fff7; stroke: var(--sf-export); stroke-width: 1.5; }

/* still: reduced motion or animation turned off. The cable still reads as
   charging through the tint line and the lit LED. */
.still .halo, .still .pulse { opacity: 0 !important; }
.still .cable.on .hglow { animation: none; }
@media (prefers-reduced-motion: reduce) {
  .halo, .pulse { opacity: 0 !important; }
  .cable.on .hglow { animation: none; }
}

/* chips */
.chip {
  position: absolute; transform: translate(-50%, 0); background: rgba(20, 24, 30, .72); color: #fff;
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  border: 1px solid rgba(255, 255, 255, .18); border-radius: clamp(6px, 1.1cqw, 12px);
  padding: clamp(3px, .7cqw, 9px) clamp(6px, 1.2cqw, 14px);
  font-size: clamp(10px, 1.55cqw, 17px); line-height: 1.2; white-space: nowrap;
  box-shadow: 0 2px 10px rgba(0, 0, 0, .35); box-sizing: border-box;
}
.chip[role="button"] { cursor: pointer; }
.tether { transition: opacity 1s; }
.tether.off { opacity: 0; }
.tether line { stroke: rgba(255, 255, 255, .6); stroke-width: 1.6; }
.tether circle { fill: rgba(255, 255, 255, .9); }
.chip:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: 2px; }
.chip.right { transform: translate(-100%, 0); }
.chip.left { transform: none; }
.chip .k { font-size: .72em; letter-spacing: .06em; text-transform: uppercase; opacity: .8; display: flex; align-items: center; gap: .35em; }
.chip .v { font-weight: 600; font-size: 1.25em; font-variant-numeric: tabular-nums; }
.chip .s { font-size: .78em; opacity: .85; }
.chip .dot { width: .6em; height: .6em; border-radius: 50%; display: inline-block; flex: none; transition: background .8s; }
.chip.unconfigured { opacity: .6; }
/* small cards: chips take up more of the picture, so the solar and home
   chips drop their "producing" / "using now" line */
@container (max-width: 420px) {
  .chip[data-k="solar"] .s, .chip[data-k="home"] .s { display: none; }
}
.stack { position: absolute; transform: translate(-100%, 0); display: flex; flex-direction: column; align-items: stretch; gap: clamp(3px, .6cqw, 8px); }
.stack.left { transform: none; } .stack.center { transform: translate(-50%, 0); }
.stack .chip { position: static; transform: none; }
.share { display: flex; align-items: center; gap: .45em; margin-top: .3em; font-size: .82em; }
.share svg { width: 2.1em; height: 2.1em; flex: none; }
.share svg circle { fill: none; stroke-width: 6; }
.share .rg { stroke: var(--sf-ring-grid); }
.share .rs { stroke: var(--sf-ring-solar); }
.share b { font-size: 1.15em; }
.share span { opacity: .8; }
.trows { display: grid; grid-template-columns: auto auto; column-gap: .7em; row-gap: .1em; margin-top: .25em; font-size: .78em; }
.trows span:nth-child(odd) { opacity: .75; }
.trows span:nth-child(even) { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.bar { position: relative; height: .3em; border-radius: .2em; background: rgba(255, 255, 255, .2); margin-top: .3em; overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--sf-dot-car); }
.bar b { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: #fff; opacity: .85; }
.bar.batt i { background: var(--sf-battery); }

/* footer */
.foot { padding: 12px 16px 14px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
.head { font-size: 1.15em; font-weight: 500; color: var(--sf-text); flex: 1 1 260px; }
.sub { font-size: .9em; color: var(--sf-text-2); margin-top: 2px; }
.foot .pill { border-radius: 999px; padding: 4px 12px; font-size: .85em; border: 1px solid var(--sf-divider); color: var(--sf-text); white-space: nowrap; }
.foot .pill.warn { border-color: var(--sf-warn); color: var(--sf-warn-text); }
`;
