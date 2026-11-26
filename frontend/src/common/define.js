// Define a custom element once. Skipped if something already took the name
// (the same bundle loaded twice, say).

export function defineElement(tag, cls) {
  if (!customElements.get(tag)) customElements.define(tag, cls);
}
