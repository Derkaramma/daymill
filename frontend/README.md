# DayMill cards

Source for the Lovelace cards that ship with the integration. Everything here
gets bundled into one file, `custom_components/daymill/frontend/daymill-cards.js`.
The cards are plain custom elements with no framework and no runtime dependencies.

## Setup

Node 20 or newer.

```sh
cd frontend
npm ci
```

If you'd rather keep `node_modules` somewhere else, install there and point
`NODE_PATH` at it. The scripts load esbuild and Playwright through `require`,
so `NODE_PATH` works:

```sh
cp package.json package-lock.json /some/dir/ && (cd /some/dir && npm ci)
export NODE_PATH=/some/dir/node_modules
```

## Commands

| Command | What it does |
|---|---|
| `npm run build` | Minified build into `custom_components/daymill/frontend/` |
| `npm run watch` | Rebuild on every change (not minified) |
| `node test/check.mjs` | Node-only checks: JS simulator vs `simulator.py`, entity lookup, formatting, websocket helpers |
| `node test/check-aliases.mjs` | The old `sunflow-*` names still work, and both bundles can load together (needs a Chromium) |
| `node test/shoot.mjs --card '<json>' --out card.png` | Render one card in headless Chromium and save a PNG |

`test/check.mjs` runs the Python simulator to compare numbers, so it needs a
Python that can import Home Assistant. Set `PYTHON` to it, e.g. the venv you
run pytest with.

### Screenshots

```sh
node test/shoot.mjs --card '{"type":"custom:daymill-test-card"}' --out /tmp/test.png
node test/shoot.mjs --card-file my-card.json --scenario car-charging --time night --out /tmp/night.png
node test/shoot.mjs --card '{"type":"custom:daymill-test-card"}' --hass '{"staleMinutes":30}' --light --out /tmp/stale.png
```

Options: `--scenario`, `--time day|night`, `--hass '<json>'` (anything
`createFakeHass` takes), `--width`, `--light`, `--scale`, `--assets <dir>`
(served at `/assets/` for card images), `--bundle` (use the built file instead
of `src/`) and `--strict` (exit 1 on console errors or CSP violations).

The page is served with a strict Content-Security-Policy, the same kind the
website demo runs under. If a card sets a `style` attribute or adds a `<style>`
tag, `--strict` fails.

It needs a Chromium. It uses `CHROMIUM_PATH` if set, otherwise any Playwright
browser it can find. To get one: `npx playwright-core install chromium-headless-shell`.

Scenarios: `normal`, `high-generation`, `high-usage`, `car-charging`,
`both-plugged`, `car-away`, `cloudy`, `battery-charging`, `battery-discharging`.

## Layout

```
src/
  index.js            imports every card
  cards/              one file per card, plus the dashboard strategy
  common/
    base.js           DayMillCard base class and defineCard()
    define.js         defines each element under its old sunflow-* name too
    dom.js            h()/s() element builders, sheet(), adopt(), asButton()
    entities.js       find DayMill entities, read states, unit conversion, data age
    format.js         money, kW, kWh, %, times, and the string table t()
    theme.js          default colors (CSS variables) and the shared sheet
    ws.js             history and statistics over the websocket, cached
    svg.js            scales, line/area paths, arcs, donut
    simulator.js      port of simulator.py, plus synthetic history
test/
  fake-hass.js        fake hass built from the simulator
  harness.html/.js    page the screenshots run in
  stub-card.js        tiny card for checking the harness
  shoot.mjs           screenshot script
  check.mjs           node checks
scripts/build.mjs     esbuild
```

## Writing a card

```js
import { DayMillCard, defineCard, h } from "../common/base.js";
import { powerKw } from "../common/entities.js";
import { kw, t } from "../common/format.js";

class NowCard extends DayMillCard {
  static keys = ["solar_power"];   // translation keys to look up
  static styles = [`.big { font-size: 2em; }`];

  build() {
    this.value = h("div", { class: "big" });
    this.shadowRoot.append(h("ha-card", { class: "sf-pad" }, this.value));
  }

  render() {
    this.value.textContent = kw(this.hass, powerKw(this.hass, this.entities.solar_power));
  }
}

defineCard("daymill-now-card", NowCard, { name: "DayMill now", description: "..." });
```

`defineCard()` also registers `sunflow-now-card` as an alias, so dashboards
from before the rename keep working. Only the DayMill name shows up in the
card picker.

How it works:

- **Finding entities.** Cards never hardcode entity ids. `this.entities` maps
  each key in `static keys` to an entity id. It looks through `hass.entities`
  for entries from the `daymill` platform with that `translation_key`
  (or the old `sunflow_solar` one, when there are no DayMill entities yet).
  A user can override any key in the card config:
  `entities: {solar_power: sensor.other}`.
- **When it renders.** `render()` runs when one of the watched states changes,
  and on a 60 second tick so stale-data and time-based text stay current.
  Override `watchedEntities()` to watch more than `static keys`.
- **Styles.** Use `static styles`, which are adopted sheets, and `el.style` /
  `setStyle()`. Never use style attributes, `<style>` tags or `innerHTML` with
  styles in it.
- **Colors.** Colors are CSS variables like `--sf-solar`. A card config can
  override them with `colors: {solar: "#ffaa00"}`.
- **Field names.** Don't name fields after `HTMLElement` properties
  (`title`, `hidden`, `style`, ...).
