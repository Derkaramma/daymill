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
const CHARGER_FACE = at(82.8, 43.6); // middle of the charger, where it glows

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

// Two generic EVs made for this picture, same camera and light, with their
// ground shadows baked in. Where they sit came from fitting each car's
// footprint (where its tires and bumpers meet the ground) inside the
// driveway outline, measured on the picture: back edge 70.2,55.1 to 84,52.9,
// front edge 79.8,65.1 to 96.7,59.3. Sizes come from the garage door.
//
// The cables lie on the floor. cable_behind lets the cars hide them where a
// car stands in front, and cable_reveal keeps the bit that plugs in. The card
// draws the nearer car on top, so the SUV overlaps the pickup.
// The SUV is the one that charges and leaves in the demo, since its port is
// the one you can see. The pickup's port is behind the SUV, so its cable
// drops from the charger and disappears behind the cars, until the SUV
// leaves.
export const DEMO_CARS = [
  {
    name: "SUV",
    image: "suv",
    slot: { x: 0.74, y: 0.522, w: 0.125 },
    flip: false,
    port: [0.8111, 0.572], // rear left quarter
    cable_start: CHARGER,
    charger_glow: CHARGER_FACE,
    // down the wall, along the floor and out between the two cars, then in
    // under the SUV's back end and up to the port. Only the plug shows on
    // the car; the rest is hidden wherever a car is in front of it.
    // under the back end it comes out at the rear corner, behind the wheel,
    // and climbs the quarter panel into the port
    cable:
      "M0.828,0.521 L0.828,0.562 C0.829,0.574 0.84,0.59 0.856,0.608 C0.866,0.619 0.872,0.627 0.864,0.632 C0.85,0.638 0.832,0.641 0.822,0.642 C0.817,0.642 0.8175,0.632 0.8178,0.618 C0.818,0.6 0.8175,0.585 0.8111,0.572",
    cable_behind: [0, 1],
    cable_reveal: [
      [0.8215, 0.638, 0.009],
      [0.8178, 0.624, 0.009],
      [0.8178, 0.608, 0.009],
      [0.8165, 0.592, 0.009],
      [0.813, 0.578, 0.009],
    ],
    chip: { x: 0.775, y: 0.675, align: "center", tether: [0.765, 0.612] },
  },
  {
    name: "Pickup",
    image: "pickup",
    slot: { x: 0.8, y: 0.502, w: 0.1325 },
    flip: false,
    port: [0.8157, 0.5404], // front left fender, behind the SUV
    cable_start: CHARGER,
    charger_glow: CHARGER_FACE,
    // down the wall and round the pickup's nose into the fender. The SUV
    // hides it unless the SUV is away.
    cable: "M0.828,0.521 L0.828,0.56 C0.828,0.574 0.82,0.578 0.8157,0.5404",
    cable_behind: [1, 0],
    cable_reveal: [[0.8157, 0.5404, 0.008]],
    chip: { x: 0.92, y: 0.64, align: "center", tether: [0.9, 0.596] },
  },
];
