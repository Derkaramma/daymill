"""Card bundle serving, the Lovelace resource and the dashboard helper."""

from __future__ import annotations

import logging
from typing import Any
from unittest.mock import patch

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.daymill import frontend
from custom_components.daymill.const import DOMAIN, OLD_DOMAIN, VERSION

URL = f"/daymill/daymill-cards.js?v={VERSION}"

CONFIG: dict[str, Any] = {
    "tariff": "sce_tou_d_prime",
    "nem": "nem2",
    "cycle_day": 1,
    "grid_positive_is_import": True,
    "solar_power": "sensor.pv_live",
    "grid_power": "sensor.grid_live",
    "solar_energy": "sensor.pv_lifetime",
    "import_energy": "sensor.grid_in_lifetime",
    "export_energy": "sensor.grid_out_lifetime",
}


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(recorder_mock, enable_custom_integrations):
    """Recorder first: the integration depends on it."""
    yield


async def _setup_lovelace(hass: HomeAssistant, conf: dict[str, Any] | None = None) -> None:
    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, "lovelace", {"lovelace": conf or {}})
    await hass.async_block_till_done()


async def _setup_entry(hass: HomeAssistant) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, data=CONFIG, title="DayMill")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


def _resources(hass: HomeAssistant) -> list[dict[str, Any]]:
    return list(hass.data["lovelace"].resources.async_items())


def _ours(hass: HomeAssistant) -> list[dict[str, Any]]:
    return [r for r in _resources(hass) if r["url"].startswith("/daymill/")]


async def test_storage_mode_adds_resource_and_serves_bundle(
    hass: HomeAssistant, hass_client
) -> None:
    await _setup_lovelace(hass)
    await _setup_entry(hass)

    ours = _ours(hass)
    assert len(ours) == 1
    assert ours[0]["url"] == URL
    assert ours[0]["type"] == "module"

    client = await hass_client()
    resp = await client.get(URL)
    assert resp.status == 200
    assert "javascript" in resp.headers["Content-Type"]
    assert "max-age" in resp.headers.get("Cache-Control", "")


async def test_dashboard_url_is_left_alone(hass: HomeAssistant, hass_client) -> None:
    """Only the bundle file is ours. /daymill itself belongs to the dashboard."""
    await _setup_lovelace(hass)
    await _setup_entry(hass)
    client = await hass_client()
    for path in ("/daymill", "/daymill/", "/daymill/0", "/daymill/home"):
        resp = await client.get(path)
        assert resp.status == 404, path


async def test_reload_does_not_duplicate(hass: HomeAssistant) -> None:
    await _setup_lovelace(hass)
    entry = await _setup_entry(hass)

    with patch.object(hass.http, "async_register_static_paths") as register:
        assert await hass.config_entries.async_reload(entry.entry_id)
        await hass.async_block_till_done()
        register.assert_not_called()
    assert len(_ours(hass)) == 1


async def test_keeps_other_resources(hass: HomeAssistant) -> None:
    await _setup_lovelace(hass)
    res = hass.data["lovelace"].resources
    await res.async_create_item({"res_type": "module", "url": "/local/other-card.js"})
    await _setup_entry(hass)
    urls = sorted(r["url"] for r in _resources(hass))
    assert urls == sorted(["/local/other-card.js", URL])


OLD_URL = "/sunflow_solar/sunflow-cards.js?v=0.1.1"


async def test_drops_the_sunflow_resource(hass: HomeAssistant) -> None:
    await _setup_lovelace(hass)
    res = hass.data["lovelace"].resources
    await res.async_create_item({"res_type": "module", "url": OLD_URL})
    # set up but not running, as after its folder is deleted
    MockConfigEntry(domain=OLD_DOMAIN, data={}).add_to_hass(hass)
    await _setup_entry(hass)
    assert [r["url"] for r in _resources(hass)] == [URL]


async def test_keeps_the_sunflow_resource_while_it_runs(hass: HomeAssistant) -> None:
    await _setup_lovelace(hass)
    res = hass.data["lovelace"].resources
    await res.async_create_item({"res_type": "module", "url": OLD_URL})
    MockConfigEntry(domain=OLD_DOMAIN, data={}, state=ConfigEntryState.LOADED).add_to_hass(hass)
    await _setup_entry(hass)
    assert sorted(r["url"] for r in _resources(hass)) == sorted([OLD_URL, URL])


async def test_version_bump_updates_url_and_drops_copies(hass: HomeAssistant) -> None:
    await _setup_lovelace(hass)
    res = hass.data["lovelace"].resources
    await res.async_create_item({"res_type": "module", "url": "/daymill/daymill-cards.js?v=0.0.1"})
    await res.async_create_item({"res_type": "js", "url": "/daymill/daymill-cards.js"})
    await _setup_entry(hass)

    ours = _ours(hass)
    assert len(ours) == 1
    assert ours[0]["url"] == URL
    assert ours[0]["type"] == "module"

    with patch.object(frontend, "VERSION", "9.9.9"):
        assert await frontend.async_register_resource(hass) == "updated"
    assert [r["url"] for r in _ours(hass)] == ["/daymill/daymill-cards.js?v=9.9.9"]
    with patch.object(frontend, "VERSION", "9.9.9"):
        assert await frontend.async_register_resource(hass) == "present"


async def test_lovelace_loading_later(hass: HomeAssistant) -> None:
    await _setup_entry(hass)
    assert "lovelace" not in hass.config.components
    await _setup_lovelace(hass)
    await hass.async_block_till_done()
    assert [r["url"] for r in _ours(hass)] == [URL]


async def test_yaml_mode_raises_issue_and_logs_once(
    hass: HomeAssistant, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="custom_components.daymill.frontend")
    await _setup_lovelace(
        hass, {"resource_mode": "yaml", "resources": [{"url": "/local/x.js", "type": "module"}]}
    )
    entry = await _setup_entry(hass)

    issue = ir.async_get(hass).async_get_issue(DOMAIN, frontend.ISSUE_YAML)
    assert issue is not None
    assert issue.translation_placeholders == {"url": URL}
    assert caplog.text.count("YAML mode") == 1

    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert caplog.text.count("YAML mode") == 1
    # nothing written to the YAML list
    assert [r["url"] for r in _resources(hass)] == ["/local/x.js"]


async def test_yaml_mode_with_resource_present(hass: HomeAssistant) -> None:
    await _setup_lovelace(
        hass,
        {
            "resource_mode": "yaml",
            "resources": [{"url": "/daymill/daymill-cards.js", "type": "module"}],
        },
    )
    await _setup_entry(hass)
    assert ir.async_get(hass).async_get_issue(DOMAIN, frontend.ISSUE_YAML) is None


async def test_unload_keeps_resource(hass: HomeAssistant) -> None:
    await _setup_lovelace(hass)
    entry = await _setup_entry(hass)
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert len(_ours(hass)) == 1


async def test_remove_entry_drops_resource_and_issue(hass: HomeAssistant) -> None:
    await _setup_lovelace(hass)
    res = hass.data["lovelace"].resources
    await res.async_create_item({"res_type": "module", "url": "/local/other-card.js"})
    entry = await _setup_entry(hass)
    ir.async_create_issue(
        hass,
        DOMAIN,
        frontend.ISSUE_YAML,
        is_fixable=False,
        severity=ir.IssueSeverity.WARNING,
        translation_key=frontend.ISSUE_YAML,
    )
    assert await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    assert _ours(hass) == []
    assert [r["url"] for r in _resources(hass)] == ["/local/other-card.js"]
    assert ir.async_get(hass).async_get_issue(DOMAIN, frontend.ISSUE_YAML) is None


async def test_without_lovelace_or_http(hass: HomeAssistant) -> None:
    entry = await _setup_entry(hass)
    assert await frontend.async_register_resource(hass) is None
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_create_dashboard(hass: HomeAssistant) -> None:
    await _setup_lovelace(hass)
    assert await frontend.async_create_dashboard(hass) is True
    await hass.async_block_till_done()

    ll = hass.data["lovelace"]
    assert "daymill" in ll.dashboards
    assert await ll.dashboards["daymill"].async_load(False) == {
        "strategy": {"type": "custom:daymill"}
    }
    assert ll.dashboards["daymill"].config["title"] == "DayMill"
    assert await frontend.async_create_dashboard(hass) is False


def test_resource_url_matching() -> None:
    assert frontend._is_ours("/daymill/daymill-cards.js?v=1")
    assert frontend._is_ours("/daymill/daymill-cards.js")
    assert not frontend._is_ours("/local/daymill/daymill-cards.js")
    assert not frontend._is_ours("/daymill/other.js")
    assert not frontend._is_ours(None)
    assert frontend._is_old(OLD_URL)
    assert not frontend._is_old(URL)
