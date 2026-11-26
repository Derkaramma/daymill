// Records what the demo element does, for demo-test.mjs to read.
// ?time=night&scenario=car-away starts the element in that state, like a
// fresh page load would.
window.demoLog = { ready: [], change: [], oldReady: [], oldChange: [], csp: [] };
document.addEventListener("securitypolicyviolation", (e) => window.demoLog.csp.push(`${e.violatedDirective} ${e.blockedURI}`));
const el = document.getElementById("demo");
const q = new URLSearchParams(location.search);
if (q.get("time")) el.setAttribute("time", q.get("time"));
if (q.get("scenario")) el.setAttribute("scenario", q.get("scenario"));
el.addEventListener("daymill-demo-ready", (e) => window.demoLog.ready.push(e.detail));
// listen on the document so bubbling is checked too
document.addEventListener("daymill-demo-change", (e) => window.demoLog.change.push(e.detail));
// the old SunFlow event names still fire for the website
el.addEventListener("sunflow-demo-ready", (e) => window.demoLog.oldReady.push(e.detail));
document.addEventListener("sunflow-demo-change", (e) => window.demoLog.oldChange.push(e.detail));

// Everything visible on the card that a scenario or time can change.
window.demoSnapshot = () => {
  const root = el.shadowRoot.querySelector("daymill-house-card").shadowRoot;
  const has = (e, c) => e.classList.contains(c);
  return {
    night: has(root.querySelector(".scene"), "is-night"),
    cars: [...root.querySelectorAll(".bcar, .carimg")].sort((a, b) => (a.dataset.car ?? 0) - (b.dataset.car ?? 0)).map((e) => has(e, "here")),
    cables: [...root.querySelectorAll(".cable")].map((g) => ({ on: has(g, "on"), plugged: has(g, "plugged") })),
    flows: [...root.querySelectorAll("g[data-flow]:not(.cable)")].map((g) => `${g.dataset.flow}:${["on", "solar", "import", "export", "home", "batt"].filter((c) => has(g, c)).join(",")}`),
    // a hidden chip keeps whatever it said last; only what shows counts
    chips: [...root.querySelectorAll(".chip")].map((c) => c.hidden ? { k: c.dataset.k, hidden: true } : ({
      k: c.dataset.k,
      hidden: false,
      text: c.textContent,
      bar: c.querySelector(".bar i")?.style.width ?? null,
      tick: c.querySelector(".bar b")?.style.left ?? null,
    })),
  };
};
