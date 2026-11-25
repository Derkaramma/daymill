// sunflow-house-card: a picture of the house with glowing power flows, the
// meter panel as the junction, EV cables, and live chips.
//
// With no picture configured it draws a plain built-in house, so the card
// works out of the box. Layout options are described in house/layout.js.
//
// type: custom:sunflow-house-card
// image_day / image_night      night is optional; the day picture is darkened
// image_aspect                 e.g. "16/10"; default: the picture's own size
// entities: {solar_power: ...} override any SunFlow entity
// sun_entity: sun.sun
// stale_minutes: 15
// night_dim: 0.5               car picture brightness at night
// show_footer: true
// show_unconfigured_cars: false
// thresholds: {solar, grid, home, car, battery}   kW
// animation: {enabled: true, speed_scale: 1}      or animation: false
// colors: {solar: "#ffb020", ...}
// layout: {...}                round_corners: true rounds the line corners
// cars: [...]                  default: the cars SunFlow knows about

import { SunFlowCard, defineCard, h, s, asButton, setStyle } from "../common/base.js";
import { attr, isOn, num, powerKw, state, sunflowCars } from "../common/entities.js";
import { kw, kwh, money, periodLabel, price, seasonLabel, t } from "../common/format.js";
import { cssVar } from "../common/theme.js";
import { CAR_BOX_RATIO, DEFS, HANDLE, batterySvg, carSvg, chargerSvg, panelSvg, sceneSvg } from "./house/art.js";
import { DEFAULT_ASPECT, VW, autoCable, builtinCar, linePath, normalizeConfig, placeCar, smoothPath } from "./house/layout.js";
import { houseStyles } from "./house/styles.js";
import "./house/strings.js";

const BASE_MS = 3000; // one sweep at playbackRate 1
const FWD = [{ strokeDashoffset: 1000 }, { strokeDashoffset: 0 }];
const REV = [{ strokeDashoffset: 0 }, { strokeDashoffset: 1000 }];
const CAR_ON = new Set(["on", "true", "charging", "starting"]);
const ROLES = ["presence_entity", "charging_entity", "power_entity", "battery_entity", "plugged_entity", "limit_entity"];

const v = (key) => `var(${cssVar(key)})`;
const pw = (hass, value) => kw(hass, Math.abs(value), { unit: "auto" });

// Sweep time 1.2-4.5 s depending on power, rounded so small live changes
// don't restart anything.
const sweepMs = (value) => Math.round(Math.max(1200, Math.min(4500, 3200 / Math.max(0.3, Math.abs(value)))) / 250) * 250;

// A car picture as a solid black shape, without its soft shadow, for cable
// masks. Cached per picture; resolves to "" if the picture can't be read.
const SILHOUETTES = new Map();
function silhouette(src) {
  if (!SILHOUETTES.has(src)) {
    SILHOUETTES.set(
      src,
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          try {
            const c = document.createElement("canvas");
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const g = c.getContext("2d");
            g.drawImage(img, 0, 0);
            const d = g.getImageData(0, 0, c.width, c.height);
            const px = d.data;
            for (let i = 0; i < px.length; i += 4) {
              px[i] = px[i + 1] = px[i + 2] = 0;
              px[i + 3] = px[i + 3] > 217 ? 255 : 0;
            }
            g.putImageData(d, 0, 0);
            resolve(c.toDataURL("image/png"));
          } catch {
            resolve("");
          }
        };
        img.onerror = () => resolve("");
        img.src = src;
      }),
    );
  }
  return SILHOUETTES.get(src);
}

function svgInto(parent, markup) {
  const g = s("g");
  g.innerHTML = markup;
  parent.append(...g.childNodes);
}

// What SunFlow's setup knows about a car beyond charging and power.
function extras(k) {
  const out = {};
  if (k.image) out.image = k.image;
  for (const key of ["battery_entity", "plugged_entity", "limit_entity"]) if (k[key]) out[key] = k[key];
  return out;
}

class SunFlowHouseCard extends SunFlowCard {
  static styles = [houseStyles];
  static keys = [
    "solar_power",
    "grid_power",
    "home_power",
    "import_rate",
    "cost_rate",
    "cost_today",
    "totals",
    "data_age",
    "battery_soc",
    "battery_power",
  ];
  static cardSize = 7;
  static grid = { columns: 12, min_columns: 6, rows: "auto" };

  static getStubConfig() {
    return {};
  }

  static getConfigElement() {
    return document.createElement("sunflow-house-card-editor");
  }

  validateConfig(config) {
    this._n = normalizeConfig(config);
    this._imgFailed = false;
  }

  // ---- cars ----

  // Car list: from the config, or the cars SunFlow knows about. A config car
  // with `sunflow: <slug>` picks up SunFlow's charging entities. Cars found
  // on their own take turns facing left and right, so each gets a garage
  // wall for its charger.
  _cars() {
    const n = this._n;
    const known = sunflowCars(this.hass);
    if (!n.cars) {
      return known.map((k, i) => ({ ...n.autoCar({ ...extras(k), name: k.name, charging_entity: k.charging, power_entity: k.power, flip: i % 2 === 1 }, i), found: true }));
    }
    return n.cars.map((c) => {
      if (!c.sunflow) return c;
      const k = known.find((x) => x.slug === c.sunflow);
      if (!k) return c;
      // without its own presence sensor it behaves like a car found on its own
      const more = extras(k);
      for (const key of Object.keys(more)) if (c[key]) delete more[key];
      return {
        ...more,
        ...c,
        name: c.name || k.name || "",
        charging_entity: c.charging_entity || k.charging || "",
        power_entity: c.power_entity || k.power || "",
        found: !c.presence_entity,
      };
    });
  }

  _wantsBattery() {
    const e = this.entities;
    return !!(e.battery_soc || e.battery_power) && this._n.layout.battery.show;
  }

  watchedEntities() {
    const ids = Object.values(this.entities);
    if (this._n?.sunEntity) ids.push(this._n.sunEntity);
    for (const c of this._carList || []) for (const r of ROLES) if (c[r]) ids.push(c[r]);
    return ids;
  }

  // ---- editor hooks ----

  // The visual editor draws its handles over the scene. It sets editMode,
  // listens for "sunflow-rendered" and reads these.
  set editMode(on) {
    this._editMode = !!on;
    this.$scene?.classList.toggle("editing", this._editMode);
  }

  get editMode() {
    return !!this._editMode;
  }

  get sceneElement() {
    return this.$scene || null;
  }

  get sceneAspect() {
    return this._aspect || DEFAULT_ASPECT;
  }

  get placedCars() {
    return this._placed || [];
  }

  // ---- build ----

  build() {
    const n = this._n;
    // reuse the picture's shape from the last build so a rebuild doesn't jump
    const known = this._knownAspect?.url === n.imageDay ? this._knownAspect.a : 0;
    this._aspect = n.aspect || known || DEFAULT_ASPECT;
    this._carList = this._cars();
    this._carKey = JSON.stringify(this._carList);
    this._ratios = {};

    this.$scene = h("div", { class: ["scene", this._editMode && "editing"] });
    this.$scene.style.setProperty("--night-dim", String(n.nightDim));
    this.$day = null;
    if (n.imageDay && !this._imgFailed) {
      this.$day = h("img", { class: "day", alt: "" });
      this.$day.addEventListener("load", () => this._imageLoaded());
      this.$day.addEventListener("error", () => {
        this._imgFailed = true;
        this._rebuild();
      });
      this.$day.src = n.imageDay;
      this.$scene.append(this.$day);
      if (n.imageNight) {
        const night = h("img", { class: "night", alt: "" });
        night.src = n.imageNight;
        this.$scene.append(night);
      } else {
        this.$scene.classList.add("auto-night");
        this.$scene.append(h("div", { class: "tint" }));
      }
    }
    this.$layer = h("div", { class: "layer" });
    this.$scene.append(this.$layer);

    this.$head = h("div");
    this.$sub = h("div", { class: "sub" });
    this.$cost = h("span", { class: "pill", hidden: true });
    this.$warn = h("span", { class: "pill warn", hidden: true });
    const foot = h("div", { class: "foot" }, h("div", { class: "head" }, this.$head, this.$sub), this.$cost, this.$warn);
    foot.hidden = !n.showFooter;
    this.shadowRoot.append(h("ha-card", null, this.$scene, foot));
    this._resize?.disconnect();
    this._resize?.observe(this.$scene);
    this._buildScene();
    if (this.$day?.complete) this._imageLoaded(true);
  }

  connectedCallback() {
    super.connectedCallback();
    this._resize ??= new ResizeObserver(() => this._placed && this._spreadCarChips());
    if (this.$scene) this._resize.observe(this.$scene);
    // flows were paused while the card was detached
    if (this._built) this._update(true);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._resize?.disconnect();
    cancelAnimationFrame(this._raf);
    for (const st of Object.values(this._anims || {})) {
      st.anims.forEach((an) => an.pause());
      st.on = false;
    }
  }

  _rebuild() {
    if (!this._built) return;
    this.shadowRoot.replaceChildren();
    this.build();
    this.render();
  }

  // The owner's battery picture in the battery box, with a soft glow behind
  // it while it charges or discharges. Built with the DOM so a picture link
  // can't break out of its attribute.
  _batteryPicture(svg, b, opts) {
    const g = s("g", { class: ["battery", "bimg", !opts.image_night && "no-night"] });
    if (b.skew) {
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      g.setAttribute("transform", `translate(${cx},${cy}) skewY(${b.skew}) translate(${-cx},${-cy})`);
    }
    const pad = Math.min(b.w, b.h) * 0.28;
    const rx = Math.min(b.w, b.h) * 0.25;
    g.append(
      s("rect", { class: "bshadow", x: b.x + b.w * 0.06, y: b.y + b.h * 0.04, width: b.w, height: b.h, rx: rx * 0.5, filter: "url(#soft)" }),
      s("g", { class: "bglow" },
        s("rect", { class: "bg1", x: b.x - pad, y: b.y - pad, width: b.w + 2 * pad, height: b.h + 2 * pad, rx: rx + pad, filter: "url(#soft)" }),
        s("rect", { class: "bg2", x: b.x - pad * 0.3, y: b.y - pad * 0.3, width: b.w + pad * 0.6, height: b.h + pad * 0.6, rx: rx * 0.6, filter: "url(#soft)" })),
    );
    const pic = (cls, href) => s("image", { class: cls, href, x: b.x, y: b.y, width: b.w, height: b.h, preserveAspectRatio: "xMidYMid meet" });
    g.append(pic("bday", opts.image));
    if (opts.image_night) g.append(pic("bnight", opts.image_night));
    // under its own line (so the glow doesn't hide the flow), and like the
    // line, under the meter panel
    svg.insertBefore(g, this._flows.battery || null);
    return g;
  }

  _imageLoaded(sync = false) {
    const img = this.$day;
    if (this._n.aspect || !img?.naturalWidth || !img.naturalHeight) return;
    const a = img.naturalWidth / img.naturalHeight;
    this._knownAspect = { url: this._n.imageDay, a };
    if (Math.abs(a - this._aspect) > 1e-4) {
      this._aspect = a;
      this._buildScene();
      if (!sync) this.render();
    }
  }

  // Everything that depends on the aspect ratio or the car list.
  _buildScene() {
    const n = this._n;
    const L = n.layout;
    const VH = VW / this._aspect;
    const builtIn = !n.imageDay || this._imgFailed;
    this.$scene.style.aspectRatio = `${this._aspect}`;
    for (const a of Object.values(this._anims || {})) a.anims.forEach((x) => x.cancel());
    this._anims = {};
    this._flows = {};
    this._chips = {};
    this._cables = {};
    this._maskImgs = {};
    this._glows = {};
    this._tethers = {};
    this._carEls = {};
    this._chargers = {};

    const layer = this.$layer;
    layer.replaceChildren();
    const P = ([x, y]) => [x * VW, y * VH];

    // car pictures sit between the photo and the overlay
    this._placed = this._carList.map((c) => placeCar({ ...c, ratio: this._ratios[c.index] || c.ratio }, this._aspect));
    // nearer cars (lower on the picture) go on top of farther ones
    const byDepth = [...this._placed].sort((a, b) => a.slot.y + a.h - (b.slot.y + b.h));
    for (const c of byDepth) {
      if (!c.image || builtinCar(c.image)) continue;
      const im = h("img", { class: ["carimg", c.flip && "flip"], alt: "", "data-car": c.index });
      setStyle(im, { left: `${c.slot.x * 100}%`, top: `${c.slot.y * 100}%`, width: `${c.slot.w * 100}%` });
      im.addEventListener("load", () => this._carLoaded(c, im));
      im.src = c.image;
      this._carEls[c.index] = im;
      layer.append(im);
    }

    const svg = s("svg", { class: "ov", viewBox: `0 0 ${VW} ${Math.round(VH * 100) / 100}`, preserveAspectRatio: "xMidYMid slice", "aria-hidden": "true" });
    const defs = s("defs");
    defs.innerHTML = DEFS;
    svg.append(defs);
    if (builtIn) svgInto(svg, sceneSvg(VH));

    // drawn cars, for cars without a picture on the built-in house
    for (const c of this._placed) {
      // also on a photo when the car has no cutout, so its cable isn't left hanging
      const kind = builtinCar(c.image);
      if (c.image && !kind) continue;
      const [x, y] = P([c.slot.x, c.slot.y]);
      const w = c.slot.w * VW;
      svgInto(svg, carSvg(x, y + c.h * VH - w * CAR_BOX_RATIO, w, c.flip, kind || "sedan"));
      this._carEls[c.index] = svg.lastElementChild;
    }

    // flow lines
    const radius = L.round * VW;
    const flow = (key, cls, l) => {
      const p = linePath(l, VW, VH, radius);
      if (!p) return;
      const g = s("g", { class: cls, "data-flow": key });
      g.append(
        s("path", { class: "tglow far", d: p.d }),
        s("path", { class: "tglow", d: p.d }),
        s("path", { class: "track", d: p.d }),
        s("path", { class: "halo", pathLength: 1000, d: p.d }),
        s("path", { class: "pulse", pathLength: 1000, d: p.d }),
      );
      svg.append(g);
      this._flows[key] = g;
    };
    L.lines.solar.forEach((l, i) => flow(`solar${i}`, "solar", l));
    flow("home", "home", L.lines.home);
    flow("grid", "export", L.lines.grid);
    this._hasBattery = this._wantsBattery();
    if (this._hasBattery) flow("battery", "batt", L.lines.battery);

    // the panel covers the line ends: the wiring runs inside it
    const box = (b) => ({ x: b.x * VW, y: b.y * VH, w: b.w * VW, h: b.h * VH, skew: b.skew, style: b.style });
    if (L.panel.show) svgInto(svg, panelSvg(box(L.panel)));
    this.$batt = null;
    if (this._hasBattery && L.battery.image) {
      this.$batt = this._batteryPicture(svg, box(L.battery), L.battery);
      this._battStrip = null;
    } else if (this._hasBattery) {
      const b = batterySvg(box(L.battery));
      svgInto(svg, b.svg);
      this.$batt = svg.lastElementChild;
      this._battStrip = b.strip;
    }

    // EV cables
    for (const c of this._placed) {
      if (!c.showCable) continue;
      const p = c.cable ? smoothPath(c.cable, VW, VH) : linePath({ d: autoCable(c) }, VW, VH);
      const k = (c.slot.w * VW) / 316;
      if (builtIn && !c.cable && ROLES.some((r) => c[r])) {
        svgInto(svg, chargerSvg(p.start[0], p.start[1], k));
        this._chargers[c.index] = svg.lastElementChild;
      }
      const g = s("g", { class: "cable", "data-flow": `car${c.index}` });
      g.style.setProperty("--k", String(Math.round(k * 1000) / 1000));
      const path = (cls, anim) => s("path", { class: cls, d: p.d, pathLength: anim ? 1000 : null });
      const core = path("ccore");
      g.append(
        path("cshadow2"),
        path("cshadow"),
        path("ccontact"),
        core,
        path("ctint"),
        path("chi"),
        path("halo", true),
        path("pulse p1", true),
        path("pulse p2", true),
        path("pulse p3", true),
        path("pulse p4", true),
        s("ellipse", { class: "cseal", cx: p.start[0], cy: p.start[1], rx: 5.2 * k, ry: 1.7 * k }),
      );
      // the charger lights up while this car charges
      const glowAt = c.chargerGlow ? P(c.chargerGlow) : p.start;
      const glow = s("g", { class: "cglow" }, s("circle", { class: "cg1", cx: glowAt[0], cy: glowAt[1], r: 16 * k }), s("circle", { class: "cg2", cx: glowAt[0], cy: glowAt[1], r: 5 * k }));
      const handle = s("g", { class: "handle" });
      handle.innerHTML = HANDLE;
      g.append(handle);
      if (c.cableBehind.length) g.setAttribute("mask", `url(#${this._cableMask(defs, c)})`);
      svg.append(g);
      // outside the cable's mask, so a car in front of the cable doesn't hide it
      glow.setAttribute("data-glow", `car${c.index}`);
      svg.append(glow);
      this._glows[c.index] = glow;
      this._cables[c.index] = { g, core, handle, k };
      this._flows[`car${c.index}`] = g;
    }

    // junction node, on top
    if (L.junction.show) {
      const at = L.junction.at ? P(L.junction.at) : [(L.panel.x + L.panel.w / 2) * VW, (L.panel.y + L.panel.h * 0.58) * VH];
      svg.append(
        s(
          "g",
          { class: "node" },
          s("circle", { class: "nglow", cx: at[0], cy: at[1], r: 12, filter: "url(#soft)" }),
          s("circle", { class: "ncore", cx: at[0], cy: at[1], r: 5.5 }),
        ),
      );
    }
    // thin lines from chips out to what they describe, under the chips
    const tether = (key, pos) => {
      if (!pos?.show || !pos.tether) return;
      const [x1, y1] = P([pos.x, pos.y]);
      const [x2, y2] = P(pos.tether);
      const g = s("g", { class: "tether" }, s("line", { x1, y1, x2, y2 }), s("circle", { cx: x2, cy: y2, r: 3.2 }));
      svg.append(g);
      this._tethers[key] = g;
    };
    // the battery's chip (and so its tether) only exists with a battery
    for (const key of ["solar", "home", "grid", "battery"]) if (key !== "battery" || this._hasBattery) tether(key, L.chips[key]);
    for (const c of this._placed) tether(`car${c.index}`, c.chipPos);
    layer.append(svg);

    // pulse animations, paused until a flow turns on
    for (const [key, g] of Object.entries(this._flows)) {
      const anims = [...g.querySelectorAll(".pulse, .halo")].map((el) => {
        const an = el.animate(FWD, { duration: BASE_MS, iterations: Infinity, easing: "linear" });
        an.pause();
        return an;
      });
      this._anims[key] = { anims, rate: null, rev: false, on: false };
    }

    // the handle continues the cable's last direction into the port
    for (const { core, handle, k } of Object.values(this._cables)) {
      const len = core.getTotalLength();
      const a = core.getPointAtLength(len);
      const b = core.getPointAtLength(Math.max(0, len - 3 * k));
      const deg = (Math.atan2(a.y - b.y, a.x - b.x) * 180) / Math.PI;
      handle.setAttribute("transform", `translate(${a.x.toFixed(1)},${a.y.toFixed(1)}) rotate(${deg.toFixed(1)}) scale(${k.toFixed(3)})`);
    }

    // chips
    const chips = L.chips;
    const add = (key, pos, dot, title, parent = layer) => {
      if (!pos.show) return null;
      const el = this._chip(key, dot, title, parent === layer ? pos.align : "center");
      if (parent === layer) setStyle(el, { left: `${pos.x * 100}%`, top: `${pos.y * 100}%` });
      parent.append(el);
      return el;
    };
    add("solar", chips.solar, "dot_solar", t("solar"));
    add("home", chips.home, "dot_home", t("home"));
    add("grid", chips.grid, "dot_grid", t("grid"));
    if (this._hasBattery) add("battery", chips.battery, "battery", t("battery"));
    let stack = null;
    if (chips.rate.show) {
      stack = h("div", { class: ["stack", chips.rate.align] });
      setStyle(stack, { left: `${chips.rate.x * 100}%`, top: `${chips.rate.y * 100}%` });
      add("rate", chips.rate, "dot_rate", t("rate"), stack);
      layer.append(stack);
    }
    if (chips.today.show) {
      const today = chips.today;
      let el;
      if (today.stack && stack) el = add("today", today, "dot_today", t("today"), stack);
      else el = add("today", today.stack ? { ...chips.rate, show: true } : today, "dot_today", t("today"));
      if (el) this._buildToday();
    }
    for (const c of this._placed) {
      if (!c.chipPos.show) continue;
      add(`car${c.index}`, c.chipPos, "dot_car", c.name || t("car_n", { n: c.index + 1 }));
    }
  }

  // A mask that hides a car's cable wherever another car stands in front of
  // it: the cars' pictures, turned into solid silhouettes (soft shadows
  // left out), cut it away. cable_reveal circles keep the bit at the port.
  _cableMask(defs, c) {
    const id = `cablemask${c.index}`;
    const VH = VW / this._aspect;
    const m = s("mask", { id, maskUnits: "userSpaceOnUse", x: 0, y: 0, width: VW, height: VH });
    m.append(s("rect", { x: 0, y: 0, width: VW, height: VH, fill: "#fff" }));
    const cut = (i) => {
      const o = this._placed.find((p) => p.index === i);
      if (!o?.image || builtinCar(o.image)) return;
      const x = o.slot.x * VW, y = o.slot.y * VH, w = o.slot.w * VW, hh = o.h * VH;
      const im = s("image", { href: o.image, x, y, width: w, height: hh, preserveAspectRatio: "none", filter: "url(#carsil)" });
      if (o.flip) im.setAttribute("transform", `translate(${2 * x + w} 0) scale(-1 1)`);
      m.append(im);
      (this._maskImgs[i] ||= []).push(im);
      // Some browsers (Safari) skip filters inside masks, so swap in a solid
      // black copy of the car made on a canvas. The filter stays as a
      // fallback for pictures a canvas can't read (other sites).
      silhouette(o.image).then((url) => {
        if (!url) return;
        im.setAttribute("href", url);
        im.removeAttribute("filter");
      });
    };
    // Cars farther back than this one, and this one itself, go first; then
    // the reveal spots (the plug sits on this car's near side, in front of
    // anything behind it); then nearer cars, which hide the plug too.
    const depth = (i) => {
      const o = this._placed.find((p) => p.index === i);
      return o ? o.slot.y + o.h : 0;
    };
    const mine = depth(c.index);
    const behind = c.cableBehind.filter((i) => i === c.index || depth(i) <= mine);
    const front = c.cableBehind.filter((i) => i !== c.index && depth(i) > mine);
    behind.forEach(cut);
    for (const [x, y, r] of c.cableReveal) m.append(s("circle", { cx: x * VW, cy: y * VH, r: r * VW, fill: "#fff" }));
    front.forEach(cut);
    defs.append(m);
    return id;
  }

  _carLoaded(c, im) {
    if (!im.naturalWidth || this._n.cars?.[c.index]?.image_ratio || this._ratios[c.index]) return;
    const r = im.naturalHeight / im.naturalWidth;
    if (Math.abs(r - c.ratio) > 0.02) {
      this._ratios[c.index] = r;
      cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(() => {
        this._buildScene();
        this.render();
      });
    }
  }

  _chip(key, dot, title, align) {
    const el = h("div", { class: ["chip", align !== "center" && align], "data-k": key });
    const d = h("span", { class: "dot" });
    d.style.background = v(dot);
    const val = h("div", { class: "v" });
    const sub = h("div", { class: "s" });
    el.append(h("div", { class: "k" }, d, h("span", { class: "t", text: title })), val, sub);
    asButton(el, () => this.moreInfo(this._target(key)), title);
    this._chips[key] = { el, dot: d, v: val, s: sub };
    return el;
  }

  _buildToday() {
    const ch = this._chips.today;
    const r = 15;
    this._ringC = 2 * Math.PI * r;
    ch.ringGrid = s("circle", { class: "rg", cx: 20, cy: 20, r });
    ch.ringSolar = s("circle", { class: "rs", cx: 20, cy: 20, r });
    ch.pct = h("b");
    ch.used = h("span");
    ch.sent = h("span");
    const s2 = h(
      "div",
      { class: "s" },
      h("div", { class: "share" }, s("svg", { viewBox: "0 0 40 40" }, s("g", { transform: "rotate(-90 20 20)" }, ch.ringGrid, ch.ringSolar)), ch.pct, h("span", { text: t("from_solar") })),
      h("div", { class: "trows" }, h("span", { text: t("home_used") }), ch.used, h("span", { text: t("sent_to_grid") }), ch.sent),
    );
    ch.s.replaceWith(s2);
    ch.s = s2;
  }

  _target(key) {
    const e = this.entities;
    const car = /^car(\d+)$/.exec(key);
    if (car) {
      const c = this._carList[+car[1]];
      return c && (c.battery_entity || c.charging_entity || c.power_entity || c.presence_entity || c.plugged_entity);
    }
    return {
      solar: e.solar_power,
      home: e.home_power || e.solar_power,
      grid: e.grid_power,
      battery: e.battery_soc || e.battery_power,
      rate: e.import_rate,
      today: e.cost_today,
    }[key];
  }

  // ---- render ----

  render() {
    const cars = this._cars();
    if (JSON.stringify(cars) !== this._carKey || this._hasBattery !== this._wantsBattery()) {
      this._carList = cars;
      this._carKey = JSON.stringify(cars);
      this._buildScene();
    }
    const n = this._n;
    const hass = this.hass;
    const e = this.entities;
    const th = n.thresholds;
    const still = this.reducedMotion || !n.animate;
    this.$scene.classList.toggle("still", !n.animate);

    const night = n.sunEntity ? state(hass, n.sunEntity) === "below_horizon" : false;
    this.$scene.classList.toggle("is-night", night);

    const solar = powerKw(hass, e.solar_power) ?? null;
    const grid = powerKw(hass, e.grid_power) ?? null;
    const batt = this._hasBattery ? (powerKw(hass, e.battery_power) ?? null) : null;
    let home = powerKw(hass, e.home_power) ?? null;
    if (home === null && solar !== null && grid !== null) home = Math.max(0, solar + grid + (batt || 0));

    const producing = solar !== null && solar > th.solar;
    const importing = grid !== null && grid > th.grid;
    const exporting = grid !== null && grid < -th.grid;

    const setFlow = (key, on, value, cls, reverse = false) => {
      const g = this._flows[key];
      if (!g) return;
      g.classList.toggle("on", !!on);
      if (cls && !g.classList.contains(cls)) {
        g.classList.remove("solar", "import", "export", "home", "batt");
        g.classList.add(cls);
      }
      const st = this._anims[key];
      if (!on || still) {
        if (st.on) st.anims.forEach((an) => an.pause());
        st.on = false;
        return;
      }
      // Direction is swapped through keyframes: an infinite animation will not
      // play with a negative playbackRate.
      if (!!reverse !== st.rev) {
        st.anims.forEach((an) => an.effect.setKeyframes(reverse ? REV : FWD));
        st.rev = !!reverse;
      }
      const rate = (g.classList.contains("cable") ? 1 / 2.5 : BASE_MS / sweepMs(value || 1)) * n.speed;
      if (rate !== st.rate) {
        st.anims.forEach((an) => (an.updatePlaybackRate ? an.updatePlaybackRate(rate) : (an.playbackRate = rate)));
        st.rate = rate;
      }
      if (!st.on) {
        st.anims.forEach((an) => an.play());
        st.on = true;
      }
    };

    n.layout.lines.solar.forEach((_, i) => setFlow(`solar${i}`, producing, solar, "solar"));
    setFlow("home", home !== null && home > th.home, home, "home");
    setFlow("grid", importing || exporting, grid, importing ? "import" : "export", importing);

    const U = t("unavailable");
    this._set("solar", solar === null ? U : pw(hass, solar), producing ? t("producing") : night ? t("night") : t("idle"));
    this._set("home", home === null ? U : pw(hass, home), t("using_now"));
    if (this._chips.grid) this._chips.grid.dot.style.background = v(exporting ? "dot_export" : "dot_grid");
    this._set("grid", grid === null ? U : pw(hass, grid), importing ? t("importing") : exporting ? t("exporting") : t("balanced"));

    // battery (beta): positive power = discharging into the home
    let battText = "";
    if (this._hasBattery) {
      const soc = num(hass, e.battery_soc);
      const charging = batt !== null && batt < -th.battery;
      const discharging = batt !== null && batt > th.battery;
      setFlow("battery", charging || discharging, batt, "batt", discharging);
      // green while charging, orange while it powers the home
      this._flows.battery?.classList.toggle("charging", charging);
      this._flows.battery?.classList.toggle("discharging", discharging);
      const status = charging
        ? t("house_battery_charging", { power: pw(hass, batt) })
        : discharging
          ? t("house_battery_discharging", { power: pw(hass, batt) })
          : t("house_battery_idle");
      this._set("battery", soc === undefined ? (batt === null ? U : pw(hass, batt)) : `${Math.round(soc)}%`, status);
      if (this._chips.battery) {
        this._bar(this._chips.battery, soc, undefined, "batt");
        // the dot and the charge bar show how full it is: green 50% and up,
        // orange 20-49%, red under 20%
        // judged on the same rounded number the chip shows
        const pct = soc === undefined ? null : Math.round(soc);
        const level = pct === null ? null : pct >= 50 ? "dot_battery_high" : pct >= 20 ? "dot_battery_mid" : "dot_battery_low";
        this._chips.battery.dot.style.background = v(level || "battery");
        const fill = this._chips.battery.bar?.fill;
        if (fill) fill.style.background = level ? v(level) : "";
      }
      if (this.$batt) {
        this.$batt.classList.toggle("charging", charging);
        this.$batt.classList.toggle("discharging", discharging);
        const fill = this._battStrip && this.$batt.querySelector(".bfill");
        if (fill) {
          const frac = soc === undefined ? 0 : Math.max(0, Math.min(1, soc / 100));
          const { top, len } = this._battStrip;
          fill.setAttribute("y", String(top + len * (1 - frac)));
          fill.setAttribute("height", String(Math.max(0.01, len * frac)));
        }
      }
      if (charging) battText = t("house_sub_battery_charging", { power: pw(hass, batt) });
      else if (discharging) battText = t("house_sub_battery_discharging", { power: pw(hass, batt) });
    }

    this._renderRate();
    this._renderToday();
    const charging = this._renderCars(setFlow);

    // footer
    let head;
    let sub = "";
    if (solar === null && grid === null) head = t("head_unavailable");
    else if (grid === null) {
      head = t("house_head_solar_only", { power: pw(hass, solar) });
      sub = t("house_sub_grid_unavailable");
    } else if (exporting) {
      head = t("head_export", { power: pw(hass, grid) });
      sub = producing ? t("house_sub_export_cover", { solar: pw(hass, solar), home: pw(hass, home || 0) }) : "";
    } else if (producing && home > 0) {
      head = t("head_covering", { pct: Math.min(100, Math.round((solar / home) * 100)) });
      sub = importing ? t("house_sub_pull_rest", { power: pw(hass, grid) }) : "";
    } else if (importing) {
      head = t("head_import", { power: pw(hass, grid) });
      sub = night ? t("sub_night") : t("house_sub_not_producing");
    } else head = t("house_head_balanced");
    const sep = t("house_sep");
    if (battText) sub = sub ? sub + sep + battText : battText;
    if (charging.length) {
      const text = t("sub_cars", { cars: charging.join(t("house_join")) });
      sub = sub ? sub + sep + text : text;
    }
    this.$head.textContent = head;
    this.$sub.textContent = sub;
    this.$sub.hidden = !sub;

    const cr = num(hass, e.cost_rate);
    this.$cost.hidden = cr === undefined;
    if (cr !== undefined) this.$cost.textContent = t(cr < 0 ? "earning" : "costing", { amount: money(hass, cr, { abs: true }) });

    const stale = this.isStale();
    this.$warn.hidden = !stale;
    this.$warn.textContent = stale ? t("data_old", { minutes: Math.round(this.dataAge() / 60) }) : "";
    this._spreadCarChips();
    if (this._editMode) this.dispatchEvent(new CustomEvent("sunflow-rendered"));
  }

  // Car chips sit under their cars and can run into each other on a narrow
  // card or with a long status. Push overlapping ones apart, keeping the
  // group centered where it was and inside the picture.
  _spreadCarChips() {
    const chips = this._placed
      .filter((c) => c.chipPos.auto && c.chipPos.show)
      .map((c) => this._chips[`car${c.index}`]?.el)
      .filter((el) => el && !el.hidden);
    for (const el of chips) el.style.translate = "";
    if (chips.length < 2) return;
    const box = this.$scene.getBoundingClientRect();
    if (!box.width) return;
    const gap = 6;
    const r = chips.map((el) => el.getBoundingClientRect()).map((b) => ({ l: b.left - box.left, w: b.width }));
    const order = r.map((_, i) => i).sort((a, b) => r[a].l - r[b].l);
    const pos = r.map((x) => x.l);
    for (let j = 1; j < order.length; j++) {
      const a = order[j - 1];
      const b = order[j];
      pos[b] = Math.max(pos[b], pos[a] + r[a].w + gap);
    }
    // recenter the group, then keep it inside the picture
    let shift = r.reduce((acc, x, i) => acc + x.l - pos[i], 0) / r.length;
    const first = order[0];
    const last = order[order.length - 1];
    shift = Math.min(shift, box.width - gap - (pos[last] + r[last].w));
    shift = Math.max(shift, gap - pos[first]);
    chips.forEach((el, i) => {
      const dx = Math.round(pos[i] + shift - r[i].l);
      if (dx) el.style.translate = `${dx}px 0`;
    });
  }

  _set(key, value, sub) {
    const c = this._chips[key];
    if (!c) return;
    c.v.textContent = value;
    c.s.textContent = sub;
  }

  _bar(chip, value, limit, cls) {
    let bar = chip.bar;
    if (!bar) {
      bar = chip.bar = { el: h("div", { class: ["bar", cls] }), fill: h("i"), tick: h("b") };
      bar.el.append(bar.fill, bar.tick);
      chip.el.append(bar.el);
    }
    bar.el.hidden = value === undefined;
    if (value !== undefined) bar.fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
    bar.tick.hidden = limit === undefined;
    if (limit !== undefined) bar.tick.style.left = `${Math.max(0, Math.min(100, limit))}%`;
  }

  _renderRate() {
    const c = this._chips.rate;
    if (!c) return;
    const hass = this.hass;
    const id = this.entities.import_rate;
    const value = num(hass, id);
    const raw = state(hass, id);
    c.el.hidden = raw === undefined;
    if (raw === undefined) return;
    const label = attr(hass, id, "label") || (attr(hass, id, "period") ? periodLabel(attr(hass, id, "period")) : "");
    const season = seasonLabel(attr(hass, id, "season"));
    c.v.textContent = value === undefined ? raw : price(hass, value);
    c.s.textContent = [season, label].filter(Boolean).join(t("house_sep"));
  }

  _renderToday() {
    const c = this._chips.today;
    if (!c) return;
    const hass = this.hass;
    const e = this.entities;
    const a = (k) => {
      const x = Number(attr(hass, e.totals, k));
      return Number.isFinite(x) ? x : undefined;
    };
    const used = a("used_today");
    const prod = a("produced_today");
    const sent = a("exported_today");
    // Right after setup nothing has been counted yet and the cost is just the
    // daily charge, which looks like a bug. Show a dash until energy comes in.
    const started = (used ?? 0) > 0.01 || (sent ?? 0) > 0.01;
    const cost = started ? num(hass, e.cost_today) : undefined;
    const credit = cost !== undefined && cost < 0;
    c.v.textContent = !started ? "–" : cost === undefined ? money(hass, 0) : credit ? t("credit", { amount: money(hass, cost, { abs: true }) }) : money(hass, cost);
    c.dot.style.background = v(credit ? "dot_credit" : "dot_today");
    const ok = used !== undefined && used > 0.01 && prod !== undefined && sent !== undefined;
    const share = ok ? Math.max(0, Math.min(1, (prod - sent) / used)) : 0;
    c.ringGrid.setAttribute("opacity", ok ? "0.9" : "0.3");
    c.ringSolar.setAttribute("stroke-dasharray", `${(share * this._ringC).toFixed(1)} ${this._ringC.toFixed(1)}`);
    c.ringSolar.setAttribute("opacity", share > 0 ? "1" : "0");
    c.pct.textContent = ok ? `${Math.round(share * 100)}%` : "–";
    c.used.textContent = used === undefined ? "–" : kwh(hass, Math.max(0, used));
    c.sent.textContent = sent === undefined ? "–" : kwh(hass, Math.max(0, sent));
  }

  // Cars: picture, cable and chip. Returns the "<car> (power)" list for the footer.
  _renderCars(setFlow) {
    const hass = this.hass;
    const n = this._n;
    const out = [];
    for (const c of this._placed) {
      const key = `car${c.index}`;
      const configured = ROLES.some((r) => c[r]);
      const cs = state(hass, c.charging_entity);
      const power = powerKw(hass, c.power_entity);
      const battery = num(hass, c.battery_entity);
      const limit = num(hass, c.limit_entity);
      const onSet = c.chargingStates ? new Set(c.chargingStates) : CAR_ON;
      const isCh = configured && ((cs !== undefined && onSet.has(String(cs).toLowerCase())) || (power !== undefined && power > n.thresholds.car));
      const plugged = isCh || isOn(hass, c.plugged_entity);
      const full = plugged && !isCh && battery !== undefined && limit !== undefined && battery >= limit - 0.5;
      // A car listed in the config with no presence sensor is assumed to be
      // parked at home. A car found on its own only shows while it charges or
      // is plugged in (or with show_unconfigured_cars).
      const pres = c.presence_entity ? state(hass, c.presence_entity) : c.found ? undefined : "home";
      // always a real boolean: classList.toggle(x, undefined) flips the class
      const here = !!(configured ? isCh || plugged || pres === "home" || (c.found && n.showUnconfiguredCars) : n.showUnconfiguredCars);
      const name = c.name || t("car_n", { n: c.index + 1 });

      this._carEls[c.index]?.classList.toggle("here", here);
      for (const m of this._maskImgs[c.index] || []) m.setAttribute("display", here ? "inline" : "none");
      this._tethers[`car${c.index}`]?.classList.toggle("off", !here);
      this._chargers[c.index]?.classList.toggle("here", here);
      if (this._cables[c.index]) {
        setFlow(key, isCh && here, power || 3);
        this._cables[c.index].g.classList.toggle("plugged", !!(plugged && here));
        this._glows[c.index]?.classList.toggle("on", !!(isCh && here));
      }
      if (isCh) out.push(power ? t("house_car_power", { name, power: pw(hass, power) }) : name);

      const chip = this._chips[key];
      if (!chip) continue;
      chip.el.hidden = !here;
      if (!here) continue;
      chip.el.classList.toggle("unconfigured", !configured);
      const nothing = cs === undefined && power === undefined && battery === undefined && state(hass, c.plugged_entity) === undefined && state(hass, c.presence_entity) === undefined;
      const status = !configured
        ? t("car_not_connected")
        : nothing
          ? t("house_car_unavailable")
          : isCh
            ? t("car_charging", { power: power ? pw(hass, power) : "" }).trim()
            : full
              ? t("car_full")
              : plugged
                ? t("car_plugged")
                : t("car_parked");
      const big = battery !== undefined ? `${Math.round(battery)}%` : isCh && power ? pw(hass, power) : "";
      chip.v.textContent = big;
      chip.v.hidden = !big;
      chip.s.textContent = status;
      this._bar(chip, battery, limit);
      chip.el.classList.toggle("charging", !!(isCh && here));
    }
    return out;
  }
}

defineCard("sunflow-house-card", SunFlowHouseCard, {
  name: "SunFlow house",
  description: "Your house with live solar, grid, home, battery and EV flows.",
});
