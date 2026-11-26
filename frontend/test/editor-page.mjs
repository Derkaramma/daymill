// Page script for the editor tests: renders daymill-house-card-editor with
// the fake hass, records config-changed events and feeds each config back
// the way HA's card editor dialog does.
//
// Uploads go through a stub fetchWithAuth that hands the file to the test
// server (POST /upload-sink), which then serves it at /api/image/serve/<id>/original.

import { createFakeHass } from "./fake-hass.js";

const events = [];
const uploads = [];

function fakeFetch(path, init = {}) {
  if (path !== "/api/image/upload" || init.method !== "POST") return Promise.resolve(new Response("", { status: 404 }));
  const file = init.body?.get?.("file");
  uploads.push({ path, field: !!file, type: file?.type, name: file?.name, size: file?.size });
  if (!file) return Promise.resolve(new Response("{}", { status: 400 }));
  return fetch("/upload-sink", { method: "POST", body: file, headers: { "content-type": file.type } });
}

async function render({ config = { type: "custom:daymill-house-card" }, hass = {}, width = 600 } = {}) {
  await customElements.whenDefined("daymill-house-card-editor");
  const stage = document.getElementById("stage");
  stage.replaceChildren();
  const slot = document.createElement("div");
  slot.className = "slot";
  slot.style.width = `${width}px`;
  const el = document.createElement("daymill-house-card-editor");
  el.addEventListener("config-changed", (e) => {
    events.push(e.detail.config);
    // HA hands the new config straight back to the editor
    el.setConfig(e.detail.config);
  });
  el.setConfig(config);
  slot.append(el);
  stage.append(slot);
  const fake = createFakeHass(hass);
  fake.fetchWithAuth = fakeFetch;
  el.hass = fake;
  window.editorHarness.el = el;
  await new Promise((r) => setTimeout(r, 120));
  return true;
}

window.editorHarness = { render, events, uploads };
window.dispatchEvent(new Event("editor-ready"));
