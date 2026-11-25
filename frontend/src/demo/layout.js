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

// Spots on the picture. The gray box on the left wall is where the lines
// meet: solar comes down off the roof into its top, the house feeds off its
// right side and the grid line runs out the bottom to the lawn corner.
const BOX = at(16.7, 46.9); // middle of the gray box
const BOX_TOP = at(16.7, 38)[1];
const BOX_BOTTOM = at(16.7, 55)[1];
const BOX_RIGHT = at(18, 46.9)[0];
const EAVE = at(16.7, 26.4); // roof edge right above the box
const ROOF = at(18.8, 24.6); // up on the roof
const SLATS = at(21.3, 46.9)[0]; // wood slats right of the box
const WALL_FOOT = at(21.3, 57.7)[1]; // where the slats meet the plants
const BELOW = at(16.3, 59.2); // just under the box
const CORNER = at(12.8, 65.3); // lawn edge out front
const CHARGER = at(82.8, 47.6); // bottom of the wall charger

export const DEMO_LAYOUT = {
  panel: { x: BOX[0], y: BOX[1], w: 0.001, h: 0.001, show: false },
  junction: BOX,
  round_corners: 0.006,
  lines: {
    solar: [[ROOF, EAVE, [BOX[0], BOX_TOP], BOX]],
    home: [BOX, [BOX_RIGHT, BOX[1]], [SLATS, BOX[1]], [SLATS, WALL_FOOT]],
    grid: [BOX, [BOX[0], BOX_BOTTOM], [BELOW[0], BELOW[1]], CORNER],
    // the box is the battery, so its line is just a short drop inside it
    battery: [BOX, [BOX[0], at(16.7, 52)[1]]],
  },
  battery: { x: BOX[0], y: at(16.7, 52)[1], w: 0.02, h: 0.05, show: true },
  chips: {
    solar: { x: 0.19, y: 0.035, align: "center" },
    rate: { x: 0.985, y: 0.035, align: "right" },
    today: { stack: true },
    grid: { x: 0.015, y: 0.83, align: "left" },
    battery: { x: 0.18, y: 0.83, align: "left" },
    home: { x: 0.43, y: 0.83, align: "center" },
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
