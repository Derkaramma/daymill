// Bits shared by the share ring, now and today cards: extra strings, the
// tile look, durations and tap handling.

import { asButton, h, s } from "./dom.js";
import { addStrings, t } from "./format.js";

addStrings("en", {
  "from_solar_caps": "From solar",
  "right_now": "Right now",
  "today_energy": "Today · energy",
  "today_money": "Today · money",
  "export_at": "Export {price}",
  "in_dur": "in {dur}",
  "dur_min": "{m} min",
  "dur_h": "{h} h",
  "dur_hm": "{h} h {m} min",
  "meter_5min": "5-min meter data",
  "panels_ok_plain": "Panels OK",
  "problem": "Solar needs attention",
  "net_cost_base": "Net cost",
  "incl_daily": "incl. {amount} daily charge",
  "home_from_solar": "Home use from solar",
  "nbc_adders": "NBC + adders",
  "nbc_split": "NBC {nbc} · adders {adders}",
  "cycle_since": "since {date} · day {days}",
  "solar_used_kwh": "{energy} of solar used at home",
  "weekend": "Weekend",
  "weekday": "Weekday",
  "home_now": "now {power}",
  "price_now": "Price now",
  "lifetime": "{amount} all time",
});

export { t };

// Tiles: the same dark glass as the house card's chips, but toned through
// the theme text color so they also read on light themes.
export const tileStyles = `
.sf-glass {
  position: relative;
  border-radius: 14px;
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--sf-text) 7%, transparent),
      color-mix(in srgb, var(--sf-text) 3%, transparent));
  border: 1px solid color-mix(in srgb, var(--sf-text) 10%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 6%, transparent), 0 2px 10px rgba(0, 0, 0, 0.18);
  box-sizing: border-box;
  min-width: 0;
}
.sf-glass[role="button"] { transition: background 0.2s ease, border-color 0.2s ease; }
.sf-glass[role="button"]:hover {
  border-color: color-mix(in srgb, var(--sf-text) 20%, transparent);
  background: color-mix(in srgb, var(--sf-text) 9%, transparent);
}
.sf-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin: 0 2px 10px;
  font-size: 0.78em;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--sf-text-2);
}
.sf-tiles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.sf-tile { padding: 10px 12px 11px; }
.sf-tile .k {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 0.72em;
  font-weight: 500;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--sf-text-2);
  min-width: 0;
}
.sf-tile .k span:last-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sf-tile .v {
  margin-top: 4px;
  font-size: 1.45em;
  font-weight: 650;
  line-height: 1.15;
  color: var(--sf-text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sf-tile .v small {
  font-size: 0.6em;
  font-weight: 500;
  margin-left: 3px;
  color: var(--sf-text-2);
}
.sf-tile .sub {
  margin-top: 2px;
  font-size: 0.78em;
  color: var(--sf-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sf-tile .sub:empty { display: none; }
.glow {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
  background: var(--c, currentColor);
  box-shadow: 0 0 8px var(--c, currentColor);
}
`;

// A tile: {el, value, sub}. color is any CSS color (usually var(--sf-...)).
export function tile(label, color) {
  const dot = h("span", { class: "glow", style: { "--c": color } });
  const value = h("div", { class: "v" });
  const sub = h("div", { class: "sub" });
  const el = h("div", { class: "sf-glass sf-tile" }, h("div", { class: "k" }, dot, h("span", { text: label })), value, sub);
  return { el, value, sub, dot };
}

// Value with a smaller unit after it: "12.4" + "kWh".
export function setValue(el, text, unitText) {
  el.replaceChildren(text);
  if (unitText) el.append(h("small", { text: unitText }));
}

// Make el open a path when one is set, else more-info of entity.
export function tapTarget(card, el, getTarget, label) {
  return asButton(
    el,
    () => {
      const { path, entity } = getTarget();
      if (path) card.navigate(path);
      else card.moreInfo(entity);
    },
    label,
  );
}

// "3 h 20 min" from seconds.
export function duration(seconds) {
  const mins = Math.max(0, Math.round(seconds / 60));
  const hrs = Math.floor(mins / 60);
  const m = mins % 60;
  if (!hrs) return t("dur_min", { m: Math.max(1, m) });
  if (!m) return t("dur_h", { h: hrs });
  return t("dur_hm", { h: hrs, m });
}

// Small line icons (24x24, stroked) so the cards need no icon font.
const ICONS = {
  alert: "M12 3.5 2.8 19.5h18.4L12 3.5zM12 10v4.5M12 17.2v.1",
  chevron: "M9 6l6 6-6 6",
  panel: "M4 6h16l-2 12H6L4 6zM12 6v12M5 12h14",
  sun: "M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  live: "M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6M9 16h4",
};

export function icon(name, cls = "ic") {
  return s(
    "svg",
    { viewBox: "0 0 24 24", class: cls, "aria-hidden": "true" },
    s("path", {
      d: ICONS[name],
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 1.8,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
  );
}
