"""Diagnostics download for a SunFlow config entry.

People attach this to bug reports, so anything that points at their house
is redacted: entity ids, car names and devices, serials, the PTO date and
uploaded image URLs (an /api/image/serve/ URL works without a login).
Money and energy numbers are rounded summaries only.
"""

from __future__ import annotations

import re
from typing import Any

from homeassistant.components.diagnostics import REDACTED, async_redact_data
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.const import __version__ as HA_VERSION
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir
from homeassistant.util import dt as dt_util

from .const import (
    CONF_BATTERY_POWER,
    CONF_BATTERY_SOC,
    CONF_CAR_NAME,
    CONF_CARS,
    CONF_EXPORT_ENERGY,
    CONF_GATEWAY,
    CONF_GRID_POWER,
    CONF_GRID_POWER_FALLBACK,
    CONF_HOME_POWER,
    CONF_IMPORT_ENERGY,
    CONF_PANEL_LIST,
    CONF_PANELS,
    CONF_PTO_DATE,
    CONF_SOLAR_ENERGY,
    CONF_SOLAR_POWER,
    CONF_SOLAR_POWER_FALLBACK,
    DOMAIN,
    VERSION,
)

# Config keys whose values are redacted wherever they show up.
TO_REDACT = {
    # sources
    CONF_SOLAR_POWER,
    CONF_SOLAR_POWER_FALLBACK,
    CONF_GRID_POWER,
    CONF_GRID_POWER_FALLBACK,
    CONF_HOME_POWER,
    CONF_SOLAR_ENERGY,
    CONF_IMPORT_ENERGY,
    CONF_EXPORT_ENERGY,
    CONF_GATEWAY,
    "gateway_diagnostics",
    CONF_BATTERY_POWER,
    CONF_BATTERY_SOC,
    # cars and panels (also covers the panel name and the car name)
    "name",
    "device",
    "charging",
    "presence",
    "power",
    "battery",
    "plugged",
    "limit",
    "energy",
    "lifetime",
    "today",
    "last_reported",
    "entity",
    "entity_id",
    # the system itself
    "serial",
    "serial_number",
    "password",
    "host",
    "ip_address",
    "mac",
    CONF_PTO_DATE,
    # images
    "image",
    "image_day",
    "image_night",
    "image_url",
}

# Anything shaped like an entity id or an uploaded image is redacted too,
# whatever key it sits under, so new config keys can't leak by accident.
_ENTITY_ID = re.compile(r"^[a-z_][a-z0-9_]*\.[a-z0-9_]+$")
_IMAGE_URL = re.compile(r"/api/image/serve/")
_SERIAL_KEY = re.compile(r"serial", re.IGNORECASE)

_SOURCE_ROLES = (
    CONF_SOLAR_POWER,
    CONF_SOLAR_POWER_FALLBACK,
    CONF_GRID_POWER,
    CONF_GRID_POWER_FALLBACK,
    CONF_HOME_POWER,
    CONF_SOLAR_ENERGY,
    CONF_IMPORT_ENERGY,
    CONF_EXPORT_ENERGY,
    CONF_GATEWAY,
    CONF_BATTERY_POWER,
    CONF_BATTERY_SOC,
)


def scrub(data: Any) -> Any:
    """Redact known keys, then any value that looks like an entity id or image URL."""
    return _scrub_values(async_redact_data(data, TO_REDACT))


def _scrub_values(data: Any) -> Any:
    if isinstance(data, dict):
        return {
            k: REDACTED if isinstance(k, str) and _SERIAL_KEY.search(k) else _scrub_values(v)
            for k, v in data.items()
        }
    if isinstance(data, (list, tuple)):
        return [_scrub_values(v) for v in data]
    if isinstance(data, str) and (_ENTITY_ID.match(data) or _IMAGE_URL.search(data)):
        return REDACTED
    return data


def _round(value: Any, digits: int = 2) -> Any:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return value
    return round(float(value), digits)


def _source_summary(hass: HomeAssistant, conf: dict[str, Any]) -> dict[str, Any]:
    """Per role: configured, state health and unit. No entity ids."""
    now = dt_util.utcnow()
    out: dict[str, Any] = {}
    for role in _SOURCE_ROLES:
        entity_id = conf.get(role)
        if not entity_id:
            continue
        state = hass.states.get(entity_id)
        if state is None:
            out[role] = {"status": "missing"}
            continue
        status = state.state if state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN) else "ok"
        out[role] = {
            "status": status,
            "unit": state.attributes.get("unit_of_measurement"),
            "device_class": state.attributes.get("device_class"),
            "age_s": round((now - state.last_reported).total_seconds()),
        }
    return out


def _layout_summary(conf: dict[str, Any]) -> dict[str, Any]:
    faces = conf.get(CONF_PANELS) or []
    return {
        "cars": len(conf.get(CONF_CARS) or []),
        "car_names_set": sum(1 for c in conf.get(CONF_CARS) or [] if c.get(CONF_CAR_NAME)),
        "roof_faces": len(faces),
        "panels_per_face": [len(f.get(CONF_PANEL_LIST) or []) for f in faces],
    }


def _ledger_summary(coordinator: Any) -> dict[str, Any]:
    ledger = coordinator.ledger
    now = dt_util.utcnow()
    bill = ledger.bill_estimate(now)
    attrs = bill.get("attributes") or {}
    keep = (
        "days_in_cycle",
        "base_charges",
        "nbc_charges",
        "adder_charges",
        "nem_energy_balance",
        "energy_charges",
        "energy_credits",
        "import_kwh",
        "export_kwh",
    )
    return {
        "mode": ledger.mode,
        "cycle_day": ledger.cycle_day,
        "totals": {k: _round(v) for k, v in ledger.totals.items()},
        "bill_estimate": _round(bill.get("state")),
        "bill": {k: _round(attrs[k]) for k in keep if k in attrs},
        "periods": len(attrs.get("periods") or []),
        "cost_today": _round(ledger.cost_today(now)),
    }


def _snapshot(coordinator: Any) -> dict[str, Any] | None:
    snap = getattr(coordinator, "data", None)
    if snap is None:
        return None

    def reading(r: Any) -> dict[str, Any] | None:
        if r is None:
            return None
        return {"kw": _round(getattr(r, "kw", None), 3), "source": getattr(r, "source", None)}

    return {
        "solar": reading(snap.solar),
        "grid": reading(snap.grid),
        "home": reading(snap.home),
        "battery_kw": _round(snap.battery_kw, 3),
        "battery_soc": _round(snap.battery_soc, 1),
        "data_age_s": _round(snap.data_age, 0),
        "cars_charging": sum(1 for at_home, _kw in snap.cars.values() if at_home),
        "health": snap.health,
        "problem": snap.problem,
    }


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: ConfigEntry
) -> dict[str, Any]:
    coordinator = getattr(entry, "runtime_data", None)
    conf = dict(entry.options) if entry.options else dict(entry.data)
    out: dict[str, Any] = {
        "versions": {
            "integration": VERSION,
            "home_assistant": HA_VERSION,
            "entry": f"{entry.version}.{entry.minor_version}",
        },
        "entry": {
            "title": entry.title,
            "data": scrub(dict(entry.data)),
            "options": scrub(dict(entry.options)),
        },
        "layout": _layout_summary(conf),
        "sources": _source_summary(hass, conf),
        "issues": sorted(
            issue.issue_id
            for (domain, _), issue in ir.async_get(hass).issues.items()
            if domain == DOMAIN and issue.active
        ),
    }
    if coordinator is None or not hasattr(coordinator, "engine"):
        out["loaded"] = False
        return out

    tariff = coordinator.engine.tariff
    out["loaded"] = True
    out["tariff"] = {
        "id": tariff.id,
        "name": tariff.name,
        "effective_date": tariff.effective_date.isoformat() if tariff.effective_date else None,
        "nem": coordinator.engine.nem,
    }
    out["ledger"] = _ledger_summary(coordinator)
    out["snapshot"] = _snapshot(coordinator)
    out["totals_loaded"] = coordinator.totals is not None
    return out
