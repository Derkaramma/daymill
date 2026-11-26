// Entry point for daymill-cards.js. Each card module defines its own element.

import "./cards/house-card.js";
import "./cards/share-ring-card.js";
import "./cards/now-card.js";
import "./cards/today-card.js";
import "./cards/power-chart-card.js";
import "./cards/billing-card.js";
import "./cards/totals-card.js";
import "./cards/rates-card.js";
import "./cards/panels-card.js";
import "./cards/history-card.js";
import "./cards/strategy.js";
import "./editor/house-editor.js";
import "./editor/strategy-editor.js";

const version = typeof __DAYMILL_VERSION__ === "string" ? __DAYMILL_VERSION__ : "dev";
console.info(`%c DayMill cards %c ${version} `, "color:#000;background:#ffb020;font-weight:700", "color:#ffb020");
