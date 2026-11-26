"""Synthetic data for the demo, the card editor preview and tests.

Everything is deterministic: the same (scenario, time_of_day, t) always gives
the same numbers. Movement comes from slow sine waves of t (seconds), so a
demo that ticks t forward looks alive without any randomness. Keep this file
free of HA imports and fancy math so it can be ported to JS one to one.
Rates are generic examples, not any real tariff. Grid is whatever balances:
grid = home (with car charging) - solar - battery.
"""

from __future__ import annotations

import math
from typing import Any

from .sources import (
    grid_export_kw,
    grid_import_kw,
    self_sufficiency,
    status,
    status_summary,
)

SCENARIOS = (
    "normal",
    "high-generation",
    "high-usage",
    "car-charging",
    "both-plugged",
    "car-away",
    "cloudy",
    "battery-charging",
    "battery-discharging",
)
TIMES = ("day", "night")

BATTERY_CAPACITY_KWH = 13.5
BASE_CHARGE = 0.50

# scenario -> (solar_day, home_day, home_night, battery_day, battery_night)
_BASE: dict[str, tuple[float, float, float, float, float]] = {
    "normal": (5.2, 1.6, 1.9, 0.0, 0.0),
    "high-generation": (9.4, 1.2, 1.6, 0.0, 0.0),
    "high-usage": (5.2, 6.8, 5.4, 0.0, 0.0),
    "car-charging": (5.2, 1.6, 1.9, 0.0, 0.0),
    "both-plugged": (5.2, 1.6, 1.9, 0.0, 0.0),
    "car-away": (5.2, 1.4, 1.7, 0.0, 0.0),
    "cloudy": (1.1, 1.6, 1.9, 0.0, 0.0),
    # at night the charged battery just sits; it never charges from the grid
    "battery-charging": (6.5, 1.5, 1.5, -3.0, 0.0),
    "battery-discharging": (0.8, 2.4, 2.4, 2.0, 2.4),
}

# scenario -> (soc by day, soc at night)
_BATTERY_SOC = {"battery-charging": (55.0, 95.0), "battery-discharging": (70.0, 70.0)}
_BATTERY_SOC_DEFAULT = 80.0

_RATES = {
    "day": {"period": "off_peak", "label": "Off-Peak", "import": 0.31, "export": 0.05},
    "night": {"period": "on_peak", "label": "On-Peak", "import": 0.52, "export": 0.09},
}

_TODAY = {"day": (18.0, 14.0), "night": (32.0, 30.0)}
_SELF_USE_SHARE = 0.55
# Share of the day's use that happened while the sun was up. After sunset
# everything comes from the grid (or the battery), so at night solar can't
# have covered more than this.
_DAYLIGHT_USE = {"day": 1.0, "night": 0.5}

# Car slots: (name, charger kW, soc when charging, soc when idle, limit)
_CARS = (
    ("Car 1", 7.2, 46.0, 80.0, 80.0),
    ("Car 2", 9.6, 58.0, 90.0, 90.0),
)

# scenario -> per-car mode: "charging", "full" (plugged, at limit), "home", "away"
_CAR_MODES = {
    "car-charging": ("charging", "home"),
    "both-plugged": ("charging", "full"),
    "car-away": ("away", "home"),
}
_CAR_MODES_DEFAULT = ("full", "home")

# Hours of charging already done today, for the today totals.
_CAR_HOURS_TODAY = {"day": 1.5, "night": 3.0}


def _wave(t: float, period: float, phase: float = 0.0) -> float:
    return math.sin(2 * math.pi * t / period + phase)


def _normalize(scenario: str) -> str:
    key = scenario.strip().lower().replace("_", "-")
    if key not in _BASE:
        raise ValueError(f"unknown scenario: {scenario}")
    return key


def _cars(scenario: str, t: float) -> list[dict[str, Any]]:
    modes = _CAR_MODES.get(scenario, _CAR_MODES_DEFAULT)
    soc_drift = 0.5 * _wave(t, 600)
    cars = []
    for (name, charger_kw, soc_charging, soc_idle, limit), mode in zip(_CARS, modes, strict=True):
        charging = mode == "charging"
        if charging:
            power = round(charger_kw + 0.05 * _wave(t, 31), 3)
            soc = round(min(soc_charging + soc_drift, limit), 1)
        else:
            power = 0.0
            # A full car sits at its limit; an unplugged one floats below it.
            soc = limit if mode == "full" else round(min(soc_idle - 12 + soc_drift, limit), 1)
        cars.append(
            {
                "name": name,
                "home": mode != "away",
                "plugged": mode in ("charging", "full"),
                "charging": charging,
                "power_kw": power,
                "soc": soc,
                "limit": limit,
            }
        )
    return cars


def simulate(scenario: str = "normal", time_of_day: str = "day", t: float = 0.0) -> dict:
    """Return one snapshot of synthetic values.

    Drift: solar x (1 + 0.04 sin(2 pi t / 90)) (cloudy: 0.30, 23 s), home x
    (1 + 0.06 sin(2 pi t / 47 + 1)), car kW + 0.05 sin(2 pi t / 31), state of
    charge + 0.5 sin(2 pi t / 600). Today totals scale the "normal" day by the
    scenario's solar and home ratios; self-use is min(55 % of produced, used
    while the sun was up).
    """
    key = _normalize(scenario)
    tod = time_of_day.strip().lower()
    if tod not in TIMES:
        raise ValueError(f"unknown time_of_day: {time_of_day}")
    is_day = tod == "day"

    solar_base, home_day, home_night, batt_day, batt_night = _BASE[key]
    if is_day:
        amp, period = (0.30, 23.0) if key == "cloudy" else (0.04, 90.0)
        solar = solar_base * (1 + amp * _wave(t, period))
    else:
        solar = 0.0
    home_base = (home_day if is_day else home_night) * (1 + 0.06 * _wave(t, 47, 1.0))

    cars = _cars(key, t)
    car_kw = sum(c["power_kw"] for c in cars)
    home = home_base + car_kw

    battery = batt_day if is_day else batt_night
    soc_day, soc_night = _BATTERY_SOC.get(key, (_BATTERY_SOC_DEFAULT, _BATTERY_SOC_DEFAULT))
    battery_soc = (soc_day if is_day else soc_night) + 0.5 * _wave(t, 600)

    solar = round(solar, 3)
    home = round(home, 3)
    battery = round(battery, 3)
    grid = round(home - solar - battery, 3)

    rate = _RATES[tod]
    price = rate["import"] if grid > 0 else rate["export"]

    # Today totals, scaled from "normal".
    n_solar, n_home_day, n_home_night = _BASE["normal"][:3]
    base_prod, base_used = _TODAY[tod]
    n_home = n_home_day if is_day else n_home_night
    produced = base_prod * (solar_base / n_solar)
    car_kwh = sum(c["power_kw"] * _CAR_HOURS_TODAY[tod] for c in cars if c["charging"])
    used = base_used * ((home_day if is_day else home_night) / n_home) + car_kwh
    self_used = min(produced * _SELF_USE_SHARE, used * _DAYLIGHT_USE[tod])
    exported = produced - self_used
    imported = used - self_used
    cost_today = imported * rate["import"] - exported * rate["export"] + BASE_CHARGE

    return {
        "scenario": key,
        "time_of_day": tod,
        "is_day": is_day,
        "sun_elevation": 45.0 if is_day else -20.0,
        "solar_kw": solar,
        "grid_kw": grid,
        "home_kw": home,
        "grid_import_kw": round(grid_import_kw(grid), 3),
        "grid_export_kw": round(grid_export_kw(grid), 3),
        "self_sufficiency": self_sufficiency(solar, home),
        "status": status(solar, grid),
        "summary": status_summary(solar, grid, home),
        "battery_kw": battery,
        "battery_soc": round(battery_soc, 1),
        "battery_capacity_kwh": BATTERY_CAPACITY_KWH,
        "cars": cars,
        "period": rate["period"],
        "period_label": rate["label"],
        "rate": rate["import"],
        "import_rate": rate["import"],
        "export_rate": rate["export"],
        "cost_rate": round(grid * price, 3),
        "cost_today": round(cost_today, 2),
        "produced_today": round(produced, 2),
        "used_today": round(used, 2),
        "imported_today": round(imported, 2),
        "exported_today": round(exported, 2),
        "self_sufficiency_today": round(self_used / used * 100) if used > 0 else 100,
    }
