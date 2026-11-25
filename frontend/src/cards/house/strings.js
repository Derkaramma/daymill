// Extra English strings for the house card. Other languages can add the same
// keys with addStrings().

import { addStrings } from "../../common/format.js";

addStrings("en", {
  house_head_solar_only: "Solar is producing {power}",
  house_sub_grid_unavailable: "Grid data unavailable",
  house_sub_export_cover: "Solar {solar} is covering all of your home's {home}",
  house_sub_pull_rest: "Pulling {power} from the grid for the rest",
  house_sub_not_producing: "Solar isn't producing right now",
  house_head_balanced: "Home is balanced with the grid",
  house_battery_idle: "idle",
  house_battery_charging: "charging {power}",
  house_battery_discharging: "discharging {power}",
  house_sub_battery_charging: "Battery charging at {power}",
  house_sub_battery_discharging: "Battery supplying {power}",
  house_car_unavailable: "unavailable",
  house_car_power: "{name} ({power})",
  house_join: " & ",
  house_sep: " · ",
});
