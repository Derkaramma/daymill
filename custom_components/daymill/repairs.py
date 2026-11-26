"""Repair issues that the user should act on.

- tariff_out_of_date: the rate preset's effective date is more than 13
  months old, so prices have probably changed. Points to the options.
- source_unavailable: a configured source sensor has been missing or
  unavailable for over an hour.

Both are checked at setup and every few minutes after, and cleared as soon as
the cause goes away or the entry unloads. The YAML resource issue lives in
frontend.py.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from datetime import date, datetime, timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.util import dt as dt_util

from .const import (
    CONF_BATTERY_POWER,
    CONF_BATTERY_SOC,
    CONF_EXPORT_ENERGY,
    CONF_GRID_POWER,
    CONF_GRID_POWER_FALLBACK,
    CONF_HOME_POWER,
    CONF_IMPORT_ENERGY,
    CONF_SOLAR_ENERGY,
    CONF_SOLAR_POWER,
    CONF_SOLAR_POWER_FALLBACK,
    CONF_SOURCE,
    DOMAIN,
    SOURCE_DEMO,
)

ISSUE_TARIFF = "tariff_out_of_date"
ISSUE_SOURCES = "source_unavailable"

TARIFF_MAX_AGE_MONTHS = 13
SOURCE_GRACE = timedelta(hours=1)
CHECK_INTERVAL = timedelta(minutes=5)

# Cars and panels are left out on purpose: cars drop off when they sleep or
# leave, and panels go quiet at night. The health check covers panels.
SOURCE_KEYS = (
    CONF_SOLAR_POWER,
    CONF_SOLAR_POWER_FALLBACK,
    CONF_GRID_POWER,
    CONF_GRID_POWER_FALLBACK,
    CONF_HOME_POWER,
    CONF_SOLAR_ENERGY,
    CONF_IMPORT_ENERGY,
    CONF_EXPORT_ENERGY,
    CONF_BATTERY_POWER,
    CONF_BATTERY_SOC,
)

_BAD = (STATE_UNAVAILABLE, STATE_UNKNOWN)


def issue_id(kind: str, entry_id: str) -> str:
    return f"{kind}_{entry_id}"


def options_url(entry_id: str) -> str:
    return f"/config/integrations/integration/{DOMAIN}#config_entry={entry_id}"


# ---- pure checks ----


def add_months(day: date, months: int) -> date:
    """Same day n months later, clamped to the end of shorter months."""
    total = day.month - 1 + months
    year, month = day.year + total // 12, total % 12 + 1
    for d in (day.day, 30, 29, 28):
        try:
            return date(year, month, d)
        except ValueError:
            continue
    raise ValueError(day)


def tariff_out_of_date(
    effective: date | None, today: date, months: int = TARIFF_MAX_AGE_MONTHS
) -> bool:
    """True once `months` have passed since the preset's effective date."""
    if effective is None:
        return False
    return today > add_months(effective, months)


def source_entities(conf: Mapping[str, Any]) -> list[str]:
    """Configured source sensors, in a stable order without repeats."""
    if conf.get(CONF_SOURCE) == SOURCE_DEMO:
        return []
    out: list[str] = []
    for key in SOURCE_KEYS:
        value = conf.get(key)
        if isinstance(value, str) and value and value not in out:
            out.append(value)
    return out


def down_sources(
    hass: HomeAssistant,
    entity_ids: Iterable[str],
    now: datetime,
    missing_since: dict[str, datetime],
    grace: timedelta = SOURCE_GRACE,
) -> list[str]:
    """Sources that have been missing or unavailable for longer than grace.

    A missing entity has no timestamp of its own, so the first time we see it
    missing goes into missing_since (kept by the caller between checks).
    """
    out = []
    for entity_id in entity_ids:
        state = hass.states.get(entity_id)
        if state is None:
            since = missing_since.setdefault(entity_id, now)
        else:
            missing_since.pop(entity_id, None)
            if state.state not in _BAD:
                continue
            since = state.last_changed
        if now - since > grace:
            out.append(entity_id)
    return out


# ---- issues ----


@callback
def async_check_tariff(hass: HomeAssistant, entry: ConfigEntry, now: datetime) -> bool:
    """Raise or clear the out of date rates issue. Returns True if raised."""
    coordinator = getattr(entry, "runtime_data", None)
    engine = getattr(coordinator, "engine", None)
    tariff = getattr(engine, "tariff", None)
    iid = issue_id(ISSUE_TARIFF, entry.entry_id)
    if tariff is None:
        ir.async_delete_issue(hass, DOMAIN, iid)
        return False
    effective = tariff.effective_date
    today = dt_util.as_local(now).date()
    no_expiry = bool((getattr(tariff, "extras", None) or {}).get("no_expiry"))
    if no_expiry or not tariff_out_of_date(effective, today):
        ir.async_delete_issue(hass, DOMAIN, iid)
        return False
    ir.async_create_issue(
        hass,
        DOMAIN,
        iid,
        is_fixable=False,
        is_persistent=False,
        severity=ir.IssueSeverity.WARNING,
        translation_key=ISSUE_TARIFF,
        translation_placeholders={
            "tariff": tariff.name,
            "date": effective.isoformat(),
            "options_url": options_url(entry.entry_id),
        },
    )
    return True


@callback
def async_check_sources(
    hass: HomeAssistant,
    entry: ConfigEntry,
    now: datetime,
    missing_since: dict[str, datetime],
) -> list[str]:
    """Raise or clear the unavailable sources issue. Returns the bad entities."""
    conf = getattr(getattr(entry, "runtime_data", None), "conf", None)
    if conf is None:
        conf = dict(entry.options) if entry.options else dict(entry.data)
    down = down_sources(hass, source_entities(conf), now, missing_since)
    iid = issue_id(ISSUE_SOURCES, entry.entry_id)
    if not down:
        ir.async_delete_issue(hass, DOMAIN, iid)
        return down
    ir.async_create_issue(
        hass,
        DOMAIN,
        iid,
        is_fixable=False,
        is_persistent=False,
        severity=ir.IssueSeverity.WARNING,
        translation_key=ISSUE_SOURCES,
        translation_placeholders={
            "entities": ", ".join(down),
            "options_url": options_url(entry.entry_id),
        },
    )
    return down


@callback
def async_delete_issues(hass: HomeAssistant, entry_id: str) -> None:
    for kind in (ISSUE_TARIFF, ISSUE_SOURCES):
        ir.async_delete_issue(hass, DOMAIN, issue_id(kind, entry_id))


@callback
def async_setup_repairs(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Check now and every few minutes; clear our issues on unload."""
    missing_since: dict[str, datetime] = {}

    @callback
    def _check(now: datetime | None = None) -> None:
        now = dt_util.utcnow() if now is None else dt_util.as_utc(now)
        async_check_tariff(hass, entry, now)
        async_check_sources(hass, entry, now, missing_since)

    _check()
    entry.async_on_unload(async_track_time_interval(hass, _check, CHECK_INTERVAL))
    entry.async_on_unload(lambda: async_delete_issues(hass, entry.entry_id))
