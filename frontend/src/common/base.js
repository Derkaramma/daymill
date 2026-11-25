// Tiny base class for the cards. No framework: a shadow root, shared sheets,
// a cheap "did anything I read change" check, and a 60 s tick so time based
// things (stale data, next period change) update even when no state does.

import { adopt, h, replace } from "./dom.js";
import { baseStyles, applyColors } from "./theme.js";
import { setLanguage, t } from "./format.js";
import { dataAge, hasSunflow, resolve, stateObj } from "./entities.js";

export { sheet, adopt, h, s, replace, setStyle, asButton } from "./dom.js";

export const TICK_MS = 60_000;
const MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const FOCUSABLE = '[tabindex="0"], button, a[href], input, select';

export class SunFlowCard extends HTMLElement {
  // Subclasses override these.
  static styles = []; // CSSStyleSheet or CSS text, adopted after the base sheet
  static keys = []; // translation keys this card reads (see entities.js KEYS)
  static grid = { columns: 12, min_columns: 6, rows: "auto" };
  static cardSize = 3;
  static requiresSunflow = true; // show a hint when no SunFlow entities exist

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    adopt(this.shadowRoot, baseStyles, this.constructor.styles);
    this._config = undefined;
    this._hass = undefined;
    this._sig = undefined;
    this._built = false;
    this._timer = undefined;
    this._motion = typeof matchMedia === "function" ? matchMedia(MOTION_QUERY) : undefined;
    this._onMotion = () => {
      this.onMotionChange?.(this.reducedMotion);
      this._update(true);
    };
  }

  // ---- HA card API ----

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("Invalid configuration");
    this.validateConfig(config);
    this._config = { ...config };
    this._sig = undefined;
    this._built = false;
    this._entities = undefined;
    applyColors(this, this._config.colors);
    this._update();
  }

  // Throw an Error with a readable message for bad config.
  validateConfig(_config) {}

  set hass(hass) {
    this._hass = hass;
    if (hass) setLanguage(hass.locale?.language || hass.language);
    this._update();
  }

  get hass() {
    return this._hass;
  }

  get config() {
    return this._config;
  }

  getCardSize() {
    return this.constructor.cardSize;
  }

  getGridOptions() {
    return { ...this.constructor.grid };
  }

  static getStubConfig() {
    return {};
  }

  connectedCallback() {
    this._timer ??= setInterval(() => this._update(true), TICK_MS);
    this._motion?.addEventListener?.("change", this._onMotion);
    this._update();
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    this._timer = undefined;
    this._motion?.removeEventListener?.("change", this._onMotion);
  }

  // ---- for subclasses ----

  get reducedMotion() {
    return !!this._motion?.matches;
  }

  // {key: entity_id} for static keys, with config.entities overrides applied.
  get entities() {
    const reg = this._hass?.entities;
    if (!this._entities || this._entities.reg !== reg) {
      this._entities = { reg, map: resolve(this._hass, this.constructor.keys, this._config?.entities) };
    }
    return this._entities.map;
  }

  // Entity ids whose changes should re-render. Default: every resolved key.
  watchedEntities() {
    return Object.values(this.entities);
  }

  // Called once per config, before the first render. Build static DOM here.
  // Careful with field names: this.title, this.hidden, this.style and friends
  // are HTMLElement properties.
  build() {}

  // Called whenever something watched changed, and on every tick.
  render() {}

  // Run fn, which may rebuild parts of the card. If it removed the element
  // that had keyboard focus, focus its replacement: same data-k, else the
  // same position among the focusable elements.
  keepFocus(fn) {
    const root = this.shadowRoot;
    const before = root.activeElement;
    const list = () => [...root.querySelectorAll(FOCUSABLE)];
    const key = before?.dataset?.k;
    const index = before ? list().indexOf(before) : -1;
    const out = fn();
    if (before && !before.isConnected) {
      const now = list();
      const next = (key && now.find((el) => el.dataset.k === key)) || now[index];
      next?.focus({ preventScroll: true });
    }
    return out;
  }

  // Seconds since the newest source data.
  dataAge() {
    const e = this.entities;
    return dataAge(this._hass, this._config?.entities, [e.solar_power, e.grid_power].filter(Boolean));
  }

  isStale() {
    const age = this.dataAge();
    const minutes = Number(this._config?.stale_minutes ?? 15);
    return age !== undefined && minutes > 0 && age > minutes * 60;
  }

  // Open HA's more-info dialog.
  moreInfo(entityId) {
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }

  // Navigate inside the HA frontend.
  navigate(path, replaceState = false) {
    if (!path) return;
    if (replaceState) history.replaceState(null, "", path);
    else history.pushState(null, "", path);
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: replaceState } }));
  }

  // Message shown instead of the card body.
  showMessage(text) {
    replace(this.shadowRoot, h("ha-card", null, h("div", { class: "sf-empty", text })));
  }

  // ---- internals ----

  _signature() {
    const hass = this._hass;
    return [
      this._config,
      hass?.entities,
      hass?.language,
      hass?.locale,
      hass?.config?.currency,
      hass?.themes?.darkMode,
      ...this.watchedEntities().map((id) => stateObj(hass, id)),
    ];
  }

  _update(force = false) {
    if (!this._config || !this._hass || !this.isConnected) return;
    const sig = this._signature();
    if (!force && this._sig && sig.length === this._sig.length && sig.every((v, i) => v === this._sig[i])) return;
    this._sig = sig;
    try {
      if (!this._built) {
        if (this.constructor.requiresSunflow && !hasSunflow(this._hass) && !this._config.entities) {
          this.showMessage(t("not_found"));
          this._sig = undefined; // try again on the next hass update
          return;
        }
        this.shadowRoot.replaceChildren();
        this.build();
        this._built = true;
      }
      this.keepFocus(() => this.render());
    } catch (err) {
      console.error(`${this.localName}:`, err);
      this._built = false;
      this.showMessage(String(err?.message || err));
    }
  }
}

// Define the element once and list it in the card picker.
export function defineCard(tag, cls, info = {}) {
  if (!customElements.get(tag)) customElements.define(tag, cls);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === tag)) {
    window.customCards.push({ type: tag, preview: true, ...info });
  }
}
