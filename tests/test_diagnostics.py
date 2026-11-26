"""Diagnostics download: useful numbers in, anything personal out."""

from __future__ import annotations

import json
from typing import Any

import pytest
from homeassistant.components.diagnostics import REDACTED
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import ATTR_UNIT_OF_MEASUREMENT
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.daymill.const import DOMAIN, VERSION
from custom_components.daymill.diagnostics import (
    async_get_config_entry_diagnostics,
    scrub,
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


IMAGE = "/api/image/serve/0a1b2c3d4e5f60718293a4b5c6d7e8f9/original"

CONFIG: dict[str, Any] = {
    "tariff": "sce_tou_d_prime",
    "nem": "nem3",
    "cycle_day": 1,
    "pto_date": "2024-05-01",
    "grid_positive_is_import": True,
    "solar_power": "sensor.pv_live",
    "solar_power_fallback": "sensor.pv_meter",
    "grid_power": "sensor.grid_live",
    "grid_power_fallback": "sensor.grid_meter",
    "solar_energy": "sensor.pv_lifetime",
    "import_energy": "sensor.grid_in_lifetime",
    "export_energy": "sensor.grid_out_lifetime",
    "gateway_uptime": "sensor.gateway_uptime",
    "gateway_diagnostics": ["sensor.gateway_cpu", "sensor.gateway_memory"],
    "cars": [
        {
            "name": "Blue Thunder",
            "device": "a1b2c3d4e5f6",
            "image": IMAGE,
            "charging": "binary_sensor.blue_thunder_charging",
            "presence": "device_tracker.blue_thunder",
            "power": "sensor.blue_thunder_charger_power",
        }
    ],
    "panels": [
        {
            "label": "Upper",
            "facing": 180,
            "panels": [
                {"power": "sensor.inverter_a1_power", "lifetime": "sensor.inverter_a1_energy"},
                {"power": "sensor.inverter_a2_power", "name": "Left corner"},
            ],
        }
    ],
    "pvs_serial": "XX0000000000000",
    "some_future_key": "sensor.something_new",
}

PRIVATE = (
    "sensor.",
    "binary_sensor.",
    "device_tracker.",
    "Blue Thunder",
    "blue_thunder",
    "a1b2c3d4e5f6",
    "0a1b2c3d4e5f",
    "/api/image/serve",
    "2024-05-01",
    "XX0000000000000",
    "Left corner",
)


def _seed(hass: HomeAssistant) -> None:
    for entity_id, value in (("sensor.pv_live", 3.2), ("sensor.grid_live", -1.1)):
        hass.states.async_set(entity_id, str(value), {ATTR_UNIT_OF_MEASUREMENT: "kW"})
    for entity_id, value in (
        ("sensor.pv_lifetime", 1000.0),
        ("sensor.grid_in_lifetime", 500.0),
        ("sensor.grid_out_lifetime", 200.0),
    ):
        hass.states.async_set(entity_id, str(value), {ATTR_UNIT_OF_MEASUREMENT: "kWh"})
    hass.states.async_set("sensor.pv_meter", "unavailable")


async def _setup(hass: HomeAssistant, options: dict[str, Any] | None = None) -> MockConfigEntry:
    _seed(hass)
    entry = MockConfigEntry(domain=DOMAIN, data=CONFIG, options=options or {}, title="DayMill")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_diagnostics_redacts_private_data(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    # some energy so the ledger has numbers
    hass.states.async_set(
        "sensor.grid_in_lifetime", "503.3333333", {ATTR_UNIT_OF_MEASUREMENT: "kWh"}
    )
    hass.states.async_set(
        "sensor.grid_out_lifetime", "201.1111111", {ATTR_UNIT_OF_MEASUREMENT: "kWh"}
    )
    await hass.async_block_till_done()

    diag = await async_get_config_entry_diagnostics(hass, entry)
    dumped = json.dumps(diag)
    for needle in PRIVATE:
        assert needle not in dumped, needle

    data = diag["entry"]["data"]
    assert data["solar_power"] == REDACTED
    assert data["gateway_diagnostics"] == REDACTED
    assert data["pto_date"] == REDACTED
    assert data["pvs_serial"] == REDACTED
    assert data["some_future_key"] == REDACTED
    car = data["cars"][0]
    assert car["name"] == REDACTED
    assert car["image"] == REDACTED
    assert car["device"] == REDACTED
    face = data["panels"][0]
    assert face["label"] == "Upper"
    assert face["facing"] == 180
    assert all(v == REDACTED for p in face["panels"] for v in p.values())
    # settings that help with bugs stay
    assert data["tariff"] == "sce_tou_d_prime"
    assert data["nem"] == "nem3"
    assert data["cycle_day"] == 1


async def test_diagnostics_content(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    hass.states.async_set(
        "sensor.grid_in_lifetime", "503.3333333", {ATTR_UNIT_OF_MEASUREMENT: "kWh"}
    )
    await hass.async_block_till_done()

    diag = await async_get_config_entry_diagnostics(hass, entry)
    assert diag["loaded"] is True
    assert diag["versions"]["integration"] == VERSION
    assert diag["versions"]["home_assistant"]
    assert diag["tariff"]["id"] == "sce_tou_d_prime"
    assert diag["tariff"]["nem"] == "nem3"
    assert diag["tariff"]["effective_date"]
    assert diag["layout"] == {
        "cars": 1,
        "car_names_set": 1,
        "roof_faces": 1,
        "panels_per_face": [2],
    }
    assert diag["sources"]["solar_power"]["status"] == "ok"
    assert diag["sources"]["solar_power"]["unit"] == "kW"
    fallback = diag["sources"]["solar_power_fallback"]
    # age depends on how fast the test box is
    assert fallback.pop("age_s") <= 5
    assert fallback == {"status": "unavailable", "unit": None, "device_class": None}
    assert diag["sources"]["gateway_uptime"] == {"status": "missing"}

    ledger = diag["ledger"]
    assert ledger["mode"] == "nem3"
    assert set(ledger["totals"]) >= {"import_energy_charge", "export_credit", "net_cost"}
    for value in [*ledger["totals"].values(), *ledger["bill"].values(), ledger["bill_estimate"]]:
        assert value == round(value, 2)
    assert ledger["bill"]["import_kwh"] == pytest.approx(3.33)
    assert diag["snapshot"]["solar"] == {"kw": 3.2, "source": "live"}


async def test_diagnostics_options_win_and_are_redacted(hass: HomeAssistant) -> None:
    options = {**CONFIG, "nem": "nem2", "image_day": IMAGE}
    entry = await _setup(hass, options)
    diag = await async_get_config_entry_diagnostics(hass, entry)
    assert diag["tariff"]["nem"] == "nem2"
    assert diag["entry"]["options"]["image_day"] == REDACTED
    assert "/api/image/serve" not in json.dumps(diag)


async def test_diagnostics_when_not_loaded(hass: HomeAssistant) -> None:
    entry = MockConfigEntry(domain=DOMAIN, data=CONFIG)
    entry.add_to_hass(hass)
    diag = await async_get_config_entry_diagnostics(hass, entry)
    assert diag["loaded"] is False
    assert "ledger" not in diag
    assert "sensor." not in json.dumps(diag)


def test_scrub_catches_values_under_any_key() -> None:
    out = scrub(
        {
            "a": "sensor.anything",
            "b": ["switch.x", "plain text", 3],
            "c": {"url": f"https://example.invalid{IMAGE}"},
            "Inverter_Serial": "ABC",
            "version": "0.1.0",
            "rate": "sce_tou_d_prime",
        }
    )
    assert out == {
        "a": REDACTED,
        "b": [REDACTED, "plain text", 3],
        "c": {"url": REDACTED},
        "Inverter_Serial": REDACTED,
        "version": "0.1.0",
        "rate": "sce_tou_d_prime",
    }
