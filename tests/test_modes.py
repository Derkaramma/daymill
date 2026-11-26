"""Demo data, cost tracking off, car cleanup, export table by PTO year."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry, async_fire_time_changed

from custom_components.daymill.billing import Ledger
from custom_components.daymill.const import DOMAIN, MONEY_KEYS
from custom_components.daymill.coordinator import build_engine, build_nbt
from custom_components.daymill.repairs import ISSUE_TARIFF, issue_id
from custom_components.daymill.sensor import DayMillSensor

from .test_init import BASE_CONFIG, seed_sources


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


async def _setup(hass: HomeAssistant, data: dict[str, Any]) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, data=data, unique_id=DOMAIN)
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


def _state(hass: HomeAssistant, key: str, domain: str = "sensor"):
    return hass.states.get(f"{domain}.daymill_{key}")


# ---- demo data ----

DEMO = {"source": "demo", "system": "demo", "tariff": "sce_tou_d_prime", "nem": "nem2"}


async def test_demo_has_live_values(hass: HomeAssistant, freezer) -> None:
    freezer.move_to("2026-07-15 12:00:00-07:00")
    hass.states.async_set("sun.sun", "above_horizon", {"elevation": 60})
    entry = await _setup(hass, dict(DEMO))
    coordinator = entry.runtime_data
    assert coordinator.tracked_entities() == []

    assert float(_state(hass, "solar_power").state) > 4000
    assert _state(hass, "solar_power").attributes["source"] == "demo"
    assert _state(hass, "status").state == "Exporting"
    assert _state(hass, "battery_soc") is not None
    assert _state(hass, "data_age").state == "0"
    assert _state(hass, "car_car_1_charging_at_home", "binary_sensor").state == "off"
    assert _state(hass, "car_car_2_home_charging_power") is not None

    # a few minutes later the kWh have added up and the ledger has priced them
    for _ in range(3):
        freezer.tick(timedelta(minutes=1))
        async_fire_time_changed(hass)
        await hass.async_block_till_done()
    assert float(_state(hass, "energy_produced").state) > 0.2
    assert float(_state(hass, "energy_exported").state) > 0.1
    assert float(_state(hass, "export_credit").state) > 0


async def test_demo_night_charges_a_car(hass: HomeAssistant, freezer) -> None:
    freezer.move_to("2026-07-15 23:00:00-07:00")
    hass.states.async_set("sun.sun", "below_horizon", {"elevation": -30})
    await _setup(hass, dict(DEMO))
    assert _state(hass, "solar_power").state == "0"
    assert _state(hass, "car_car_1_charging_at_home", "binary_sensor").state == "on"
    assert float(_state(hass, "car_car_1_home_charging_power").state) > 7


# ---- cost tracking off ----


async def test_no_money_sensors_without_cost_tracking(hass: HomeAssistant) -> None:
    seed_sources(hass)
    entry = await _setup(hass, dict(BASE_CONFIG))
    assert _state(hass, "net_cost") is not None

    hass.config_entries.async_update_entry(entry, options={**BASE_CONFIG, "track_cost": False})
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()

    registry = er.async_get(hass)
    for key in MONEY_KEYS:
        assert _state(hass, key) is None, key
        assert registry.async_get_entity_id("sensor", DOMAIN, f"{entry.entry_id}_{key}") is None
    assert _state(hass, "energy_imported") is not None
    assert _state(hass, "import_rate") is not None
    assert "net_cost" not in entry.runtime_data.statistic_ids()


# ---- cars ----


async def test_renamed_car_leaves_no_leftovers(hass: HomeAssistant) -> None:
    seed_sources(hass)
    hass.states.async_set("binary_sensor.car_charging", "off")
    car = {"name": "Old name", "charging": "binary_sensor.car_charging"}
    entry = await _setup(hass, {**BASE_CONFIG, "cars": [car]})
    assert _state(hass, "car_old_name_charging_at_home", "binary_sensor") is not None

    hass.config_entries.async_update_entry(
        entry, options={**BASE_CONFIG, "cars": [{**car, "name": "New name"}]}
    )
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()

    registry = er.async_get(hass)
    ids = {e.unique_id for e in er.async_entries_for_config_entry(registry, entry.entry_id)}
    assert f"{entry.entry_id}_car_new_name_charging_at_home" in ids
    assert not any("old_name" in i for i in ids)


# ---- live updates ----


def test_status_summary_not_recorded() -> None:
    assert "summary" in DayMillSensor._unrecorded_attributes


async def test_data_age_in_whole_minutes(hass: HomeAssistant, freezer) -> None:
    seed_sources(hass)
    await _setup(hass, dict(BASE_CONFIG))
    assert _state(hass, "data_age").state == "0"
    freezer.tick(timedelta(seconds=45))
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    assert _state(hass, "data_age").state == "0"


# ---- tracking start ----


def test_tracking_start_learned_on_first_reading() -> None:
    engine = build_engine(BASE_CONFIG)
    ledger = Ledger(engine, 1)
    when = datetime(2026, 11, 24, 20, 0, tzinfo=UTC)
    ledger.on_energy(when, 100.0, 50.0, 10.0)
    attrs = ledger.bill_estimate(when)["attributes"]
    assert attrs["tracking_start"] == "2026-11-24"
    assert attrs["days_before_tracking"] == 23
    assert attrs["days_in_cycle"] == 24
    assert ledger.to_dict()["tracking_start"] == "2026-11-24"


def test_tracking_start_unknown_for_older_ledgers() -> None:
    engine = build_engine(BASE_CONFIG)
    fresh = Ledger(engine, 1).to_dict()
    fresh.pop("tracking_start")
    ledger = Ledger(engine, 1, fresh)
    when = datetime(2026, 11, 24, 20, 0, tzinfo=UTC)
    ledger.on_energy(when, 100.0, 50.0, 10.0)
    attrs = ledger.bill_estimate(when)["attributes"]
    assert attrs["tracking_start"] is None
    assert attrs["days_before_tracking"] == 0


# ---- NEM 3.0 export table by PTO year ----


@pytest.mark.parametrize(
    ("pto", "vintage"),
    [
        ("2023-06-01", "NBT24"),
        ("2024-03-01", "NBT24"),
        ("2025-05-01", "NBT26"),
        ("2026-02-01", "NBT26"),
        ("2027-08-01", "NBT27"),
        ("2031-01-01", "NBT26"),  # no table yet: the plan's own
        (None, "NBT26"),
    ],
)
def test_export_table_follows_pto_year(pto: str | None, vintage: str) -> None:
    conf = {**BASE_CONFIG, "nem": "nem3"}
    if pto:
        conf["pto_date"] = pto
    engine = build_engine(conf)
    nbt = build_nbt(conf, engine)
    assert nbt is not None
    assert nbt["vintage"] == vintage


def test_engine_and_ledger_share_the_table() -> None:
    conf = {**BASE_CONFIG, "nem": "nem3", "pto_date": "2024-03-01"}
    engine = build_engine(conf)
    nbt = build_nbt(conf, engine) or {}
    when = datetime(2026, 9, 2, 2, 0, tzinfo=UTC)  # 19:00 local, a weekday
    local = when.astimezone(engine.tz)
    table = nbt["prices_by_year"][2026]
    assert engine.export_price(when) == pytest.approx(table[9]["weekday"][local.hour])


# ---- flat example never goes out of date ----


async def test_flat_example_has_no_age_issue(hass: HomeAssistant, freezer) -> None:
    from homeassistant.helpers import issue_registry as ir

    freezer.move_to("2029-01-15 12:00:00-08:00")
    seed_sources(hass)
    entry = await _setup(hass, {**BASE_CONFIG, "tariff": "flat_example"})
    issue = ir.async_get(hass).async_get_issue(DOMAIN, issue_id(ISSUE_TARIFF, entry.entry_id))
    assert issue is None
