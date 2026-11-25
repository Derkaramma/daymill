// Table builders for the billing, totals and rates cards.

import { h } from "../../common/dom.js";

// A cell is text, a Node, or {text|node, class, sub, title}.
function cell(tag, c) {
  if (c === null || c === undefined) return h(tag);
  if (c instanceof Node || typeof c !== "object") return h(tag, null, c instanceof Node ? c : String(c));
  return h(tag, { class: c.class, title: c.title, colspan: c.span }, c.node ?? c.text ?? "", c.sub ? h("span", { class: "sub", text: c.sub }) : null);
}

// head: [cell], rows: [{cells: [cell], class}] or arrays of cells.
export function table(head, rows, opts = {}) {
  const thead = head ? h("thead", null, h("tr", null, head.map((c) => cell("th", c)))) : null;
  const tbody = h(
    "tbody",
    null,
    rows.filter(Boolean).map((r) => {
      const cells = Array.isArray(r) ? r : r.cells;
      const cls = Array.isArray(r) ? null : r.class;
      return h("tr", { class: cls, "aria-current": cls === "now" ? "true" : null }, cells.map((c) => cell("td", c)));
    }),
  );
  const el = h("table", { class: ["ct-table", opts.class] }, opts.caption ? h("caption", { class: "ct-label", text: opts.caption }) : null, thead, tbody);
  return opts.scroll === false ? el : h("div", { class: "ct-scroll" }, el);
}

// Row label with a colored dot in front.
export function dotLabel(text, color, extra) {
  return h("span", { class: "cell-label" }, h("span", { class: "sf-dot", style: { background: color } }), h("span", { text }), extra || null);
}

// Section with an uppercase label on top.
export function section(label, ...children) {
  return h("div", { class: "ct-section" }, label ? h("div", { class: "ct-label", text: label }) : null, ...children);
}
