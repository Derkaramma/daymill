"""Pure helpers for reading power and energy sources.

Nothing in here touches Home Assistant. Callers pass plain state strings or
numbers plus ages in seconds, and get kW values back.

Sign conventions used everywhere in the integration:
- grid power: positive = importing, negative = exporting
- battery power: positive = discharging (feeding the house), negative = charging

So at any moment: home = solar + grid + battery.
"""

from __future__ import annotations

import math
from typing import Any, NamedTuple

DEFAULT_MAX_AGE_S = 600
STATUS_THRESHOLD_KW = 0.025  # 25 W dead band for the status text

SOURCE_LIVE = "live"
SOURCE_METER = "meter"
SOURCE_SOLAR_GRID = "solar + grid"

STATUS_EXPORTING = "Exporting"
STATUS_PRODUCING = "Producing"
STATUS_IMPORTING = "Importing"

STATUS_ICONS = {
    STATUS_EXPORTING: "mdi:transmission-tower-export",
    STATUS_PRODUCING: "mdi:solar-power",
    STATUS_IMPORTING: "mdi:transmission-tower-import",
}

# Multiplier to get kW. Unknown units are treated as kW. The config flow
# rejects them up front, so this only matters if a unit changes later.
_POWER_FACTORS = {
    "w": 0.001,
    "kw": 1.0,
    "mw": 1000.0,
    "gw": 1_000_000.0,
}

# Same idea for energy totals, normalized to kWh.
_ENERGY_FACTORS = {
    "wh": 0.001,
    "kwh": 1.0,
    "mwh": 1000.0,
    "gwh": 1_000_000.0,
}


class Reading(NamedTuple):
    """A power value in kW and where it came from."""

    kw: float
    source: str


# Units the config flow accepts (lower case).
POWER_UNITS = frozenset(_POWER_FACTORS)
ENERGY_UNITS = frozenset(_ENERGY_FACTORS)


def to_number(value: Any) -> float | None:
    """Parse a state into a finite float, or None.

    Mirrors Jinja's is_number: "unavailable", "unknown", "", None, NaN and inf
    are all rejected. Booleans are rejected too.
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        num = float(value)
    else:
        try:
            num = float(str(value).strip())
        except ValueError:
            return None
    if not math.isfinite(num):
        return None
    return num


def _factor(unit: str | None, table: dict[str, float]) -> float:
    if not unit:
        return 1.0
    return table.get(unit.strip().lower(), 1.0)


def to_kw(value: Any, unit: str | None) -> float | None:
    """Convert a power state in W/kW/MW/GW to kW. None if not a number."""
    num = to_number(value)
    if num is None:
        return None
    return num * _factor(unit, _POWER_FACTORS)


def to_kwh(value: Any, unit: str | None) -> float | None:
    """Convert an energy state in Wh/kWh/MWh/GWh to kWh. None if not a number."""
    num = to_number(value)
    if num is None:
        return None
    return num * _factor(unit, _ENERGY_FACTORS)


def kw_to_w(kw: float) -> int:
    """kW to whole watts, the way the power sensors report them."""
    return round(kw * 1000)


def is_fresh(age_s: float | None, max_age_s: float = DEFAULT_MAX_AGE_S) -> bool:
    """True when a source reported less than max_age_s seconds ago.

    A missing age counts as stale. Ages come from last_reported, so a sensor
    repeating the same value still counts as fresh.
    """
    return age_s is not None and age_s < max_age_s


def pick_fresh(
    live_state: Any,
    live_age_s: float | None,
    fallback_state: Any,
    max_age_s: float = DEFAULT_MAX_AGE_S,
    *,
    live_unit: str | None = "kW",
    fallback_unit: str | None = "kW",
) -> Reading | None:
    """Use the live value while it is fresh, otherwise the meter.

    Returns None (unavailable) when the live value is stale or missing and the
    meter is not a number. A frozen live value never wins over a dead meter,
    so this never reports a false 0.
    """
    live_kw = to_kw(live_state, live_unit)
    if live_kw is not None and is_fresh(live_age_s, max_age_s):
        return Reading(live_kw, SOURCE_LIVE)
    meter_kw = to_kw(fallback_state, fallback_unit)
    if meter_kw is not None:
        return Reading(meter_kw, SOURCE_METER)
    return None


def solar_power(
    live_state: Any,
    live_age_s: float | None,
    meter_state: Any,
    max_age_s: float = DEFAULT_MAX_AGE_S,
    *,
    live_unit: str | None = "kW",
    meter_unit: str | None = "kW",
) -> Reading | None:
    """Solar production in kW, never below zero."""
    reading = pick_fresh(
        live_state,
        live_age_s,
        meter_state,
        max_age_s,
        live_unit=live_unit,
        fallback_unit=meter_unit,
    )
    if reading is None:
        return None
    return Reading(max(reading.kw, 0.0), reading.source)


def normalize_grid_sign(kw: float, positive_is_import: bool = True) -> float:
    """Flip a grid reading so positive always means import."""
    return kw if positive_is_import else -kw


def grid_power(
    live_state: Any,
    live_age_s: float | None,
    meter_state: Any,
    max_age_s: float = DEFAULT_MAX_AGE_S,
    *,
    live_unit: str | None = "kW",
    meter_unit: str | None = "kW",
    positive_is_import: bool = True,
) -> Reading | None:
    """Signed grid power in kW (positive = import)."""
    reading = pick_fresh(
        live_state,
        live_age_s,
        meter_state,
        max_age_s,
        live_unit=live_unit,
        fallback_unit=meter_unit,
    )
    if reading is None:
        return None
    return Reading(normalize_grid_sign(reading.kw, positive_is_import), reading.source)


def home_power(
    live_state: Any,
    live_age_s: float | None,
    solar_kw: float | None,
    grid_kw: float | None,
    max_age_s: float = DEFAULT_MAX_AGE_S,
    *,
    live_unit: str | None = "kW",
    battery_kw: float | None = None,
) -> Reading | None:
    """House load in kW.

    Uses the live site-load sensor while fresh. Otherwise falls back to
    max(solar + grid + battery, 0). Unavailable if solar or grid is missing.
    """
    live_kw = to_kw(live_state, live_unit)
    if live_kw is not None and is_fresh(live_age_s, max_age_s):
        return Reading(max(live_kw, 0.0), SOURCE_LIVE)
    if solar_kw is None or grid_kw is None:
        return None
    total = solar_kw + grid_kw + (battery_kw or 0.0)
    return Reading(max(total, 0.0), SOURCE_SOLAR_GRID)


def grid_import_kw(grid_kw: float) -> float:
    """Import side of a signed grid reading."""
    return max(grid_kw, 0.0)


def grid_export_kw(grid_kw: float) -> float:
    """Export side of a signed grid reading."""
    return max(-grid_kw, 0.0)


def self_sufficiency(solar_kw: float, home_kw: float) -> int:
    """Share of the current house load covered by solar, 0-100.

    100 when the house draws nothing.
    """
    if home_kw <= 0:
        return 100
    return round(min(solar_kw, home_kw) / home_kw * 100)


def status(solar_kw: float, grid_kw: float) -> str:
    """Exporting, Producing or Importing, with a 25 W dead band."""
    if grid_kw < -STATUS_THRESHOLD_KW:
        return STATUS_EXPORTING
    if solar_kw > STATUS_THRESHOLD_KW:
        return STATUS_PRODUCING
    return STATUS_IMPORTING


def status_icon(solar_kw: float, grid_kw: float) -> str:
    """Icon to go with status()."""
    return STATUS_ICONS[status(solar_kw, grid_kw)]


def status_summary(solar_kw: float, grid_kw: float, home_kw: float) -> str:
    """One-line summary, e.g. "Solar 4.10 kW, home 1.20 kW, exporting 2.90 kW"."""
    if grid_kw < -STATUS_THRESHOLD_KW:
        grid_text = f"exporting {-grid_kw:.2f} kW"
    elif grid_kw > STATUS_THRESHOLD_KW:
        grid_text = f"importing {grid_kw:.2f} kW"
    else:
        grid_text = "grid balanced"
    return f"Solar {solar_kw:.2f} kW, home {home_kw:.2f} kW, {grid_text}"


def clamp_total(new: Any, old: Any, digits: int = 3) -> float | None:
    """Keep a lifetime energy counter from ever going backwards.

    Returns max(new, old). An unavailable new value keeps the old one. A
    reset or a dip to a lower value is ignored. With no old value, a new
    value of 0 or less is treated as "not loaded yet" and returns None.
    """
    new_val = to_number(new)
    old_val = to_number(old)
    if old_val is None:
        if new_val is None or new_val <= 0:
            return None
        return round(new_val, digits)
    if new_val is None:
        return round(old_val, digits)
    return round(max(new_val, old_val), digits)


def freshest_age(*ages: float | None) -> float | None:
    """Smallest of the given ages in seconds, ignoring missing ones."""
    known = [a for a in ages if a is not None]
    return min(known) if known else None


# ---- Battery (beta) ----


def battery_soc(state: Any) -> float | None:
    """State of charge in %, clamped to 0-100."""
    num = to_number(state)
    if num is None:
        return None
    return min(max(num, 0.0), 100.0)


def battery_power(
    state: Any,
    unit: str | None = "kW",
    *,
    positive_is_discharge: bool = True,
) -> float | None:
    """Signed battery power in kW, positive = discharging."""
    kw = to_kw(state, unit)
    if kw is None:
        return None
    return kw if positive_is_discharge else -kw


def battery_split(battery_kw: float) -> tuple[float, float]:
    """Split signed battery power into (charge_kw, discharge_kw), both >= 0."""
    return max(-battery_kw, 0.0), max(battery_kw, 0.0)


# ---- Cars ----

_ON_STATES = {"on", "true", "charging"}


def is_on(state: Any) -> bool:
    """Loose on/off test for binary sensors and similar states."""
    if isinstance(state, bool):
        return state
    if state is None:
        return False
    return str(state).strip().lower() in _ON_STATES


def charging_at_home(charging_state: Any, presence_state: Any = None) -> bool:
    """Car is charging and (if a tracker is set) at home.

    With no presence entity configured, pass None and only the charging
    state is used.
    """
    if not is_on(charging_state):
        return False
    if presence_state is None:
        return True
    return str(presence_state).strip().lower() == "home"


def home_charging_power(
    power_state: Any,
    unit: str | None,
    charging_state: Any,
    presence_state: Any = None,
) -> float:
    """Car charging power in kW while charging at home, else 0."""
    if not charging_at_home(charging_state, presence_state):
        return 0.0
    kw = to_kw(power_state, unit)
    return max(kw, 0.0) if kw is not None else 0.0
