"""DayMill: solar, grid and time-of-use billing for Home Assistant."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.storage import Store

from .const import DOMAIN, MONEY_KEYS, PLATFORMS, STORAGE_VERSION
from .coordinator import DayMillConfigEntry, DayMillCoordinator
from .frontend import async_remove_frontend, async_setup_frontend
from .repairs import async_setup_repairs
from .tariff import TariffError


async def async_setup_entry(hass: HomeAssistant, entry: DayMillConfigEntry) -> bool:
    coordinator = DayMillCoordinator(hass, entry)
    try:
        await coordinator.async_setup()
    except TariffError as err:
        raise ConfigEntryError(
            translation_domain=DOMAIN,
            translation_key="tariff_load_failed",
            translation_placeholders={"error": str(err)},
        ) from err
    coordinator.async_start()
    entry.runtime_data = coordinator
    _remove_stale_entities(hass, coordinator)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    await async_setup_frontend(hass, entry)
    async_setup_repairs(hass, entry)
    # First totals read in the background; the 5 minute timer takes over after.
    entry.async_create_background_task(hass, coordinator.async_refresh_totals(), "daymill_totals")
    return True


_CAR_SUFFIXES = ("_home_charging_power", "_charging_at_home")


def _remove_stale_entities(hass: HomeAssistant, coordinator: DayMillCoordinator) -> None:
    """Drop entities of cars that were renamed or removed, and money sensors
    once cost tracking is off, so they don't linger as unavailable."""
    entry_id = coordinator.config_entry.entry_id
    cars = {car.slug for car in coordinator.cars}
    money = set() if coordinator.track_cost else set(MONEY_KEYS)
    registry = er.async_get(hass)
    for entity in er.async_entries_for_config_entry(registry, entry_id):
        key = entity.unique_id.removeprefix(f"{entry_id}_")
        stale = key in money
        if key.startswith("car_"):
            for suffix in _CAR_SUFFIXES:
                if key.endswith(suffix):
                    stale = key[4 : -len(suffix)] not in cars
        if stale:
            registry.async_remove(entity.entity_id)


async def async_unload_entry(hass: HomeAssistant, entry: DayMillConfigEntry) -> bool:
    # the coordinator's own unload hook saves the ledger
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Delete the stored ledger and the dashboard resource along with the entry."""
    await async_remove_frontend(hass, entry)
    await Store(hass, STORAGE_VERSION, f"{DOMAIN}.{entry.entry_id}").async_remove()
