"""Setup, unload and ledger persistence."""

from __future__ import annotations

from typing import Any

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import ATTR_UNIT_OF_MEASUREMENT
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.sunflow_solar.const import DOMAIN


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(recorder_mock, enable_custom_integrations):
    """Recorder first: the integration depends on it."""
    yield


PV_LIVE = "sensor.pv_live"
PV_METER = "sensor.pv_meter"
GRID_LIVE = "sensor.grid_live"
GRID_METER = "sensor.grid_meter"
PV_TOTAL = "sensor.pv_lifetime"
IMP_TOTAL = "sensor.grid_in_lifetime"
EXP_TOTAL = "sensor.grid_out_lifetime"

BASE_CONFIG: dict[str, Any] = {
    "tariff": "sce_tou_d_prime",
    "nem": "nem2",
    "cycle_day": 1,
    "grid_positive_is_import": True,
    "solar_power": PV_LIVE,
    "solar_power_fallback": PV_METER,
    "grid_power": GRID_LIVE,
    "grid_power_fallback": GRID_METER,
    "solar_energy": PV_TOTAL,
    "import_energy": IMP_TOTAL,
    "export_energy": EXP_TOTAL,
}


def set_power(hass: HomeAssistant, entity_id: str, value: float, unit: str = "kW") -> None:
    hass.states.async_set(entity_id, str(value), {ATTR_UNIT_OF_MEASUREMENT: unit})


def set_energy(hass: HomeAssistant, prod: float, imp: float, exp: float) -> None:
    for entity_id, value in ((PV_TOTAL, prod), (IMP_TOTAL, imp), (EXP_TOTAL, exp)):
        hass.states.async_set(entity_id, str(value), {ATTR_UNIT_OF_MEASUREMENT: "kWh"})


def seed_sources(hass: HomeAssistant) -> None:
    set_power(hass, PV_LIVE, 3.0)
    set_power(hass, PV_METER, 2.9)
    set_power(hass, GRID_LIVE, -1.0)
    set_power(hass, GRID_METER, -0.9)
    set_energy(hass, 1000.0, 500.0, 200.0)


async def setup_entry(
    hass: HomeAssistant, config: dict[str, Any] | None = None, seed: bool = True
) -> MockConfigEntry:
    if seed:
        seed_sources(hass)
    entry = MockConfigEntry(
        domain=DOMAIN, title="SunFlow Solar", data=config or dict(BASE_CONFIG), unique_id=DOMAIN
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_setup_and_unload(hass: HomeAssistant) -> None:
    entry = await setup_entry(hass)
    assert entry.state is ConfigEntryState.LOADED
    assert hass.states.get("sensor.sunflow_solar_power").state == "3000"
    assert hass.states.get("sensor.sunflow_tou_period") is not None

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.NOT_LOADED


async def test_bad_tariff_fails_setup(hass: HomeAssistant) -> None:
    seed_sources(hass)
    entry = MockConfigEntry(
        domain=DOMAIN, data={**BASE_CONFIG, "tariff": "no_such_plan"}, unique_id=DOMAIN
    )
    entry.add_to_hass(hass)
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.SETUP_ERROR


async def test_ledger_survives_reload(hass: HomeAssistant, freezer) -> None:
    # winter weekday, 10:00 local: super off-peak, energy rate 0.23909
    freezer.move_to("2026-01-14 10:00:00-08:00")
    entry = await setup_entry(hass)
    set_energy(hass, 1000.0, 510.0, 200.0)
    await hass.async_block_till_done()
    charge = float(hass.states.get("sensor.sunflow_import_energy_charge").state)
    assert charge == round(10 * 0.23909, 5)

    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert float(hass.states.get("sensor.sunflow_import_energy_charge").state) == charge

    # the baseline came back too: only the new 2 kWh are priced
    set_energy(hass, 1000.0, 512.0, 200.0)
    await hass.async_block_till_done()
    assert float(hass.states.get("sensor.sunflow_import_energy_charge").state) == round(
        12 * 0.23909, 5
    )
    assert float(hass.states.get("sensor.sunflow_energy_imported").state) == 512.0


async def test_store_written_on_unload(hass: HomeAssistant, hass_storage) -> None:
    entry = await setup_entry(hass)
    set_energy(hass, 1001.0, 501.0, 200.0)
    await hass.async_block_till_done()
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    saved = hass_storage[f"{DOMAIN}.{entry.entry_id}"]["data"]
    assert saved["energy"]["imported"] == 501.0
    assert saved["ledger"]["last_import"] == 501.0
    assert saved["cycle_day"] == 1


async def test_cycle_day_change_keeps_cycle(hass: HomeAssistant, freezer) -> None:
    freezer.move_to("2026-01-20 10:00:00-08:00")
    entry = await setup_entry(hass)
    set_energy(hass, 1000.0, 505.0, 200.0)
    await hass.async_block_till_done()

    hass.config_entries.async_update_entry(entry, options={**BASE_CONFIG, "cycle_day": 15})
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    attrs = hass.states.get("sensor.sunflow_bill_estimate").attributes
    assert attrs["cycle_start"] == "2026-01-15"
    assert attrs["import_kwh"] == 5.0


async def test_remove_entry_deletes_store(hass: HomeAssistant, hass_storage) -> None:
    entry = await setup_entry(hass)
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert f"{DOMAIN}.{entry.entry_id}" in hass_storage
    await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    assert f"{DOMAIN}.{entry.entry_id}" not in hass_storage


async def test_nem3_settings_reach_the_ledger(hass: HomeAssistant, freezer) -> None:
    freezer.move_to("2026-07-15 12:00:00-07:00")
    config = {**BASE_CONFIG, "nem": "nem3", "pto_date": "2024-05-01", "arecr": 0.02}
    entry = await setup_entry(hass, config)
    ledger = entry.runtime_data.ledger
    assert ledger.lock_in_end.isoformat() == "2033-05-01"
    assert ledger.acc_plus_rate_at(dt_util.utcnow()) == 0.032
    note = hass.states.get("sensor.sunflow_bill_estimate").attributes["beta_note"]
    assert "one table for every calendar year" not in note
    assert "Average Retail Export" not in note


async def test_tariff_error_is_translated(hass: HomeAssistant) -> None:
    seed_sources(hass)
    entry = MockConfigEntry(
        domain=DOMAIN, data={**BASE_CONFIG, "tariff": "no_such_plan"}, unique_id=DOMAIN
    )
    entry.add_to_hass(hass)
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.reason == "Couldn't load the rate plan: no preset 'no_such_plan'"
