"""SunFlow is now DayMill.

This is the last SunFlow release. On every setup it raises a Repairs issue
with the steps to move over, and the first time it runs it also posts a
notification so nobody misses it. The issue goes away when the entry is
deleted.

DayMill can't offer the import on its own: HA doesn't load an integration
that hasn't been added yet. So once the DayMill folder is installed, SunFlow
starts DayMill's discovery flow for it and it shows up in Devices & services.
"""

from __future__ import annotations

from homeassistant.components import persistent_notification
from homeassistant.config_entries import SOURCE_INTEGRATION_DISCOVERY, ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import discovery_flow
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.translation import async_get_translations
from homeassistant.loader import IntegrationNotFound, async_get_integration

from .const import DOMAIN

NEW_DOMAIN = "daymill"
ISSUE_MOVED = "moved_to_daymill"
NOTIFICATION_ID = "sunflow_is_daymill"
LEARN_MORE_URL = "https://github.com/Derkaramma/sunflow-solar#moving-from-sunflow"

# Used when the translation can't be loaded. Keep in sync with strings.json.
TITLE = "SunFlow is now DayMill"
MESSAGE = (
    "SunFlow is now DayMill. Same integration, new name. "
    "Nothing to do until DayMill 0.2.0 is out. Then:\n\n"
    "1. When the DayMill update shows up in HACS, install it and restart.\n"
    "2. Go to Devices & services. DayMill should show up as discovered "
    "(if not, add it yourself). Add it and pick **Import settings from SunFlow**.\n"
    "3. Check your dashboard, then delete SunFlow.\n"
    "4. Open the DayMill repair to take over your old entity IDs."
)


async def async_setup_moving(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Raise the move issue, and post the notification the first time only."""
    ir.async_create_issue(
        hass,
        DOMAIN,
        ISSUE_MOVED,
        is_fixable=False,
        is_persistent=False,
        severity=ir.IssueSeverity.WARNING,
        translation_key=ISSUE_MOVED,
        learn_more_url=LEARN_MORE_URL,
    )
    await _async_offer_daymill(hass)

    coordinator = entry.runtime_data
    if coordinator.moved_notice_shown:
        return
    title, message = await _texts(hass)
    persistent_notification.async_create(
        hass, message, title=title, notification_id=NOTIFICATION_ID
    )
    coordinator.moved_notice_shown = True
    await coordinator.async_save()


async def _async_offer_daymill(hass: HomeAssistant) -> None:
    """Start DayMill's import flow if it's installed but not added yet."""
    if hass.config_entries.async_entries(NEW_DOMAIN):
        return
    try:
        await async_get_integration(hass, NEW_DOMAIN)
    except IntegrationNotFound:
        return
    # DayMill's flow uses a fixed unique id, so a second one never stacks up
    discovery_flow.async_create_flow(
        hass, NEW_DOMAIN, context={"source": SOURCE_INTEGRATION_DISCOVERY}, data={}
    )


async def _texts(hass: HomeAssistant) -> tuple[str, str]:
    """The issue's own title and text in the user's language, English if missing."""
    prefix = f"component.{DOMAIN}.issues.{ISSUE_MOVED}"
    try:
        strings = await async_get_translations(hass, hass.config.language, "issues", {DOMAIN})
    except Exception:  # noqa: BLE001 - the notice should never break setup
        strings = {}
    return (
        strings.get(f"{prefix}.title") or TITLE,
        strings.get(f"{prefix}.description") or MESSAGE,
    )


def remove_moving_issue(hass: HomeAssistant) -> None:
    ir.async_delete_issue(hass, DOMAIN, ISSUE_MOVED)
