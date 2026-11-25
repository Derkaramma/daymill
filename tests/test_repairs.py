"""Repair issues: old rate presets and sources that went away."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import ATTR_UNIT_OF_MEASUREMENT
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir
from pytest_homeassistant_custom_component.common import MockConfigEntry, async_fire_time_changed

from custom_components.sunflow_solar.const import DOMAIN
from custom_components.sunflow_solar.repairs import (
    ISSUE_SOURCES,
    ISSUE_TARIFF,
    add_months,
    issue_id,
    source_entities,
    tariff_out_of_date,
)


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(recorder_mock, enable_custom_integrations):
    yield


@pytest.fixture(autouse=True)
async def unload_entries(hass: HomeAssistant):
    """Unload before teardown so no timer fires into a closed recorder."""
    yield
    for entry in hass.config_entries.async_entries(DOMAIN):
        if entry.state is ConfigEntryState.LOADED:
            await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()


CONFIG: dict[str, Any] = {
    "tariff": "sce_tou_d_prime",
    "nem": "nem2",
    "cycle_day": 1,
    "grid_positive_is_import": True,
    "solar_power": "sensor.pv_live",
    "grid_power": "sensor.grid_live",
    "solar_energy": "sensor.pv_lifetime",
    "import_energy": "sensor.grid_in_lifetime",
    "export_energy": "sensor.grid_out_lifetime",
    "cars": [{"name": "Car", "charging": "binary_sensor.car_charging"}],
}


def _seed(hass: HomeAssistant, skip: tuple[str, ...] = ()) -> None:
    for entity_id, value, unit in (
        ("sensor.pv_live", 2.0, "kW"),
        ("sensor.grid_live", 0.5, "kW"),
        ("sensor.pv_lifetime", 1000.0, "kWh"),
        ("sensor.grid_in_lifetime", 500.0, "kWh"),
        ("sensor.grid_out_lifetime", 200.0, "kWh"),
    ):
        if entity_id not in skip:
            hass.states.async_set(entity_id, str(value), {ATTR_UNIT_OF_MEASUREMENT: unit})


async def _setup(hass: HomeAssistant, config: dict[str, Any] | None = None) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, data=config or CONFIG)
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


def _issue(hass: HomeAssistant, kind: str, entry: MockConfigEntry) -> ir.IssueEntry | None:
    return ir.async_get(hass).async_get_issue(DOMAIN, issue_id(kind, entry.entry_id))


async def _advance(hass: HomeAssistant, freezer, minutes: float) -> None:
    freezer.tick(timedelta(minutes=minutes))
    async_fire_time_changed(hass)
    await hass.async_block_till_done()


# ---- pure helpers ----


def test_add_months() -> None:
    assert add_months(date(2026, 10, 1), 13) == date(2027, 11, 1)
    assert add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert add_months(date(2027, 12, 15), 2) == date(2028, 2, 15)
    assert add_months(date(2028, 1, 31), 1) == date(2028, 2, 29)


def test_tariff_age() -> None:
    eff = date(2026, 10, 1)
    assert not tariff_out_of_date(eff, date(2027, 11, 1))
    assert tariff_out_of_date(eff, date(2027, 11, 2))
    assert not tariff_out_of_date(eff, date(2026, 9, 1))
    assert not tariff_out_of_date(None, date(2030, 1, 1))


def test_source_entities_skip_cars_panels_and_demo() -> None:
    conf = {
        **CONFIG,
        "grid_power_fallback": "sensor.pv_live",
        "panels": [{"panels": [{"power": "sensor.p1"}]}],
    }
    assert source_entities(conf) == [
        "sensor.pv_live",
        "sensor.grid_live",
        "sensor.pv_lifetime",
        "sensor.grid_in_lifetime",
        "sensor.grid_out_lifetime",
    ]
    assert source_entities({**conf, "source": "demo"}) == []


# ---- out of date rates ----


async def test_no_tariff_issue_while_current(hass: HomeAssistant, freezer) -> None:
    freezer.move_to("2026-11-24 12:00:00-08:00")
    _seed(hass)
    entry = await _setup(hass)
    assert _issue(hass, ISSUE_TARIFF, entry) is None


async def test_tariff_issue_after_13_months(hass: HomeAssistant, freezer) -> None:
    freezer.move_to("2027-12-15 12:00:00-08:00")
    _seed(hass)
    entry = await _setup(hass)
    issue = _issue(hass, ISSUE_TARIFF, entry)
    assert issue is not None
    assert issue.translation_key == ISSUE_TARIFF
    assert issue.severity == ir.IssueSeverity.WARNING
    assert not issue.is_fixable
    placeholders = issue.translation_placeholders or {}
    assert placeholders["date"] == entry.runtime_data.engine.tariff.effective_date.isoformat()
    assert placeholders["tariff"] == entry.runtime_data.engine.tariff.name
    assert entry.entry_id in placeholders["options_url"]
    assert placeholders["options_url"].startswith("/config/integrations/integration/sunflow_solar")

    # unloading clears it
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert _issue(hass, ISSUE_TARIFF, entry) is None


async def test_tariff_issue_appears_while_running(hass: HomeAssistant, freezer) -> None:
    freezer.move_to("2027-11-01 23:50:00-07:00")
    _seed(hass)
    entry = await _setup(hass)
    assert _issue(hass, ISSUE_TARIFF, entry) is None
    await _advance(hass, freezer, 24 * 60)
    assert _issue(hass, ISSUE_TARIFF, entry) is not None


# ---- sources ----


async def test_missing_source_after_an_hour(hass: HomeAssistant, freezer) -> None:
    freezer.move_to("2026-11-24 12:00:00-08:00")
    _seed(hass, skip=("sensor.grid_live",))
    entry = await _setup(hass)
    assert _issue(hass, ISSUE_SOURCES, entry) is None

    await _advance(hass, freezer, 55)
    assert _issue(hass, ISSUE_SOURCES, entry) is None

    await _advance(hass, freezer, 10)
    issue = _issue(hass, ISSUE_SOURCES, entry)
    assert issue is not None
    assert issue.translation_key == ISSUE_SOURCES
    assert (issue.translation_placeholders or {})["entities"] == "sensor.grid_live"

    hass.states.async_set("sensor.grid_live", "0.4", {ATTR_UNIT_OF_MEASUREMENT: "kW"})
    await _advance(hass, freezer, 5)
    assert _issue(hass, ISSUE_SOURCES, entry) is None


async def test_unavailable_source_after_an_hour(hass: HomeAssistant, freezer) -> None:
    freezer.move_to("2026-11-24 12:00:00-08:00")
    _seed(hass)
    entry = await _setup(hass)
    hass.states.async_set("sensor.pv_lifetime", "unavailable")
    hass.states.async_set("binary_sensor.car_charging", "unavailable")
    await _advance(hass, freezer, 30)
    assert _issue(hass, ISSUE_SOURCES, entry) is None

    await _advance(hass, freezer, 35)
    issue = _issue(hass, ISSUE_SOURCES, entry)
    assert issue is not None
    # cars are not sources
    assert (issue.translation_placeholders or {})["entities"] == "sensor.pv_lifetime"

    # a short blip resets the clock
    hass.states.async_set("sensor.pv_lifetime", "1001", {ATTR_UNIT_OF_MEASUREMENT: "kWh"})
    await _advance(hass, freezer, 5)
    assert _issue(hass, ISSUE_SOURCES, entry) is None
    hass.states.async_set("sensor.pv_lifetime", "unknown")
    await _advance(hass, freezer, 30)
    assert _issue(hass, ISSUE_SOURCES, entry) is None


async def test_source_issue_cleared_on_unload(hass: HomeAssistant, freezer) -> None:
    freezer.move_to("2026-11-24 12:00:00-08:00")
    _seed(hass, skip=("sensor.pv_live",))
    entry = await _setup(hass)
    await _advance(hass, freezer, 65)
    assert _issue(hass, ISSUE_SOURCES, entry) is not None
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert _issue(hass, ISSUE_SOURCES, entry) is None
