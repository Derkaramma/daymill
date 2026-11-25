// Where everything goes on the demo house.
//
// The pictures are 2:1 cutouts. The card is 16:10, so the picture runs full
// width and leaves some room above and below it for the chips. styles.js
// sets how that room is split (object-position: 50% 70%). at() turns a spot
// measured on the 2:1 picture (percent of its width and height) into card
// coordinates.

export const PICTURE_Y = 0.7;
const TOP = (1 - 1.6 / 2) * PICTURE_Y; // share of the card height above the picture
const HEIGHT = 1.6 / 2; // share of the card height the picture takes
const r = (v) => Math.round(v * 10000) / 10000;
export const at = (x, y) => [r(x / 100), r(TOP + HEIGHT * (y / 100))];

// Spots on the picture
const HUB = at(55.2, 47.3); // front door, where the lines meet
const ROOF = at(46.7, 24.7); // middle of the panels
const WINDOW = at(41.7, 46.7); // living room
const BATTERY = at(16.7, 52); // bottom of the wall battery
const CHARGER = at(82.8, 47.6); // bottom of the wall charger
const GRID = at(95.3, 58); // lawn edge past the driveway
const BASE = at(0, 55.8)[1]; // along the foot of the walls
const STEP = at(55.2, 61)[1]; // the lawn just past the front step
const DRIVE = at(76.6, 65.4); // front corner of the driveway, nearest us

export const DEMO_LAYOUT = {
  panel: { x: HUB[0], y: HUB[1], w: 0.001, h: 0.001, show: false },
  junction: HUB,
  round_corners: 0.006,
  lines: {
    solar: [[ROOF, [HUB[0], ROOF[1]], HUB]],
    home: [HUB, WINDOW],
    // out the front, then along the front edge of the driveway
    grid: [HUB, [HUB[0], STEP], DRIVE, GRID],
    battery: [HUB, [HUB[0], BASE], [BATTERY[0], BASE], BATTERY],
  },
  battery: { x: BATTERY[0], y: BATTERY[1], w: 0.02, h: 0.05, show: true },
  chips: {
    solar: { x: ROOF[0], y: 0.035, align: "center" },
    rate: { x: 0.015, y: 0.035, align: "left" },
    today: { stack: true },
    grid: { x: 0.985, y: 0.035, align: "right" },
    home: { x: 0.43, y: 0.83, align: "center" },
    battery: { x: 0.035, y: 0.79, align: "left" },
  },
};

// Two drawn cars on the driveway, both wired to the one charger.
export const DEMO_CARS = [
  {
    name: "Sedan",
    image: "builtin:sedan",
    slot: { x: 0.747, y: at(0, 61.8)[1] - 0.075, w: 0.075 },
    flip: true,
    cable_start: CHARGER,
    chip: { x: 0.715, y: 0.8, align: "center" },
  },
  {
    name: "Truck",
    image: "builtin:truck",
    slot: { x: 0.842, y: at(0, 59.6)[1] - 0.08, w: 0.08 },
    flip: false,
    cable_start: CHARGER,
    chip: { x: 0.885, y: 0.8, align: "center" },
  },
];
