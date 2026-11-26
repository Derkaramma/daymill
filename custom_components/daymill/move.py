"""Moving over from SunFlow, DayMill's old name.

1. The config flow offers to import a SunFlow entry: its settings as they
   are, a note of the old entity ids (with their names, icons, areas and
   labels), and a copy of the SunFlow dashboard. The old entry is never
   touched.
2. On the first setup after that, the stored ledger (billing cycle, lifetime
   counters) is copied from SunFlow's Store.
3. Once SunFlow is deleted, a repair offers to give the DayMill entities
   the old entity ids back, so automations and the Energy dashboard keep
   working. It only runs when the user says so.
4. Another repair asks to delete the old custom_components/sunflow_solar
   folder, since HACS leaves it behind.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import voluptuous as vol
from homeassistant.components.repairs import RepairsFlow
from homeassistant.config_entries import (
    SIGNAL_CONFIG_ENTRY_CHANGED,
    ConfigEntry,
    ConfigEntryChange,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.storage import Store

from .const import CONF_IMPORTED_FROM, CONF_OLD_ENTITIES, DOMAIN, OLD_DOMAIN, STORAGE_VERSION
from .frontend import LOVELACE, async_create_dashboard

_LOGGER = logging.getLogger(__name__)

ISSUE_TAKE_OVER = "take_over_sunflow_ids"
ISSUE_FOLDER = "remove_sunflow_folder"
OLD_DASHBOARD = "sunflow"
OLD_FOLDER = ("custom_components", OLD_DOMAIN)

# Entity settings a user may have changed on the old entities.
_KEPT = ("name", "icon", "area_id", "labels", "hidden_by", "disabled_by")


def old_entries(hass: HomeAssistant) -> list[ConfigEntry]:
    return hass.config_entries.async_entries(OLD_DOMAIN)


# ---- import ----


def old_entities(hass: HomeAssistant, old: ConfigEntry) -> dict[str, dict[str, Any]]:
    """{key: {"entity_id", "name", "icon", ...}} for each entity of the old entry."""
    registry = er.async_get(hass)
    out: dict[str, dict[str, Any]] = {}
    for entity in er.async_entries_for_config_entry(registry, old.entry_id):
        key = entity.unique_id.removeprefix(f"{old.entry_id}_")
        if key == entity.unique_id:
            continue
        item: dict[str, Any] = {"entity_id": entity.entity_id}
        for field in _KEPT:
            value = getattr(entity, field)
            if field == "labels":
                value = sorted(value)
            elif value is not None:
                value = str(value)
            item[field] = value
        out[key] = item
    return out


def import_entry(hass: HomeAssistant, old: ConfigEntry) -> tuple[dict[str, Any], dict[str, Any]]:
    """(data, options) for a DayMill entry made from the old one.

    The config keys never had the old name in them, so they copy over as is.
    """
    data = {
        **old.data,
        CONF_IMPORTED_FROM: old.entry_id,
        CONF_OLD_ENTITIES: old_entities(hass, old),
    }
    return data, dict(old.options)


async def async_copy_store(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Copy the old ledger once, right after an import, before anything loads it."""
    old_id = entry.data.get(CONF_IMPORTED_FROM)
    if not old_id:
        return
    new = Store[dict[str, Any]](hass, STORAGE_VERSION, f"{DOMAIN}.{entry.entry_id}")
    if await new.async_load() is None:
        old = await Store[dict[str, Any]](
            hass, STORAGE_VERSION, f"{OLD_DOMAIN}.{old_id}"
        ).async_load()
        if old:
            await new.async_save(old)
            _LOGGER.info("Copied the billing ledger over from SunFlow")
    data = {k: v for k, v in entry.data.items() if k != CONF_IMPORTED_FROM}
    hass.config_entries.async_update_entry(entry, data=data)


def rename_cards(config: Any) -> Any:
    """The dashboard config with every custom:sunflow type made custom:daymill."""
    if isinstance(config, list):
        return [rename_cards(v) for v in config]
    if not isinstance(config, dict):
        return config
    out = {}
    for key, value in config.items():
        if (
            key == "type"
            and isinstance(value, str)
            and (value == "custom:sunflow" or value.startswith("custom:sunflow-"))
        ):
            value = "custom:daymill" + value.removeprefix("custom:sunflow")
        out[key] = rename_cards(value)
    return out


async def async_old_dashboard(hass: HomeAssistant) -> dict[str, Any] | None:
    """The SunFlow dashboard's config, or None if there isn't one."""
    dashboards = getattr(hass.data.get(LOVELACE), "dashboards", None) or {}
    dashboard = dashboards.get(OLD_DASHBOARD)
    if dashboard is None:
        return None
    try:
        config = await dashboard.async_load(False)
    except Exception:  # noqa: BLE001 - missing or broken, either way there's nothing to copy
        return None
    return config if isinstance(config, dict) else None


async def async_copy_dashboard(hass: HomeAssistant) -> bool:
    """Make the DayMill dashboard from the SunFlow one (with its house picture
    and layout), or a fresh one if there's nothing to copy.

    Returns False when a DayMill dashboard already exists. The SunFlow
    dashboard is left alone.
    """
    old = await async_old_dashboard(hass)
    return await async_create_dashboard(hass, config=rename_cards(old) if old else None)


# ---- issues ----


def _folder_present(hass: HomeAssistant) -> bool:
    return Path(hass.config.path(*OLD_FOLDER)).is_dir()


async def async_check_issues(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Raise or clear the two move repairs. Neither shows while SunFlow is still set up."""
    sunflow_gone = not old_entries(hass)
    mapping = entry.data.get(CONF_OLD_ENTITIES) or {}

    if sunflow_gone and mapping:
        ir.async_create_issue(
            hass,
            DOMAIN,
            ISSUE_TAKE_OVER,
            is_fixable=True,
            is_persistent=False,
            severity=ir.IssueSeverity.WARNING,
            translation_key=ISSUE_TAKE_OVER,
            translation_placeholders={"count": str(len(mapping))},
            data={"entry_id": entry.entry_id},
        )
    else:
        ir.async_delete_issue(hass, DOMAIN, ISSUE_TAKE_OVER)

    if sunflow_gone and await hass.async_add_executor_job(_folder_present, hass):
        ir.async_create_issue(
            hass,
            DOMAIN,
            ISSUE_FOLDER,
            is_fixable=False,
            is_persistent=False,
            severity=ir.IssueSeverity.WARNING,
            translation_key=ISSUE_FOLDER,
            translation_placeholders={"folder": "/".join(OLD_FOLDER)},
        )
    else:
        ir.async_delete_issue(hass, DOMAIN, ISSUE_FOLDER)


async def async_setup_move(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Check now, and again whenever a SunFlow entry is added or deleted."""
    await async_check_issues(hass, entry)

    @callback
    def _changed(change: ConfigEntryChange, changed: ConfigEntry) -> None:
        if changed.domain != OLD_DOMAIN or change is ConfigEntryChange.UPDATED:
            return
        entry.async_create_background_task(
            hass, async_check_issues(hass, entry), f"{DOMAIN}_move_issues"
        )

    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_CONFIG_ENTRY_CHANGED, _changed))
    entry.async_on_unload(lambda: async_delete_issues(hass))


@callback
def async_delete_issues(hass: HomeAssistant) -> None:
    for issue in (ISSUE_TAKE_OVER, ISSUE_FOLDER):
        ir.async_delete_issue(hass, DOMAIN, issue)


# ---- taking over the old entity ids ----


def _free(hass: HomeAssistant, registry: er.EntityRegistry, entity_id: str) -> bool:
    return not registry.async_is_registered(entity_id) and hass.states.get(entity_id) is None


@callback
def async_take_over(hass: HomeAssistant, entry: ConfigEntry) -> tuple[list[str], list[str]]:
    """Give each DayMill entity its old SunFlow entity id and settings.

    Returns (moved, skipped) old entity ids. An id is skipped when something
    else holds it now. The saved map is cleared either way, so this runs once.
    """
    registry = er.async_get(hass)
    mapping: dict[str, dict[str, Any]] = entry.data.get(CONF_OLD_ENTITIES) or {}
    moved: list[str] = []
    skipped: list[str] = []
    for key, old in sorted(mapping.items()):
        old_id = old.get("entity_id")
        if not isinstance(old_id, str) or "." not in old_id:
            continue
        platform = old_id.split(".", 1)[0]
        current = registry.async_get_entity_id(platform, DOMAIN, f"{entry.entry_id}_{key}")
        if current is None:
            # that entity doesn't exist in DayMill (cost tracking off, a car removed)
            continue
        if current == old_id:
            moved.append(old_id)
            continue
        if not _free(hass, registry, old_id):
            skipped.append(old_id)
            continue
        changes: dict[str, Any] = {"new_entity_id": old_id}
        for field in ("name", "icon", "area_id"):
            if old.get(field) is not None:
                changes[field] = old[field]
        if old.get("labels"):
            changes["labels"] = set(old["labels"])
        if old.get("hidden_by") == er.RegistryEntryHider.USER:
            changes["hidden_by"] = er.RegistryEntryHider.USER
        try:
            registry.async_update_entity(current, **changes)
        except ValueError as err:
            _LOGGER.warning("Could not give %s the id %s: %s", current, old_id, err)
            skipped.append(old_id)
            continue
        moved.append(old_id)
    data = {k: v for k, v in entry.data.items() if k != CONF_OLD_ENTITIES}
    hass.config_entries.async_update_entry(entry, data=data)
    return moved, skipped


class TakeOverFlow(RepairsFlow):
    """Confirm, take the ids over, then say which ones were taken already."""

    def __init__(self, entry_id: str) -> None:
        self._entry_id = entry_id
        self._skipped: list[str] = []

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        return await self.async_step_confirm()

    async def async_step_confirm(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        entry = self.hass.config_entries.async_get_entry(self._entry_id)
        if entry is None or not entry.data.get(CONF_OLD_ENTITIES):
            return self.async_abort(reason="nothing_to_do")
        if old_entries(self.hass):
            return self.async_abort(reason="sunflow_still_there")
        if user_input is None:
            return self.async_show_form(
                step_id="confirm",
                data_schema=vol.Schema({}),
                description_placeholders={"count": str(len(entry.data[CONF_OLD_ENTITIES]))},
            )
        moved, self._skipped = async_take_over(self.hass, entry)
        _LOGGER.info("Took over %d SunFlow entity ids, skipped %d", len(moved), len(self._skipped))
        if not self._skipped:
            return self.async_create_entry(data={})
        return await self.async_step_skipped()

    async def async_step_skipped(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        if user_input is not None:
            return self.async_create_entry(data={})
        return self.async_show_form(
            step_id="skipped",
            data_schema=vol.Schema({}),
            description_placeholders={"skipped": "\n".join(f"- `{i}`" for i in self._skipped)},
        )
