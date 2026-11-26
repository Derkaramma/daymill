"""Importing an existing SunFlow entry: the flow, the ledger and the dashboard."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import entity_registry as er
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.daymill import frontend, move
from custom_components.daymill.const import (
    CONF_IMPORTED_FROM,
    CONF_OLD_ENTITIES,
    DOMAIN,
    MOVE_KEYS,
    OLD_DOMAIN,
)

from .test_init import BASE_CONFIG, setup_entry


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(recorder_mock, enable_custom_integrations):
    """Recorder first: the integration depends on it."""
    yield


def add_sunflow(hass: HomeAssistant, options: dict[str, Any] | None = None) -> MockConfigEntry:
    """A SunFlow entry with two entities, one of them customized."""
    old = MockConfigEntry(
        domain=OLD_DOMAIN,
        title="SunFlow Solar",
        data=dict(BASE_CONFIG),
        options=options or {},
        unique_id=OLD_DOMAIN,
    )
    old.add_to_hass(hass)
    registry = er.async_get(hass)
    solar = registry.async_get_or_create(
        "sensor",
        OLD_DOMAIN,
        f"{old.entry_id}_solar_power",
        suggested_object_id="sunflow_solar_power",
        config_entry=old,
    )
    registry.async_update_entity(
        solar.entity_id, name="Roof", icon="mdi:sun", labels={"energy"}, hidden_by=None
    )
    registry.async_get_or_create(
        "binary_sensor",
        OLD_DOMAIN,
        f"{old.entry_id}_car_truck_charging_at_home",
        suggested_object_id="sunflow_car_truck_charging_at_home",
        config_entry=old,
    )
    return old


# ---- the flow ----


@pytest.fixture
def no_setup():
    with patch("custom_components.daymill.async_setup_entry", return_value=True) as mock:
        yield mock


async def test_menu_only_with_sunflow(hass: HomeAssistant, no_setup) -> None:
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    assert result["step_id"] == "no_solar"
    hass.config_entries.flow.async_abort(result["flow_id"])

    add_sunflow(hass)
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    assert result["type"] is FlowResultType.MENU
    assert result["step_id"] == "move"
    assert result["menu_options"] == ["import_sunflow", "fresh"]

    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"next_step_id": "fresh"}
    )
    assert result["step_id"] == "no_solar"  # the normal setup, nothing found here


async def test_import(hass: HomeAssistant, no_setup) -> None:
    old = add_sunflow(hass, options={**BASE_CONFIG, "cycle_day": 12})
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"next_step_id": "import_sunflow"}
    )
    assert result["type"] is FlowResultType.FORM
    assert result["description_placeholders"] == {"title": "SunFlow Solar"}

    with patch(
        "custom_components.daymill.config_flow.async_copy_dashboard",
        AsyncMock(return_value=True),
    ) as copy:
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], {"create_dashboard": True}
        )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "DayMill"
    copy.assert_awaited_once()

    entry = result["result"]
    assert entry.unique_id == DOMAIN
    assert entry.options == {**BASE_CONFIG, "cycle_day": 12}
    assert entry.data[CONF_IMPORTED_FROM] == old.entry_id
    assert {k: v for k, v in entry.data.items() if k not in MOVE_KEYS} == BASE_CONFIG
    assert entry.data[CONF_OLD_ENTITIES] == {
        "solar_power": {
            "entity_id": "sensor.sunflow_solar_power",
            "name": "Roof",
            "icon": "mdi:sun",
            "area_id": None,
            "labels": ["energy"],
            "hidden_by": None,
            "disabled_by": None,
        },
        "car_truck_charging_at_home": {
            "entity_id": "binary_sensor.sunflow_car_truck_charging_at_home",
            "name": None,
            "icon": None,
            "area_id": None,
            "labels": [],
            "hidden_by": None,
            "disabled_by": None,
        },
    }
    # SunFlow itself is left alone
    assert hass.config_entries.async_get_entry(old.entry_id) is old


async def test_import_without_dashboard(hass: HomeAssistant, no_setup) -> None:
    add_sunflow(hass)
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"next_step_id": "import_sunflow"}
    )
    with patch("custom_components.daymill.config_flow.async_copy_dashboard", AsyncMock()) as copy:
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], {"create_dashboard": False}
        )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    copy.assert_not_awaited()


async def test_import_after_sunflow_is_gone(hass: HomeAssistant, no_setup) -> None:
    old = add_sunflow(hass)
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    await hass.config_entries.async_remove(old.entry_id)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"next_step_id": "import_sunflow"}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "no_sunflow"


async def test_discovery(hass: HomeAssistant, no_setup) -> None:
    add_sunflow(hass)
    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()
    flows = hass.config_entries.flow.async_progress_by_handler(DOMAIN)
    assert len(flows) == 1
    assert flows[0]["context"]["source"] == config_entries.SOURCE_INTEGRATION_DISCOVERY
    assert flows[0]["step_id"] == "move"


async def test_no_discovery_without_sunflow(hass: HomeAssistant, no_setup) -> None:
    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()
    assert not hass.config_entries.flow.async_progress_by_handler(DOMAIN)


async def test_no_discovery_once_set_up(hass: HomeAssistant, no_setup) -> None:
    add_sunflow(hass)
    MockConfigEntry(domain=DOMAIN, data=dict(BASE_CONFIG), unique_id=DOMAIN).add_to_hass(hass)
    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()
    assert not hass.config_entries.flow.async_progress_by_handler(DOMAIN)


# ---- the ledger ----


async def test_ledger_copied_once(hass: HomeAssistant, hass_storage: dict[str, Any]) -> None:
    # a real ledger, as SunFlow would have saved it
    first = await setup_entry(hass)
    assert await hass.config_entries.async_unload(first.entry_id)
    saved = hass_storage.pop(f"{DOMAIN}.{first.entry_id}")
    await hass.config_entries.async_remove(first.entry_id)
    saved["data"]["energy"] = {k: 1.0 for k in saved["data"]["energy"]}
    hass_storage[f"{OLD_DOMAIN}.old_id"] = {**saved, "key": f"{OLD_DOMAIN}.old_id"}

    entry = MockConfigEntry(
        domain=DOMAIN,
        data={**BASE_CONFIG, CONF_IMPORTED_FROM: "old_id", CONF_OLD_ENTITIES: {"x": {}}},
        unique_id=DOMAIN,
    )
    entry.add_to_hass(hass)
    with patch("custom_components.daymill.coordinator.DayMillCoordinator.async_start"):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    copied = hass_storage[f"{DOMAIN}.{entry.entry_id}"]["data"]
    assert copied["ledger"] == saved["data"]["ledger"]
    assert copied["energy"] == saved["data"]["energy"]
    assert CONF_IMPORTED_FROM not in entry.data
    assert entry.data[CONF_OLD_ENTITIES] == {"x": {}}
    # the notes never reach the config itself
    assert CONF_OLD_ENTITIES not in entry.runtime_data.conf
    # SunFlow's copy is left where it was
    assert f"{OLD_DOMAIN}.old_id" in hass_storage


async def test_ledger_copy_never_overwrites(
    hass: HomeAssistant, hass_storage: dict[str, Any]
) -> None:
    hass_storage[f"{OLD_DOMAIN}.old_id"] = {
        "version": 1,
        "minor_version": 1,
        "key": f"{OLD_DOMAIN}.old_id",
        "data": {"cycle_day": 5},
    }
    entry = MockConfigEntry(domain=DOMAIN, data={CONF_IMPORTED_FROM: "old_id"})
    entry.add_to_hass(hass)
    hass_storage[f"{DOMAIN}.{entry.entry_id}"] = {
        "version": 1,
        "minor_version": 1,
        "key": f"{DOMAIN}.{entry.entry_id}",
        "data": {"cycle_day": 9},
    }
    await move.async_copy_store(hass, entry)
    assert hass_storage[f"{DOMAIN}.{entry.entry_id}"]["data"] == {"cycle_day": 9}
    assert CONF_IMPORTED_FROM not in entry.data


# ---- the dashboard ----


def test_rename_cards() -> None:
    old = {
        "strategy": {"type": "custom:sunflow", "house": {"cars": [{"sunflow": "truck"}]}},
        "views": [
            {
                "cards": [
                    {"type": "custom:sunflow-house-card", "image_day": "/local/sunflow/day.jpg"},
                    {"type": "entities", "entities": ["sensor.sunflow_solar_power"]},
                    {"type": "custom:sunflower-card"},
                ]
            }
        ],
    }
    assert move.rename_cards(old) == {
        "strategy": {"type": "custom:daymill", "house": {"cars": [{"sunflow": "truck"}]}},
        "views": [
            {
                "cards": [
                    {"type": "custom:daymill-house-card", "image_day": "/local/sunflow/day.jpg"},
                    {"type": "entities", "entities": ["sensor.sunflow_solar_power"]},
                    {"type": "custom:sunflower-card"},
                ]
            }
        ],
    }


async def _setup_lovelace(hass: HomeAssistant) -> None:
    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, "lovelace", {})
    await hass.async_block_till_done()


async def test_copy_dashboard(hass: HomeAssistant) -> None:
    await _setup_lovelace(hass)
    old = {"strategy": {"type": "custom:sunflow", "house": {"image_day": "/api/image/x"}}}
    assert await frontend.async_create_dashboard(hass, "sunflow", "SunFlow", config=old)

    assert await move.async_copy_dashboard(hass) is True
    dashboards = hass.data["lovelace"].dashboards
    assert await dashboards["daymill"].async_load(False) == {
        "strategy": {"type": "custom:daymill", "house": {"image_day": "/api/image/x"}}
    }
    assert dashboards["daymill"].config["title"] == "DayMill"
    assert await dashboards["sunflow"].async_load(False) == old
    assert await move.async_copy_dashboard(hass) is False


async def test_copy_dashboard_without_one(hass: HomeAssistant) -> None:
    await _setup_lovelace(hass)
    assert await move.async_copy_dashboard(hass) is True
    assert await hass.data["lovelace"].dashboards["daymill"].async_load(False) == {
        "strategy": {"type": "custom:daymill"}
    }
