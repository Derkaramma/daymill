// Dashboard strategy: `strategy: {type: custom:daymill}` builds the whole
// DayMill dashboard from the integration's entities. "Edit dashboard" opens
// the house card editor (saved under `house:`), so the dashboard keeps
// updating itself. "Take control" turns it into a normal dashboard.
//
// strategy:
//   type: custom:daymill
//   house: {image_day: /local/day.jpg, image_night: /local/night.jpg}  # extra house card config
//   entities: {solar_power: sensor.other}   # passed to every DayMill card
//   groups: [...]                           # panel groups for the Panels view
//   diagnostics: [sensor.gateway_uptime]
//   views: [home, totals, rates, panels, history]   # pick and order views
//   panels: true                            # force the Panels view on or off
//
// Kept free of DOM helpers so node scripts can call generateDashboard().

import { defineElement } from "../common/define.js";
import { entityId, hasDayMill } from "../common/entities.js";
import { addStrings, t } from "../common/format.js";
import { diagnosticEntities, panelGroups } from "../common/panel-groups.js";

addStrings("en", {
  "dash_title": "DayMill",
  "dash_home": "Home",
  "dash_totals": "Totals",
  "dash_rates": "Rates",
  "dash_panels": "Panels",
  "dash_history": "History",
  "dash_right_now": "Right now",
  "dash_today": "Today",
  "dash_last_24h": "Last 24 hours",
  "dash_billing": "This billing cycle",
  "dash_energy_per_day": "Energy per day",
  "dash_money_per_day": "Money per day",
  "dash_energy_per_month": "Energy per month",
  "dash_not_found": "DayMill entities were not found. Add the DayMill integration under Settings → Devices & services, then reload this page.",
});

export const VIEW_ORDER = ["home", "totals", "rates", "panels", "history"];
const ENERGY_KEYS = ["energy_produced", "energy_consumed", "energy_imported", "energy_exported"];
const MONEY_KEYS = ["net_cost", "solar_savings"];

const card = (name, extra = {}) => ({ type: `custom:daymill-${name}`, ...extra });
const heading = (text) => ({ type: "heading", heading: text });
const section = (span, cards) => ({ type: "grid", column_span: span, cards });

function view(key, icon, sections) {
  return { title: t(`dash_${key}`), path: key, icon, type: "sections", max_columns: 4, dense_section_placement: true, sections };
}

// Entity overrides from the strategy config go to every DayMill card.
function withEntities(cfg, config) {
  return config.entities && typeof config.entities === "object" ? { ...cfg, entities: { ...config.entities } } : cfg;
}

function statGraph(title, ids, period, days) {
  return {
    type: "statistics-graph",
    title,
    entities: ids,
    period,
    days_to_show: days,
    chart_type: "bar",
    stat_types: ["change"],
  };
}

function homeView(hass, config) {
  const sf = (name, extra) => withEntities(card(name, extra), config);
  const house = config.house && typeof config.house === "object" ? config.house : {};
  // With cost tracking off there is no bill to show.
  const bill = !hasDayMill(hass) || entityId(hass, "bill_estimate", config.entities);
  return view("home", "mdi:home-lightning-bolt", [
    { ...section(3, [sf("house-card", house)]), row_span: 2 },
    section(1, [heading(t("dash_right_now")), sf("now-card")]),
    section(2, [heading(t("dash_today")), sf("today-card"), sf("share-ring-card")]),
    section(1, [heading(t("dash_last_24h")), sf("power-chart-card")]),
    bill ? section(2, [heading(t("dash_billing")), sf("billing-card")]) : null,
  ].filter(Boolean));
}

function totalsView(hass, config) {
  const ids = (keys) => keys.map((k) => entityId(hass, k, config.entities)).filter(Boolean);
  const energy = ids(ENERGY_KEYS);
  const money = ids(MONEY_KEYS);
  const sections = [section(4, [withEntities(card("totals-card"), config)])];
  if (energy.length) sections.push(section(2, [statGraph(t("dash_energy_per_day"), energy, "day", 30)]));
  if (money.length) sections.push(section(2, [statGraph(t("dash_money_per_day"), money, "day", 30)]));
  if (energy.length) sections.push(section(4, [statGraph(t("dash_energy_per_month"), energy, "month", 365)]));
  return view("totals", "mdi:sigma", sections);
}

function ratesView(config) {
  return view("rates", "mdi:cash-clock", [section(4, [withEntities(card("rates-card"), config)])]);
}

function panelsView(config) {
  const extra = {};
  if (Array.isArray(config.groups)) extra.groups = config.groups;
  if (Array.isArray(config.diagnostics)) extra.diagnostics = config.diagnostics;
  return view("panels", "mdi:solar-panel", [section(4, [withEntities(card("panels-card", extra), config)])]);
}

function historyView(config) {
  return view("history", "mdi:chart-line", [section(4, [withEntities(card("history-card"), config)])]);
}

// True when the Panels view has something to show.
export function hasPanels(hass, config = {}) {
  if (typeof config.panels === "boolean") return config.panels;
  return panelGroups(hass, config).length > 0 || diagnosticEntities(hass, config).length > 0;
}

// The dashboard config for a strategy config and hass.
export function generateDashboard(config = {}, hass) {
  const cfg = config && typeof config === "object" ? config : {};
  if (!hasDayMill(hass) && !cfg.entities) {
    return {
      title: t("dash_title"),
      views: [{ title: t("dash_title"), path: "home", type: "sections", max_columns: 4, sections: [section(4, [{ type: "markdown", content: t("dash_not_found") }])] }],
    };
  }
  const wanted = Array.isArray(cfg.views) ? cfg.views.filter((v) => VIEW_ORDER.includes(v)) : VIEW_ORDER;
  const build = {
    home: () => homeView(hass, cfg),
    totals: () => totalsView(hass, cfg),
    rates: () => ratesView(cfg),
    panels: () => (hasPanels(hass, cfg) ? panelsView(cfg) : null),
    history: () => historyView(cfg),
  };
  const views = wanted.map((v) => build[v]()).filter(Boolean);
  return { title: cfg.title || t("dash_title"), views };
}

// HA looks up `ll-strategy-dashboard-<name>` and calls the static generate()
// with the strategy config.
if (typeof HTMLElement !== "undefined" && typeof customElements !== "undefined") {
  class DayMillDashboardStrategy extends HTMLElement {
    static async generate(config, hass) {
      return generateDashboard(config, hass);
    }

    static async getConfigElement() {
      return document.createElement("daymill-strategy-editor");
    }
  }
  defineElement("ll-strategy-dashboard-daymill", DayMillDashboardStrategy);
}
