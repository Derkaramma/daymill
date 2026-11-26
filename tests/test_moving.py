"""The SunFlow is now DayMill notice."""

from __future__ import annotations

from unittest.mock import patch

from homeassistant.components import persistent_notification
from homeassistant.config_entries import SOURCE_INTEGRATION_DISCOVERY
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir
from homeassistant.loader import IntegrationNotFound
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.sunflow_solar.const import DOMAIN
from custom_components.sunflow_solar.moving import (
    ISSUE_MOVED,
    LEARN_MORE_URL,
    NEW_DOMAIN,
    NOTIFICATION_ID,
)

from .test_init import auto_enable_custom_integrations, setup_entry  # noqa: F401


def notifications(hass: HomeAssistant) -> dict:
    return persistent_notification._async_get_or_create_notifications(hass)


async def test_issue_raised_on_setup(hass: HomeAssistant) -> None:
    await setup_entry(hass)
    issue = ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_MOVED)
    assert issue is not None
    assert issue.severity is ir.IssueSeverity.WARNING
    assert issue.learn_more_url == LEARN_MORE_URL
    assert issue.translation_key == ISSUE_MOVED
    assert not issue.is_fixable
    assert not issue.is_persistent


async def test_notification_shown_once(hass: HomeAssistant, hass_storage) -> None:
    entry = await setup_entry(hass)
    note = notifications(hass)[NOTIFICATION_ID]
    assert note["title"] == "SunFlow is now DayMill"
    assert "Import settings from SunFlow" in note["message"]
    assert hass_storage[f"{DOMAIN}.{entry.entry_id}"]["data"]["moved_notice_shown"] is True

    persistent_notification.async_dismiss(hass, NOTIFICATION_ID)
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert NOTIFICATION_ID not in notifications(hass)
    # the repair comes back every time though
    assert ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_MOVED) is not None


async def test_remove_drops_issue_keeps_store(hass: HomeAssistant, hass_storage) -> None:
    entry = await setup_entry(hass)
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    key = f"{DOMAIN}.{entry.entry_id}"
    assert key in hass_storage

    await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    assert ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_MOVED) is None
    # DayMill imports the ledger later, so it has to survive the removal
    assert key in hass_storage
    assert hass_storage[key]["data"]["ledger"]


MOVING = "custom_components.sunflow_solar.moving"


async def test_no_daymill_installed_no_flow(hass: HomeAssistant) -> None:
    with (
        patch(f"{MOVING}.async_get_integration", side_effect=IntegrationNotFound(NEW_DOMAIN)),
        patch(f"{MOVING}.discovery_flow.async_create_flow") as create,
    ):
        await setup_entry(hass)
    create.assert_not_called()


async def test_daymill_installed_starts_its_flow(hass: HomeAssistant) -> None:
    with (
        patch(f"{MOVING}.async_get_integration") as get,
        patch(f"{MOVING}.discovery_flow.async_create_flow") as create,
    ):
        await setup_entry(hass)
    get.assert_awaited_once_with(hass, NEW_DOMAIN)
    create.assert_called_once()
    assert create.call_args.args[1] == NEW_DOMAIN
    assert create.call_args.kwargs["context"] == {"source": SOURCE_INTEGRATION_DISCOVERY}


async def test_daymill_already_added_no_flow(hass: HomeAssistant) -> None:
    MockConfigEntry(domain=NEW_DOMAIN, data={}).add_to_hass(hass)
    with (
        patch(f"{MOVING}.async_get_integration") as get,
        patch(f"{MOVING}.discovery_flow.async_create_flow") as create,
    ):
        await setup_entry(hass)
    get.assert_not_called()
    create.assert_not_called()
