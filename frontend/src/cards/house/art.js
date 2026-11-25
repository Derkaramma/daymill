// SVG markup for the house card: gradients, the meter/breaker panel, the
// battery, the charge handle, a plain built-in house for when no photo is
// set, and a simple car for cars without a picture.
//
// Markup only uses presentation attributes, never style="", so it is fine
// under a strict CSP.

const f = (n) => Math.round(n * 100) / 100;

export const DEFS = `
<filter id="carsil" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 20 -16"/></filter>
<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5"/></filter>
<linearGradient id="hgrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b5e64"/><stop offset=".35" stop-color="#3a3c41"/><stop offset="1" stop-color="#16171a"/></linearGradient>
<radialGradient id="hglowg"><stop offset="0" stop-color="#4dffa6" stop-opacity=".75"/><stop offset=".4" stop-color="#2fe08a" stop-opacity=".3"/><stop offset="1" stop-color="#2fe08a" stop-opacity="0"/></radialGradient>
<linearGradient id="pbody" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d6d9dc"/><stop offset=".55" stop-color="#b3b7bb"/><stop offset="1" stop-color="#878c92"/></linearGradient>
<linearGradient id="pdoor" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c8cbcf"/><stop offset="1" stop-color="#9da1a6"/></linearGradient>
<linearGradient id="phood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e4e6e8"/><stop offset="1" stop-color="#8e9398"/></linearGradient>
<linearGradient id="pcond" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7d8287"/><stop offset=".45" stop-color="#c4c8cc"/><stop offset="1" stop-color="#6d7277"/></linearGradient>
<radialGradient id="pring" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#f4f5f6"/><stop offset=".7" stop-color="#a9aeb3"/><stop offset="1" stop-color="#7a7f84"/></radialGradient>
<radialGradient id="pglass" cx=".32" cy=".28" r=".75"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset=".35" stop-color="#fff" stop-opacity=".12"/><stop offset=".85" stop-color="#9fb4c4" stop-opacity=".08"/><stop offset="1" stop-color="#4b5964" stop-opacity=".35"/></radialGradient>
<linearGradient id="bbody" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f3f4f5"/><stop offset=".6" stop-color="#d9dcdf"/><stop offset="1" stop-color="#a9adb2"/></linearGradient>`;

// Meter + breaker panel, drawn flat then skewed to the wall angle: rain hood,
// round glass meter with a small LCD, breaker door with seam and latch,
// conduits top and bottom. Sizes are tuned for a 24 x 86 panel and scale
// with the width.
export function panelSvg({ x, y, w, h, skew, style }) {
  const u = w / 24;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const tf = `translate(${f(cx)},${f(cy)}) skewY(${f(skew)}) translate(${f(-cx)},${f(-cy)})`;
  if (style === "box") {
    return `<g class="panel" transform="${tf}">
<rect x="${f(x + 3 * u)}" y="${f(y + 5 * u)}" width="${f(w)}" height="${f(h)}" rx="${f(2.5 * u)}" fill="rgba(0,0,0,.38)" filter="url(#soft)"/>
<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${f(2.5 * u)}" fill="url(#pbody)" stroke="#5d6267" stroke-width="${f(0.8 * u)}"/>
<rect x="${f(x + 3 * u)}" y="${f(y + 4 * u)}" width="${f(w - 6 * u)}" height="${f(h - 8 * u)}" rx="${f(1.5 * u)}" fill="url(#pdoor)" stroke="rgba(0,0,0,.4)" stroke-width="${f(0.7 * u)}"/></g>`;
  }
  const mr = Math.min(11.5 * u, w / 2 - 2.5 * u);
  const my = y + 9 * u + mr;
  const lw = mr * 1.13;
  const dy = Math.min(y + 44 * u, y + h * 0.62);
  const dh = y + h - dy - 4 * u;
  return `<g class="panel" transform="${tf}">
<rect x="${f(x + 3 * u)}" y="${f(y + 5 * u)}" width="${f(w)}" height="${f(h)}" rx="${f(2.5 * u)}" fill="rgba(0,0,0,.38)" filter="url(#soft)"/>
<rect x="${f(cx - 2.6 * u)}" y="${f(y - 14 * u)}" width="${f(5.2 * u)}" height="${f(16 * u)}" fill="url(#pcond)" stroke="#555a5f" stroke-width="${f(0.5 * u)}"/>
<rect x="${f(cx - 2.6 * u)}" y="${f(y + h - 2 * u)}" width="${f(5.2 * u)}" height="${f(14 * u)}" fill="url(#pcond)" stroke="#555a5f" stroke-width="${f(0.5 * u)}"/>
<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${f(2.5 * u)}" fill="url(#pbody)" stroke="#5d6267" stroke-width="${f(0.8 * u)}"/>
<rect x="${f(x - 1.5 * u)}" y="${f(y - 2 * u)}" width="${f(w + 3 * u)}" height="${f(5 * u)}" rx="${f(1.5 * u)}" fill="url(#phood)" stroke="#5d6267" stroke-width="${f(0.5 * u)}"/>
<rect x="${f(x + u)}" y="${f(y + 3.5 * u)}" width="${f(w - 2 * u)}" height="${f(1.2 * u)}" fill="rgba(0,0,0,.18)"/>
<circle cx="${f(cx + 1.2 * u)}" cy="${f(my + 1.6 * u)}" r="${f(mr + u)}" fill="rgba(0,0,0,.28)"/>
<circle cx="${f(cx)}" cy="${f(my)}" r="${f(mr + 1.6 * u)}" fill="url(#pring)" stroke="#62676c" stroke-width="${f(0.6 * u)}"/>
<circle cx="${f(cx)}" cy="${f(my)}" r="${f(mr)}" fill="#e9ecef"/>
<rect x="${f(cx - lw / 2 - 0.8 * u)}" y="${f(my - u)}" width="${f(lw + 1.6 * u)}" height="${f(5.2 * u)}" rx="${f(0.8 * u)}" fill="#26302a"/>
<rect x="${f(cx - lw / 2)}" y="${f(my + 0.2 * u)}" width="${f(lw)}" height="${f(2.8 * u)}" rx="${f(0.4 * u)}" fill="#7fe0a6" opacity=".75"/>
<rect x="${f(cx - lw / 2)}" y="${f(my - mr * 0.56)}" width="${f(lw)}" height="${f(1.4 * u)}" rx="${f(0.5 * u)}" fill="#9aa0a6"/>
<circle cx="${f(cx)}" cy="${f(my)}" r="${f(mr)}" fill="url(#pglass)"/>
<rect x="${f(x + 3 * u)}" y="${f(dy)}" width="${f(w - 6 * u)}" height="${f(dh)}" rx="${f(1.5 * u)}" fill="url(#pdoor)" stroke="rgba(0,0,0,.4)" stroke-width="${f(0.7 * u)}"/>
<line x1="${f(x + 5 * u)}" y1="${f(dy + 3 * u)}" x2="${f(x + 5 * u)}" y2="${f(y + h - 7 * u)}" stroke="rgba(255,255,255,.35)" stroke-width="${f(0.8 * u)}"/>
<rect x="${f(x + w - 8.5 * u)}" y="${f(dy + dh / 2 - 3 * u)}" width="${f(2.6 * u)}" height="${f(7 * u)}" rx="${f(u)}" fill="#3a3e42"/>
<rect x="${f(x + 6 * u)}" y="${f(dy + 5 * u)}" width="${f(Math.min(10 * u, w - 14 * u))}" height="${f(4 * u)}" rx="${f(0.8 * u)}" fill="#f1f2f3" opacity=".85"/></g>`;
}

// Wall battery: a slim white cabinet with a light strip that shows charge.
// The strip element (.bfill) is sized from the state of charge at render.
export function batterySvg({ x, y, w, h, skew }) {
  const u = w / 30;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const sx = cx - 2 * u;
  const top = y + 10 * u;
  const len = h - 20 * u;
  return {
    svg: `<g class="battery" transform="translate(${f(cx)},${f(cy)}) skewY(${f(skew)}) translate(${f(-cx)},${f(-cy)})">
<rect x="${f(x + 3 * u)}" y="${f(y + 5 * u)}" width="${f(w)}" height="${f(h)}" rx="${f(4 * u)}" fill="rgba(0,0,0,.35)" filter="url(#soft)"/>
<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${f(4 * u)}" fill="url(#bbody)" stroke="#8d9297" stroke-width="${f(0.8 * u)}"/>
<rect x="${f(x + 2 * u)}" y="${f(y + 2 * u)}" width="${f(w - 4 * u)}" height="${f(1.2 * u)}" rx="${f(0.6 * u)}" fill="rgba(255,255,255,.7)"/>
<rect class="btrack" x="${f(sx)}" y="${f(top)}" width="${f(4 * u)}" height="${f(len)}" rx="${f(2 * u)}" fill="rgba(0,0,0,.18)"/>
<rect class="bfill" x="${f(sx)}" y="${f(top)}" width="${f(4 * u)}" height="${f(len)}" rx="${f(2 * u)}"/>
<circle class="bled" cx="${f(cx)}" cy="${f(y + h - 6 * u)}" r="${f(1.6 * u)}"/></g>`,
    strip: { top, len },
  };
}

// Charge handle drawn tail (x=0, where the cable enters) to tip (x=21.2, in
// the port). Placed and rotated along the end of the cable at render time.
const HANDLE_BODY = "M0,-2.4 L4,-2.8 C7,-3.6 10,-3.7 15,-3.7 L15.6,-4.5 L20,-4.3 Q21.2,-4.3 21.2,-3 L21.2,3 Q21.2,4.3 20,4.3 L15.6,4.5 L15,3.5 C10,3.5 7,4 4,2.8 L0,2.4 Z";
export const HANDLE = `<path class="hshadow" transform="translate(2,3)" d="${HANDLE_BODY}"/><path class="hbody" d="${HANDLE_BODY}"/>`
  + `<path class="hhi" d="M4.5,-2.3 C7.5,-3 10,-3.1 14.5,-3.1 M16.3,-3.7 L20,-3.6"/><path class="hhi dim" d="M8.5,-1.2 L12.5,-1.2"/>`
  + `<ellipse class="hglow" cx="15.3" cy="0" rx="9" ry="9"/><rect class="hled" x="14.8" y="-4.1" width="1.3" height="8.2" rx=".65"/>`;

// Built-in scene, 1600 wide, for when no photo is set. Plain shapes and
// neutral colors; the day/night look comes from CSS classes on the scene.
export function sceneSvg(VH) {
  const k = VH / 1000; // the drawing is laid out on 1600 x 1000
  const Y = (v) => f(v * k);
  const win = (x, y, w, h) =>
    `<g class="win"><rect class="wframe" x="${x - 5}" y="${Y(y) - 5}" width="${w + 10}" height="${f(h * k + 10)}" rx="2"/>`
    + `<rect class="wglass" x="${x}" y="${Y(y)}" width="${w}" height="${f(h * k)}"/>`
    + `<rect class="wlit" x="${x}" y="${Y(y)}" width="${w}" height="${f(h * k)}"/>`
    + `<path class="wbar" d="M${x + w / 2},${Y(y)} V${Y(y + h)} M${x},${Y(y + h / 2)} H${x + w}"/></g>`;
  const panels = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 5; c++) {
      const px = 430 + c * 53;
      const py = 198 + r * 52;
      panels.push(`<rect class="pv" x="${px}" y="${Y(py)}" width="49" height="${Y(48)}" rx="1.5"/>`
        + `<path class="pvline" d="M${px + 16.3},${Y(py)} V${Y(py + 48)} M${px + 32.6},${Y(py)} V${Y(py + 48)} M${px},${Y(py + 16)} H${px + 49} M${px},${Y(py + 32)} H${px + 49}"/>`);
    }
  }
  const bush = (cx, cy, r) =>
    `<circle class="leaf2" cx="${cx - r * 0.8}" cy="${Y(cy + 4)}" r="${f(r * 0.75)}"/><circle class="leaf" cx="${cx}" cy="${Y(cy - 4)}" r="${r}"/><circle class="leaf2" cx="${cx + r * 0.85}" cy="${Y(cy + 6)}" r="${f(r * 0.7)}"/>`;
  const bushes = `<g class="bush">${bush(250, 628, 30)}${bush(470, 632, 26)}${bush(540, 636, 20)}${bush(725, 632, 24)}${bush(1360, 630, 32)}${bush(1530, 640, 26)}</g>`;
  const doorLines = [535, 570, 605].map((yy) => `M852,${Y(yy)} H1248`).join(" ");
  const stars = [[90, 60], [240, 130], [380, 40], [620, 90], [860, 50], [1010, 140], [1180, 70], [1330, 120], [1480, 40], [1540, 160], [720, 160], [150, 200]]
    .map(([x, y], i) => `<circle class="star" cx="${x}" cy="${Y(y)}" r="${i % 3 ? 1.6 : 2.4}"/>`)
    .join("");
  return `<g class="bg">
<defs>
<linearGradient id="skyd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6f9fca"/><stop offset=".7" stop-color="#c9dcea"/><stop offset="1" stop-color="#e6ecef"/></linearGradient>
<linearGradient id="skyn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#060b16"/><stop offset=".7" stop-color="#16233a"/><stop offset="1" stop-color="#2a3550"/></linearGradient>
<linearGradient id="grd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6c7a5e"/><stop offset="1" stop-color="#46523e"/></linearGradient>
<linearGradient id="roofg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5d636c"/><stop offset="1" stop-color="#3f444b"/></linearGradient>
<linearGradient id="pvg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2c3f63"/><stop offset=".5" stop-color="#1a2741"/><stop offset="1" stop-color="#111a2c"/></linearGradient>
<linearGradient id="wallg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".16"/><stop offset=".12" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".08"/></linearGradient>
<radialGradient id="glowg"><stop offset="0" stop-color="#ffc56b" stop-opacity=".55"/><stop offset="1" stop-color="#ffc56b" stop-opacity="0"/></radialGradient>
</defs>
<rect class="sky-d" width="1600" height="${Y(1000)}" fill="url(#skyd)"/>
<rect class="sky-n" width="1600" height="${Y(1000)}" fill="url(#skyn)"/>
<g class="stars">${stars}<circle class="moon" cx="1390" cy="${Y(95)}" r="26"/></g>
<path class="hill2" d="M0,${Y(520)} C180,${Y(470)} 360,${Y(500)} 560,${Y(470)} C780,${Y(440)} 980,${Y(495)} 1200,${Y(455)} C1380,${Y(425)} 1500,${Y(470)} 1600,${Y(450)} L1600,${Y(600)} L0,${Y(600)} Z"/>
<path class="hill" d="M0,${Y(565)} C220,${Y(530)} 420,${Y(555)} 640,${Y(540)} C860,${Y(525)} 1060,${Y(560)} 1280,${Y(535)} C1420,${Y(522)} 1520,${Y(545)} 1600,${Y(538)} L1600,${Y(620)} L0,${Y(620)} Z"/>
<rect class="ground" y="${Y(600)}" width="1600" height="${Y(400)}" fill="url(#grd)"/>
<ellipse class="hshade" cx="800" cy="${Y(642)}" rx="560" ry="${Y(14)}"/>
<rect class="walk" y="${Y(860)}" width="1600" height="${Y(40)}"/>
<rect class="street" y="${Y(900)}" width="1600" height="${Y(100)}"/>
<path class="gutter" d="M0,${Y(912)} H1600"/>
<path class="lane" d="M-20,${Y(968)} H1620"/>
<path class="curb" d="M0,${Y(900)} H1600"/>
<path class="drive" d="M850,${Y(640)} H1250 L1340,${Y(860)} H760 Z"/>
<path class="path" d="M600,${Y(640)} H660 L672,${Y(860)} H588 Z"/>
<g class="tree"><rect class="trunk" x="1452" y="${Y(470)}" width="12" height="${Y(170)}"/><circle class="leaf" cx="1458" cy="${Y(420)}" r="70"/><circle class="leaf2" cx="1420" cy="${Y(455)}" r="48"/><circle class="leaf2" cx="1500" cy="${Y(450)}" r="52"/></g>
${bushes}
<rect class="wall" x="300" y="${Y(300)}" width="500" height="${Y(340)}"/>
<rect class="wall2" x="800" y="${Y(420)}" width="500" height="${Y(220)}"/>
<rect x="300" y="${Y(300)}" width="500" height="${Y(340)}" fill="url(#wallg)"/>
<rect x="800" y="${Y(420)}" width="500" height="${Y(220)}" fill="url(#wallg)"/>
<path class="trim" d="M300,${Y(470)} H800"/>
<path class="roof" d="M270,${Y(305)} L400,${Y(175)} H700 L830,${Y(305)} Z" fill="url(#roofg)"/>
<path class="roof" d="M780,${Y(425)} L870,${Y(342)} H1230 L1320,${Y(425)} Z" fill="url(#roofg)"/>
<path class="eave" d="M270,${Y(305)} H830 M780,${Y(425)} H1320"/>
${panels.join("")}
${win(340, 345, 80, 85)}${win(520, 345, 80, 85)}${win(680, 345, 80, 85)}${win(420, 515, 110, 75)}
<rect class="door" x="606" y="${Y(520)}" width="52" height="${Y(120)}" rx="2"/>
<circle class="knob" cx="648" cy="${Y(585)}" r="2.5"/>
<rect class="gdoor" x="850" y="${Y(500)}" width="400" height="${Y(140)}" rx="3"/>
<path class="gline" d="${doorLines}"/>
<rect class="gshade" x="852" y="${Y(502)}" width="396" height="${Y(10)}"/>
<g class="glow"><ellipse cx="632" cy="${Y(520)}" rx="70" ry="${Y(55)}" fill="url(#glowg)"/><ellipse cx="830" cy="${Y(500)}" rx="60" ry="${Y(45)}" fill="url(#glowg)"/><ellipse cx="1270" cy="${Y(500)}" rx="60" ry="${Y(45)}" fill="url(#glowg)"/></g>
<g class="lamp"><rect x="826" y="${Y(493)}" width="8" height="${Y(14)}" rx="2"/><rect x="1266" y="${Y(493)}" width="8" height="${Y(14)}" rx="2"/><rect x="684" y="${Y(513)}" width="8" height="${Y(14)}" rx="2"/></g>
</g>`;
}

// Simple rear views of a sedan, SUV and pickup, used when a car has no
// picture. Drawn in a 100 x 62 box and scaled to the slot.
const CAR_ART = {
  sedan: `<path class="cbody" d="M18,24 Q22,10 34,8 H66 Q78,10 82,24 L92,30 Q97,33 97,40 V50 Q97,55 92,55 H8 Q3,55 3,50 V40 Q3,33 8,30 Z"/>
<path d="M24,24 Q27,13 36,12 H64 Q73,13 76,24 Z" fill="#1c2430" opacity=".92"/>
<path d="M30,15 H58" stroke="rgba(255,255,255,.25)" stroke-width="1.2"/>
<rect class="ctail" x="9" y="31" width="82" height="4" rx="2"/>
<rect x="34" y="40" width="32" height="7" rx="1.5" fill="#e8eaec" opacity=".85"/>`,
  suv: `<path class="cbody" d="M12,22 Q14,4 27,3 H73 Q86,4 88,22 L93,28 Q97,31 97,38 V50 Q97,55 92,55 H8 Q3,55 3,50 V38 Q3,31 7,28 Z"/>
<path d="M17,23 Q19,8 29,7 H71 Q81,8 83,23 Z" fill="#1c2430" opacity=".92"/>
<path d="M24,11 H56" stroke="rgba(255,255,255,.25)" stroke-width="1.2"/>
<rect class="ctail" x="5" y="27" width="7" height="13" rx="2"/><rect class="ctail" x="88" y="27" width="7" height="13" rx="2"/>
<rect x="34" y="38" width="32" height="7" rx="1.5" fill="#e8eaec" opacity=".85"/>`,
  truck: `<path class="cbody" d="M24,24 Q26,6 35,5 H65 Q74,6 76,24 Z"/>
<path d="M29,22 Q31,10 38,9 H62 Q69,10 71,22 Z" fill="#1c2430" opacity=".92"/>
<path class="cbody" d="M3,26 Q3,23 6,23 H94 Q97,23 97,26 V50 Q97,55 92,55 H8 Q3,55 3,50 Z"/>
<path d="M10,27 H90 V43 H10 Z" fill="rgba(0,0,0,.12)"/>
<rect x="44" y="29" width="12" height="3" rx="1.2" fill="#2a2d31"/>
<rect class="ctail" x="4" y="26" width="5" height="15" rx="1.5"/><rect class="ctail" x="91" y="26" width="5" height="15" rx="1.5"/>
<rect x="36" y="45" width="28" height="6" rx="1.5" fill="#e8eaec" opacity=".85"/>`,
};

export function carSvg(x, y, w, flip, kind = "sedan") {
  const k = w / 100;
  const tf = `translate(${f(x)},${f(y)}) scale(${f(k)})` + (flip ? " translate(100,0) scale(-1,1)" : "");
  return `<g class="bcar" transform="${tf}">
<ellipse cx="50" cy="60" rx="52" ry="4" fill="rgba(0,0,0,.4)"/>
<rect x="8" y="44" width="15" height="16" rx="3" fill="#15171a"/><rect x="77" y="44" width="15" height="16" rx="3" fill="#15171a"/>
${CAR_ART[kind] || CAR_ART.sedan}
<rect x="6" y="49" width="88" height="5" rx="2" fill="rgba(0,0,0,.35)"/>
</g>`;
}
export const CAR_BOX_RATIO = 0.62;

// Small wall charger for the built-in house. The cable leaves from the
// middle of its bottom edge at (x, y); k scales it with the car.
export function chargerSvg(x, y, k) {
  const w = 15 * k;
  const h = 24 * k;
  const l = x - w / 2;
  const t = y - h;
  return `<g class="charger">
<rect x="${f(l + 2 * k)}" y="${f(t + 3 * k)}" width="${f(w)}" height="${f(h)}" rx="${f(3 * k)}" fill="rgba(0,0,0,.3)" filter="url(#soft)"/>
<rect x="${f(l)}" y="${f(t)}" width="${f(w)}" height="${f(h)}" rx="${f(3 * k)}" fill="url(#pbody)" stroke="#5d6267" stroke-width="${f(0.6 * k)}"/>
<rect x="${f(l + 3 * k)}" y="${f(t + 4 * k)}" width="${f(w - 6 * k)}" height="${f(5 * k)}" rx="${f(1 * k)}" fill="#26302a"/>
<circle class="cled" cx="${f(x)}" cy="${f(t + 14 * k)}" r="${f(1.6 * k)}" fill="#7fe0a6"/></g>`;
}
