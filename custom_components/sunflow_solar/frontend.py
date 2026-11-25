"""Serve the card bundle and keep its Lovelace resource up to date.

- The bundle in ./frontend is served at /sunflow_solar/ once per HA run.
- Storage mode resources: add /sunflow_solar/sunflow-cards.js?v=<version>,
  bump the ?v= on upgrades, never add a second copy, and remove it when the
  integration is deleted.
- YAML mode resources: we can't write them, so log it once and raise a
  repair issue that tells the user what to add.
- async_create_dashboard() makes a "sunflow" dashboard that uses the
  custom:sunflow strategy. Nothing calls it on its own.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_COMPONENT_LOADED
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import issue_registry as ir
from homeassistant.util.hass_dict import HassKey

from .const import DOMAIN, VERSION

_LOGGER = logging.getLogger(__name__)

URL_BASE = f"/{DOMAIN}"
BUNDLE = "sunflow-cards.js"
FRONTEND_DIR = Path(__file__).parent / "frontend"
ISSUE_YAML = "frontend_resource_yaml"

DASHBOARD_URL = "sunflow"
DASHBOARD_TITLE = "SunFlow"
DASHBOARD_ICON = "mdi:solar-power-variant"
STRATEGY = {"type": "custom:sunflow"}

LOVELACE = "lovelace"
MODE_YAML = "yaml"


class _FrontendData:
    """Per HA run state. Static paths can't be removed, so register once."""

    def __init__(self) -> None:
        self.static = False
        self.yaml_logged = False
        self.lock = asyncio.Lock()


DATA: HassKey[_FrontendData] = HassKey(f"{DOMAIN}_frontend")


def resource_url() -> str:
    return f"{URL_BASE}/{BUNDLE}?v={VERSION}"


def _is_ours(url: Any) -> bool:
    if not isinstance(url, str):
        return False
    try:
        return urlsplit(url).path == f"{URL_BASE}/{BUNDLE}"
    except ValueError:
        return False


def _data(hass: HomeAssistant) -> _FrontendData:
    if (data := hass.data.get(DATA)) is None:
        data = hass.data[DATA] = _FrontendData()
    return data


def _lovelace(hass: HomeAssistant) -> tuple[str | None, Any]:
    """(resource mode, resource collection) or (None, None) before lovelace loads."""
    ll = hass.data.get(LOVELACE)
    if ll is None:
        return None, None
    if isinstance(ll, dict):  # older cores kept a plain dict
        return ll.get("resource_mode", ll.get("mode")), ll.get("resources")
    return getattr(ll, "resource_mode", None), getattr(ll, "resources", None)


# ---- setup / removal ----


async def async_setup_frontend(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Serve the bundle and register the resource, now or once lovelace loads."""
    await _async_register_static(hass)
    if LOVELACE in hass.config.components:
        await async_register_resource(hass)
        return

    unsub: Any = None

    @callback
    def _loaded(event: Event) -> None:
        nonlocal unsub
        if event.data.get("component") != LOVELACE or unsub is None:
            return
        unsub()
        unsub = None
        entry.async_create_background_task(
            hass, async_register_resource(hass), f"{DOMAIN}_resource"
        )

    unsub = hass.bus.async_listen(EVENT_COMPONENT_LOADED, _loaded)

    @callback
    def _cancel() -> None:
        nonlocal unsub
        if unsub is not None:
            unsub()
            unsub = None

    entry.async_on_unload(_cancel)


async def async_remove_frontend(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Drop the resource and the repair issue when the last entry is deleted."""
    others = [e for e in hass.config_entries.async_entries(DOMAIN) if e.entry_id != entry.entry_id]
    if others:
        return
    ir.async_delete_issue(hass, DOMAIN, ISSUE_YAML)
    mode, resources = _lovelace(hass)
    if resources is None or mode == MODE_YAML or not hasattr(resources, "async_delete_item"):
        return
    async with _data(hass).lock:
        await _async_ensure_loaded(resources)
        for item in [i for i in resources.async_items() if _is_ours(i.get("url"))]:
            await resources.async_delete_item(item["id"])


async def _async_register_static(hass: HomeAssistant) -> None:
    data = _data(hass)
    if data.static:
        return
    if hass.http is None:
        _LOGGER.debug("HTTP is not set up; not serving the cards")
        return
    if not await hass.async_add_executor_job((FRONTEND_DIR / BUNDLE).is_file):
        _LOGGER.warning("Card bundle missing at %s; build it with `npm run build`", FRONTEND_DIR)
    await hass.http.async_register_static_paths(
        [StaticPathConfig(URL_BASE, str(FRONTEND_DIR), cache_headers=True)]
    )
    data.static = True


async def _async_ensure_loaded(resources: Any) -> None:
    # Storage resources load lazily; async_get_info() loads them.
    if not getattr(resources, "loaded", True):
        await resources.async_get_info()


# ---- resource ----


async def async_register_resource(hass: HomeAssistant) -> str | None:
    """Make sure the dashboard loads our bundle.

    Returns what happened: "created", "updated", "present", "yaml" (the user
    has to add it), or None when lovelace isn't there.
    """
    mode, resources = _lovelace(hass)
    if resources is None:
        return None
    url = resource_url()
    data = _data(hass)

    if mode == MODE_YAML or not hasattr(resources, "async_create_item"):
        if any(_is_ours(i.get("url")) for i in resources.async_items() or []):
            ir.async_delete_issue(hass, DOMAIN, ISSUE_YAML)
            return "present"
        if not data.yaml_logged:
            _LOGGER.info(
                "Dashboard resources are in YAML mode. Add this to your lovelace resources "
                "to use the SunFlow cards: url: %s, type: module",
                url,
            )
            data.yaml_logged = True
        ir.async_create_issue(
            hass,
            DOMAIN,
            ISSUE_YAML,
            is_fixable=False,
            is_persistent=False,
            severity=ir.IssueSeverity.WARNING,
            translation_key=ISSUE_YAML,
            translation_placeholders={"url": url},
        )
        return "yaml"

    async with data.lock:
        await _async_ensure_loaded(resources)
        ours = [i for i in resources.async_items() if _is_ours(i.get("url"))]
        if not ours:
            await resources.async_create_item({"res_type": "module", "url": url})
            _LOGGER.debug("Added dashboard resource %s", url)
            return "created"
        first, *extra = ours
        for item in extra:
            await resources.async_delete_item(item["id"])
        if first.get("url") != url or first.get("type") != "module":
            await resources.async_update_item(first["id"], {"res_type": "module", "url": url})
            _LOGGER.debug("Updated dashboard resource to %s", url)
            return "updated"
        return "updated" if extra else "present"


# ---- dashboard ----


def _dashboards_collection(hass: HomeAssistant) -> Any:
    """The lovelace dashboards collection, found through its websocket command."""
    handlers = hass.data.get("websocket_api") or {}
    handler = (handlers.get("lovelace/dashboards/list") or (None,))[0]
    while handler is not None and not hasattr(handler, "__self__"):
        handler = getattr(handler, "__wrapped__", None)
    coll = getattr(getattr(handler, "__self__", None), "storage_collection", None)
    if coll is None or not hasattr(coll, "async_create_item"):
        raise HomeAssistantError("Dashboards are not available")
    return coll


async def async_create_dashboard(
    hass: HomeAssistant,
    url_path: str = DASHBOARD_URL,
    title: str = DASHBOARD_TITLE,
) -> bool:
    """Create a storage dashboard that runs the SunFlow strategy.

    Returns False when a dashboard already uses url_path.
    """
    ll = hass.data.get(LOVELACE)
    dashboards = getattr(ll, "dashboards", None)
    if dashboards is None:
        raise HomeAssistantError("Dashboards are not available")
    if url_path in dashboards:
        return False
    coll = _dashboards_collection(hass)
    await coll.async_create_item(
        {
            "allow_single_word": True,
            "url_path": url_path,
            "title": title,
            "icon": DASHBOARD_ICON,
            "show_in_sidebar": True,
            "require_admin": False,
        }
    )
    await dashboards[url_path].async_save({"strategy": dict(STRATEGY)})
    return True
