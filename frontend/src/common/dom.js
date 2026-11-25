// Small DOM helpers. Styles only go through constructable sheets and the
// CSSOM (el.style), never through style attributes or <style> tags, so the
// cards work under a strict Content-Security-Policy.

const sheets = new Map();

// CSS text -> shared CSSStyleSheet (one per distinct text).
export function sheet(cssText) {
  let s = sheets.get(cssText);
  if (!s) {
    s = new CSSStyleSheet();
    s.replaceSync(cssText);
    sheets.set(cssText, s);
  }
  return s;
}

// Adopt sheets (CSSStyleSheet or CSS text) into a shadow root, keeping order.
export function adopt(root, ...items) {
  const list = items.flat(Infinity).filter(Boolean).map((i) => (typeof i === "string" ? sheet(i) : i));
  root.adoptedStyleSheets = [...new Set(list)];
}

// Set inline styles through the CSSOM. Keys may be camelCase or --custom.
export function setStyle(el, styles) {
  if (!styles) return el;
  for (const [k, v] of Object.entries(styles)) {
    if (v === null || v === undefined || v === false) {
      if (k.startsWith("--") || k.includes("-")) el.style.removeProperty(k);
      else el.style[k] = "";
    } else if (k.startsWith("--") || k.includes("-")) {
      el.style.setProperty(k, String(v));
    } else {
      el.style[k] = String(v);
    }
  }
  return el;
}

function apply(el, props) {
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "style") setStyle(el, v);
    else if (k === "class") el.setAttribute("class", Array.isArray(v) ? v.filter(Boolean).join(" ") : v);
    else if (k === "text") el.textContent = String(v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  return el;
}

function append(el, children) {
  for (const c of [children].flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// h("div", {class: "x", style: {color: "red"}, onclick: fn}, ...children)
export function h(tag, props, ...children) {
  return append(apply(document.createElement(tag), props), children);
}

// Same for SVG elements.
export const SVG_NS = "http://www.w3.org/2000/svg";
export function s(tag, props, ...children) {
  return append(apply(document.createElementNS(SVG_NS, tag), props), children);
}

// Replace all children.
export function replace(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

// Make an element act like a button: focusable, Enter and Space activate it.
// The label is only used when the element has no text of its own: a tile that
// shows "Solar 2.10 kW" is named by its text, so the value gets read too.
export function asButton(el, onActivate, label) {
  el.setAttribute("role", "button");
  el.tabIndex = 0;
  if (label && !el.textContent.trim()) el.setAttribute("aria-label", label);
  el.addEventListener("click", onActivate);
  el.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      onActivate(ev);
    }
  });
  return el;
}
