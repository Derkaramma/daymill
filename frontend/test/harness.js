// Page script for harness.html: a stub ha-card, the fake hass and a render
// function that shoot.mjs (or the console) calls:
//   harness.render({card: {type: "custom:sunflow-test-card"}, hass: {scenario: "normal"}, width: 500})
// hass takes createFakeHass options, plus `panels` for made-up panel entities.

import { createFakeHass } from "./fake-hass.js";
import { addPanels } from "./panels-fixture.js";
import "./stub-card.js";

const cardSheet = new CSSStyleSheet();
cardSheet.replaceSync(`
:host {
  display: block;
  background: var(--ha-card-background, var(--card-background-color, #fff));
  border-radius: var(--ha-card-border-radius, 12px);
  border: 1px solid var(--ha-card-border-color, var(--divider-color, #e0e0e0));
  color: var(--primary-text-color);
  overflow: hidden;
}`);

if (!customElements.get("ha-card")) {
  customElements.define(
    "ha-card",
    class extends HTMLElement {
      constructor() {
        super();
        const root = this.attachShadow({ mode: "open" });
        root.adoptedStyleSheets = [cardSheet];
        root.append(document.createElement("slot"));
      }
    },
  );
}

const events = [];
window.addEventListener("hass-more-info", (e) => events.push({ type: e.type, detail: e.detail }), true);
document.addEventListener("hass-more-info", (e) => events.push({ type: e.type, detail: e.detail }));

function tagFor(type) {
  if (!type || typeof type !== "string") throw new Error("card config needs a type");
  return type.startsWith("custom:") ? type.slice(7) : `hui-${type}-card`;
}

async function render({ card, hass = {}, width = 500, light = false } = {}) {
  document.body.classList.toggle("light", !!light);
  const tag = tagFor(card.type);
  await Promise.race([
    customElements.whenDefined(tag),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`element not defined: ${tag}`)), 3000)),
  ]);
  const stage = document.getElementById("stage");
  stage.replaceChildren();
  const slot = document.createElement("div");
  slot.className = "slot";
  slot.style.width = `${width}px`;
  const el = document.createElement(tag);
  el.setConfig(card);
  slot.append(el);
  stage.append(slot);
  // hass.panels: {layout, fault, viaAttribute}, see panels-fixture.js
  const fake = hass.panels ? addPanels(createFakeHass(hass), hass.panels) : createFakeHass(hass);
  el.hass = fake;
  window.harness.el = el;
  window.harness.hass = fake;
  // let async work (history, statistics, images) settle
  await new Promise((r) => setTimeout(r, 50));
  await Promise.all([...(el.shadowRoot?.querySelectorAll("img") || [])].map((img) => img.decode?.().catch(() => {})));
  return { tag, size: el.getCardSize?.(), grid: el.getGridOptions?.() };
}

window.harness = { render, createFakeHass, events };
window.dispatchEvent(new Event("harness-ready"));
