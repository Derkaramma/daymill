// daymill-strategy-editor: what HA shows under "Edit dashboard" for the
// DayMill dashboard. It wraps the house card editor and saves the house
// card's settings under `house:` in the strategy config, so a photo and
// layout stay without taking control of the dashboard.

import { defineElement } from "../common/define.js";
import { adopt, h } from "../common/dom.js";
import { baseStyles } from "../common/theme.js";
import { setLanguage, t } from "../common/format.js";
import "./house-editor.js";
import "./strings.js";

const CARD = "custom:daymill-house-card";

const styles = `
  :host { display: block; }
  .note { margin: 0 0 12px; color: var(--secondary-text-color); font-size: 14px; line-height: 1.4; }
`;

class StrategyEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    adopt(this.shadowRoot, baseStyles, styles);
    this._config = {};
    this.$editor = document.createElement("daymill-house-card-editor");
    this.$editor.addEventListener("config-changed", (e) => this._changed(e));
    this.$note = h("p", { class: "note" });
    this.shadowRoot.append(this.$note, this.$editor);
  }

  setConfig(config) {
    this._config = { ...(config || {}) };
    const house = this._config.house && typeof this._config.house === "object" ? this._config.house : {};
    const card = { ...house, type: CARD };
    if (this._config.entities) card.entities = this._config.entities;
    this.$editor.setConfig(card);
  }

  set hass(hass) {
    this._hass = hass;
    if (hass) setLanguage(hass.locale?.language || hass.language);
    this.$note.textContent = t("ed_strategy_note");
    this.$editor.hass = hass;
  }

  get hass() {
    return this._hass;
  }

  _changed(e) {
    e.stopPropagation();
    const { type: _type, entities: _entities, ...house } = e.detail?.config || {};
    const config = { ...this._config };
    if (Object.keys(house).length) config.house = house;
    else delete config.house;
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }
}

defineElement("daymill-strategy-editor", StrategyEditor);
