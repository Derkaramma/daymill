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
// meet, but they stop at its edges instead of crossing it: solar comes down
// off the roof into its top, the house feeds off its right side and the grid
// runs out the bottom to the lawn corner. The box spans 15.3-18 across and
// 38-55.2 down.
const CX = 16.7; // middle of the box, left to right
const MID = 46.9; // middle of the box, top to bottom
const BOX_TOP = at(CX, 37.8); // just above the box
const BOX_RIGHT = at(18.2, MID); // just right of it
const BOX_BOTTOM = at(CX, 55.4); // just below it
const ROOF = at(CX, 22.5); // up on the roof, straight above the box
const SLATS = at(21.3, MID)[0]; // wood slats right of the box
const WALL_FOOT = at(21.3, 57.7)[1]; // where the slats meet the plants
const BELOW = at(CX, 62); // straight down from the box onto the lawn
const LAWN_EDGE = at(11.2, 62); // then square left to the lawn edge
const CHARGER = at(82.8, 47.6); // bottom of the wall charger

export const DEMO_LAYOUT = {
  panel: { x: BOX_TOP[0], y: BOX_TOP[1], w: 0.001, h: 0.001, show: false },
  junction: { x: at(CX, MID)[0], y: at(CX, MID)[1], show: false },
  round_corners: 0.006,
  lines: {
    solar: [[ROOF, BOX_TOP]],
    home: [BOX_RIGHT, [SLATS, BOX_RIGHT[1]], [SLATS, WALL_FOOT]],
    grid: [BOX_BOTTOM, BELOW, LAWN_EDGE],
    // the box is the battery, so it gets a chip but no line
    battery: false,
  },
  battery: { x: BOX_TOP[0], y: at(CX, 52)[1], w: 0.02, h: 0.05, show: true },
  // each chip sits next to the end of its own line
  chips: {
    solar: { x: 0.19, y: 0.19, align: "center" },
    rate: { x: 0.985, y: 0.035, align: "right" },
    today: { stack: true },
    battery: { x: 0.015, y: 0.4, align: "left" },
    home: { x: 0.235, y: 0.63, align: "left" },
    grid: { x: 0.015, y: 0.69, align: "left" },
  },
};

// My two cars, parked nose-in on the driveway, both on the one charger.
// The pictures are 800x500 rear 3/4 cutouts. Each car sits in its own lane
// of the driveway (measured on the picture: back edge 70.2,55.1 to 84,52.9,
// front edge 79.8,65.1 to 96.7,59.3), rear toward the street.
// Both charge ports are on the side we see: the Model Y's is in the rear
// corner, the R1S's up front.
export const DEMO_CARS = [
  {
    name: "Car 1",
    image: "tesla",
    slot: { x: 0.718, y: 0.538, w: 0.105 },
    flip: false,
    port: [0.754, 0.591],
    cable_start: CHARGER,
    // down the wall, across the driveway behind the bumper, up into the port
    cable: "M0.828,0.521 C0.82,0.56 0.814,0.63 0.795,0.639 L0.768,0.641 C0.756,0.641 0.752,0.615 0.754,0.591",
    chip: { x: 0.715, y: 0.8, align: "center" },
  },
  {
    name: "Car 2",
    image: "rivian",
    slot: { x: 0.808, y: 0.513, w: 0.11 },
    flip: false,
    port: [0.827, 0.557],
    cable_start: CHARGER,
    cable: "M0.828,0.521 C0.829,0.545 0.83,0.56 0.827,0.557",
    chip: { x: 0.885, y: 0.8, align: "center" },
  },
];
