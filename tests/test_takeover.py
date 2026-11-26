"""After SunFlow is deleted: taking over its entity ids, and the old folder."""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import issue_registry as ir
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.daymill import move
from custom_components.daymill.const import CONF_OLD_ENTITIES, DOMAIN, OLD_DOMAIN

from .test_import import add_sunflow
from .test_init import BASE_CONFIG, seed_sources


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(recorder_mock, enable_custom_integrations):
    """Recorder first: the integration depends on it."""
    yield


@pytest.fixture(autouse=True)
def no_folder():
    with patch.object(move, "_folder_present", return_value=False) as mock:
        yield mock


async def _imported(hass: HomeAssistant) -> tuple[MockConfigEntry, MockConfigEntry]:
    """A SunFlow entry (not running) and a DayMill entry imported from it."""
    old = add_sunflow(hass)
    garage = ar.async_get(hass).async_create("Garage")
    er.async_get(hass).async_update_entity("sensor.sunflow_solar_power", area_id=garage.id)
    data, _options = move.import_entry(hass, old)
    data.pop("imported_from")
    entry = MockConfigEntry(domain=DOMAIN, title="DayMill", data=data, unique_id=DOMAIN)
    entry.add_to_hass(hass)
    seed_sources(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return old, entry


def _issue(hass: HomeAssistant, issue_id: str) -> ir.IssueEntry | None:
    return ir.async_get(hass).async_get_issue(DOMAIN, issue_id)


async def _fix(hass: HomeAssistant) -> tuple[Any, dict[str, Any]]:
    assert await async_setup_component(hass, "repairs", {})
    manager = hass.data["repairs"]["flow_manager"]
    result = await manager.async_init(DOMAIN, context={"issue_id": move.ISSUE_TAKE_OVER})
    return manager, result


async def test_no_issues_while_sunflow_is_there(hass: HomeAssistant, no_folder) -> None:
    no_folder.return_value = True
    await _imported(hass)
    assert hass.states.get("sensor.daymill_solar_power") is not None
    assert _issue(hass, move.ISSUE_TAKE_OVER) is None
    assert _issue(hass, move.ISSUE_FOLDER) is None


async def test_issues_after_sunflow_is_deleted(hass: HomeAssistant, no_folder) -> None:
    old, entry = await _imported(hass)
    no_folder.return_value = True
    await hass.config_entries.async_remove(old.entry_id)
    await hass.async_block_till_done()

    issue = _issue(hass, move.ISSUE_TAKE_OVER)
    assert issue is not None
    assert issue.is_fixable
    assert issue.severity is ir.IssueSeverity.WARNING
    assert issue.translation_placeholders == {"count": "2"}
    folder = _issue(hass, move.ISSUE_FOLDER)
    assert folder is not None
    assert not folder.is_fixable

    # the folder issue goes once the folder is gone (checked on the next setup)
    no_folder.return_value = False
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert _issue(hass, move.ISSUE_FOLDER) is None
    assert _issue(hass, move.ISSUE_TAKE_OVER) is not None

    # and both go with the entry
    await hass.config_entries.async_remove(entry.entry_id)
    assert _issue(hass, move.ISSUE_TAKE_OVER) is None


async def test_no_takeover_issue_without_a_map(hass: HomeAssistant) -> None:
    entry = MockConfigEntry(domain=DOMAIN, data=dict(BASE_CONFIG), unique_id=DOMAIN)
    entry.add_to_hass(hass)
    seed_sources(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert _issue(hass, move.ISSUE_TAKE_OVER) is None


async def test_take_over(hass: HomeAssistant) -> None:
    old, entry = await _imported(hass)
    await hass.config_entries.async_remove(old.entry_id)
    await hass.async_block_till_done()

    manager, result = await _fix(hass)
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "confirm"
    assert result["description_placeholders"] == {"count": "2"}
    result = await manager.async_configure(result["flow_id"], {})
    await hass.async_block_till_done()
    assert result["type"] is FlowResultType.CREATE_ENTRY

    registry = er.async_get(hass)
    solar = registry.async_get("sensor.sunflow_solar_power")
    assert solar is not None
    assert solar.platform == DOMAIN
    assert solar.unique_id == f"{entry.entry_id}_solar_power"
    assert solar.name == "Roof"
    assert solar.icon == "mdi:sun"
    assert solar.labels == {"energy"}
    assert solar.area_id == ar.async_get(hass).async_get_area_by_name("Garage").id
    assert hass.states.get("sensor.sunflow_solar_power") is not None
    assert hass.states.get("sensor.daymill_solar_power") is None
    # no car in DayMill's config, so there was nothing to give that id to
    assert registry.async_get("binary_sensor.sunflow_car_truck_charging_at_home") is None

    assert CONF_OLD_ENTITIES not in entry.data
    assert _issue(hass, move.ISSUE_TAKE_OVER) is None
    # cleared for good, a reload doesn't bring it back
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert _issue(hass, move.ISSUE_TAKE_OVER) is None


async def test_take_over_skips_taken_ids(hass: HomeAssistant) -> None:
    old, entry = await _imported(hass)
    await hass.config_entries.async_remove(old.entry_id)
    await hass.async_block_till_done()
    hass.states.async_set("sensor.sunflow_solar_power", "1")  # say a template took it

    manager, result = await _fix(hass)
    result = await manager.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "skipped"
    assert result["description_placeholders"] == {"skipped": "- `sensor.sunflow_solar_power`"}
    result = await manager.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY

    assert er.async_get(hass).async_get("sensor.daymill_solar_power").platform == DOMAIN
    assert CONF_OLD_ENTITIES not in entry.data


async def test_take_over_waits_for_sunflow(hass: HomeAssistant) -> None:
    old, entry = await _imported(hass)
    await hass.config_entries.async_remove(old.entry_id)
    await hass.async_block_till_done()
    manager, result = await _fix(hass)
    # SunFlow came back before the user confirmed
    MockConfigEntry(domain=OLD_DOMAIN, data={}).add_to_hass(hass)
    result = await manager.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "sunflow_still_there"
    assert entry.data[CONF_OLD_ENTITIES]
    assert er.async_get(hass).async_get("sensor.daymill_solar_power") is not None
