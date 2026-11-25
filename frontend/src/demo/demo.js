// <sunflow-demo>: the house card on a sample house, fed by the simulator.
// This is the live demo on the website. Nothing here talks to Home Assistant;
// the numbers come from the same simulator the editor preview uses.
//
//   <sunflow-demo time="day|night" scenario="normal"></sunflow-demo>
//
//   el.setScenario("car-charging")   el.setTime("night")
//   events: sunflow-demo-ready (once), sunflow-demo-change {time, scenario}
//
// Styles go through adoptedStyleSheets and the CSSOM only, so it runs under a
// strict CSP. The only requests it makes are for its own pictures.

import "../cards/house-card.js";
import { adopt, h } from "../common/dom.js";
import { SCENARIOS, TIMES } from "../common/simulator.js";
import { previewCars, previewHass } from "../editor/preview-hass.js";
import { DEMO_CARS, DEMO_LAYOUT } from "./layout.js";
import { cardSheet, hostSheet } from "./styles.js";

const IMG = {
  day: new URL("img/house-day.webp", import.meta.url).href,
  night: new URL("img/house-night.webp", import.meta.url).href,
};
const CAR_IMG = {
  tesla: new URL("img/tesla.webp", import.meta.url).href,
  rivian: new URL("img/rivian.webp", import.meta.url).href,
};

// Every car gets made-up entities, so the simulator can park, plug in and
// charge it.
const CARS = previewCars(DEMO_CARS.map((c) => ({ ...c, image: CAR_IMG[c.image] || c.image })));

const CONFIG = {
  type: "custom:sunflow-house-card",
  image_day: IMG.day,
  image_night: IMG.night,
  image_aspect: "16/10",
  show_footer: false,
  layout: DEMO_LAYOUT,
  cars: CARS,
  colors: { scene_bg: "transparent" },
};

const BASE_HASS = {
  states: {},
  entities: {},
  config: { currency: "USD", time_zone: "America/Los_Angeles" },
  locale: { language: "en", number_format: "language", time_format: "language", time_zone: "local" },
  language: "en",
  themes: { darkMode: false },
};

// Load a picture and wait until it can be drawn. Never rejects.
function preload(url) {
  return new Promise((done) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => (img.decode ? img.decode().catch(() => {}).then(done) : done());
    img.onerror = () => done();
    img.src = url;
  });
}

class SunFlowDemo extends HTMLElement {
  static observedAttributes = ["time", "scenario"];

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    adopt(this.shadowRoot, hostSheet);
    this._time = "day";
    this._scenario = "normal";
    this._ready = false;
    this._card = null;
  }

  connectedCallback() {
    if (!this._started) {
      // read both attributes together; one at a time, the first would put
      // the other back to its default
      this._started = true;
      this._time = valid(TIMES, this.getAttribute("time")) || this._time;
      this._scenario = valid(SCENARIOS, this.getAttribute("scenario")) || this._scenario;
      this._reflect();
    }
    if (!this._card) this._build();
    this._push();
  }

  attributeChangedCallback(name, _old, value) {
    // before the first connect the attributes are read in connectedCallback
    if (this._syncing || !this._started) return;
    if (name === "time") this._set(value, this._scenario);
    else this._set(this._time, value);
  }

  // ---- public API ----

  get time() {
    return this._time;
  }

  get scenario() {
    return this._scenario;
  }

  get scenarios() {
    return [...SCENARIOS];
  }

  setScenario(id) {
    return this._set(this._time, id);
  }

  setTime(time) {
    return this._set(time, this._scenario);
  }

  // ---- internals ----

  // Apply a time and scenario. Anything unknown is ignored and the attribute
  // goes back to what's showing. Returns true when something changed.
  _set(time, scenario) {
    const t = valid(TIMES, time) || this._time;
    const sc = valid(SCENARIOS, scenario) || this._scenario;
    const changed = t !== this._time || sc !== this._scenario;
    this._time = t;
    this._scenario = sc;
    this._reflect();
    if (!changed) return false;
    this._push();
    this.dispatchEvent(new CustomEvent("sunflow-demo-change", { detail: { time: t, scenario: sc }, bubbles: true, composed: true }));
    return true;
  }

  _reflect() {
    this._syncing = true;
    if (this.getAttribute("time") !== this._time) this.setAttribute("time", this._time);
    if (this.getAttribute("scenario") !== this._scenario) this.setAttribute("scenario", this._scenario);
    this._syncing = false;
  }

  _build() {
    const card = document.createElement("sunflow-house-card");
    card.setConfig(CONFIG);
    // the light look goes on top of the card's own sheets
    card.shadowRoot.adoptedStyleSheets = [...card.shadowRoot.adoptedStyleSheets, cardSheet];
    this._card = card;
    this.shadowRoot.append(h("div", { class: "wrap" }, card));
    Promise.all([preload(IMG.day), preload(IMG.night)]).then(() => {
      requestAnimationFrame(() => {
        if (this._ready) return;
        this._ready = true;
        this._reflect();
        this.dispatchEvent(new CustomEvent("sunflow-demo-ready", { detail: { time: this._time, scenario: this._scenario }, bubbles: true, composed: true }));
      });
    });
  }

  _push() {
    if (!this._card) return;
    const { hass } = previewHass(BASE_HASS, { scenario: this._scenario, time: this._time, cars: CARS });
    this._card.hass = hass;
    this.toggleAttribute("data-night", this._time === "night");
  }
}

function valid(list, value) {
  const v = String(value ?? "").trim().toLowerCase();
  return list.includes(v) ? v : "";
}

if (!customElements.get("sunflow-demo")) customElements.define("sunflow-demo", SunFlowDemo);
