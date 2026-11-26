// Define a custom element under its DayMill name and under its old SunFlow
// name, so dashboards saved with `custom:sunflow-...` keep working.
//
// The same constructor can't be registered twice, so the old name gets an
// empty subclass. Both are skipped if something already took the name (an
// older SunFlow bundle that is still loaded, say).

export const oldName = (tag) => tag.replace("daymill", "sunflow");

export function defineElement(tag, cls) {
  if (!customElements.get(tag)) customElements.define(tag, cls);
  const old = oldName(tag);
  if (old !== tag && !customElements.get(old)) customElements.define(old, class extends cls {});
}
