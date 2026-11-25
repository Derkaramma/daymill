"""Setup wizard and options flow."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType, InvalidData
from homeassistant.exceptions import HomeAssistantError
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.sunflow_solar.config_flow import energy_guide
from custom_components.sunflow_solar.const import DOMAIN
from custom_components.sunflow_solar.tariff import TariffError, list_presets

from .test_detection import add_pvs, add_tesla, add_wall_connector

COMPONENT = Path(__file__).parent.parent / "custom_components" / DOMAIN
STRINGS = json.loads((COMPONENT / "strings.json").read_text())

SOURCES = {
    "solar_power": "sensor.pv_live",
    "solar_power_fallback": "sensor.pv_meter",
    "grid_power": "sensor.grid_live",
    "grid_positive_is_import": True,
    "solar_energy": "sensor.pv_lifetime",
    "import_energy": "sensor.grid_in_lifetime",
    "export_energy": "sensor.grid_out_lifetime",
    "max_age": 300,
}
RATES = {"tariff": "sce_tou_d_prime", "nem": "nem2", "cycle_day": 12.0, "track_cost": True}
CAR = {
    "name": "Truck",
    "image": "truck",
    "charging": "binary_sensor.truck_charging",
    "power": "sensor.truck_power",
    "battery": "sensor.truck_battery",
    "plugged": "binary_sensor.truck_plug",
}
# a config saved by the first release, before the wizard
M1_DATA = {
    "tariff": "sce_tou_d_prime",
    "nem": "nem2",
    "cycle_day": 12,
    "grid_positive_is_import": True,
    "solar_power": "sensor.pv_live",
    "solar_power_fallback": "sensor.pv_meter",
    "grid_power": "sensor.grid_live",
    "home_power": "sensor.house",
    "solar_energy": "sensor.pv_lifetime",
    "import_energy": "sensor.grid_in_lifetime",
    "export_energy": "sensor.grid_out_lifetime",
    "gateway_uptime": "sensor.gw_uptime",
    "cars": [{"name": "Car", "charging": "binary_sensor.car_charging"}],
}


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(recorder_mock, enable_custom_integrations):
    """Recorder first: the integration depends on it."""
    yield


@pytest.fixture(autouse=True)
def no_setup():
    with patch("custom_components.sunflow_solar.async_setup_entry", return_value=True) as mock:
        yield mock


@pytest.fixture
def dashboard():
    with patch(
        "custom_components.sunflow_solar.config_flow.async_create_dashboard",
        AsyncMock(return_value=True),
    ) as mock:
        yield mock


# ---- helpers ----


def check_strings(result: dict[str, Any], section: str) -> None:
    """Every page, field, error and menu item we show has text in strings.json."""
    strings = STRINGS[section]
    kind = result["type"]
    if kind is FlowResultType.ABORT:
        assert result["reason"] in strings["abort"], result["reason"]
        return
    if kind is FlowResultType.CREATE_ENTRY:
        return
    step = strings["step"][result["step_id"]]
    text = step.get("title", "") + step.get("description", "")
    wanted = set(re.findall(r"\{(\w+)\}", text))
    given = set(result.get("description_placeholders") or {})
    assert wanted <= given, (result["step_id"], wanted - given)
    if kind is FlowResultType.MENU:
        for option in result["menu_options"]:
            assert option in step["menu_options"], (result["step_id"], option)
        return
    for key in result["data_schema"].schema:
        assert str(key) in step.get("data", {}), (result["step_id"], str(key))
    for error in (result.get("errors") or {}).values():
        assert error in strings["error"], error


def suggested(result: dict[str, Any]) -> dict[str, Any]:
    """Prefilled values of a form: suggested values and defaults."""
    out = {}
    for key in result["data_schema"].schema:
        desc = getattr(key, "description", None) or {}
        if "suggested_value" in desc:
            out[str(key)] = desc["suggested_value"]
        elif callable(getattr(key, "default", None)):
            value = key.default()
            if value is not None:
                out[str(key)] = value
    return out


class Flow:
    """Drives a config or options flow and checks strings on every page."""

    def __init__(self, hass: HomeAssistant, section: str = "config") -> None:
        self.hass = hass
        self.section = section
        if section == "config":
            self.manager = hass.config_entries.flow
        else:
            self.manager = hass.config_entries.options
        self.result: dict[str, Any] = {}

    async def start(self, entry: MockConfigEntry | None = None) -> dict[str, Any]:
        if entry is None:
            res = await self.manager.async_init(
                DOMAIN, context={"source": config_entries.SOURCE_USER}
            )
        else:
            res = await self.manager.async_init(entry.entry_id)
        return self._set(res)

    async def send(self, data: dict[str, Any] | None = None) -> dict[str, Any]:
        res = await self.manager.async_configure(self.result["flow_id"], data or {})
        return self._set(res)

    async def menu(self, option: str) -> dict[str, Any]:
        assert self.result["type"] is FlowResultType.MENU, self.result
        assert option in self.result["menu_options"]
        return await self.send({"next_step_id": option})

    def _set(self, res: dict[str, Any]) -> dict[str, Any]:
        check_strings(res, self.section)
        self.result = res
        return res

    @property
    def step(self) -> str | None:
        return self.result.get("step_id")


async def skip_to_rates(flow: Flow) -> None:
    """From the panels page: no panels, no battery, no cars."""
    assert flow.step == "panels"
    await flow.send({"roof_faces": 0})
    assert flow.step == "battery"
    await flow.send({"battery_positive_is_discharge": True})
    assert flow.step == "cars"
    await flow.menu("cars_done")
    assert flow.step == "rates"


# ---- setup: nothing installed ----


async def test_no_solar_menu(hass: HomeAssistant) -> None:
    flow = Flow(hass)
    res = await flow.start()
    assert res["type"] is FlowResultType.MENU
    assert res["step_id"] == "no_solar"
    assert res["menu_options"] == ["user", "custom", "demo"]
    assert res["description_placeholders"]["pvs_url"].startswith("https://github.com/")

    # "check again" after installing something finds it
    add_pvs(hass, panels=0)
    res = await flow.menu("user")
    assert res["type"] is FlowResultType.FORM
    assert res["step_id"] == "user"


async def test_demo_flow(hass: HomeAssistant, dashboard: AsyncMock) -> None:
    flow = Flow(hass)
    await flow.start()
    res = await flow.menu("demo")
    assert res["step_id"] == "rates"
    res = await flow.send(RATES)
    assert res["step_id"] == "finish"
    assert "demo data" in res["description_placeholders"]["guide"]
    res = await flow.send({"create_dashboard": True})
    assert res["type"] is FlowResultType.CREATE_ENTRY
    assert res["title"] == "SunFlow Solar"
    assert res["data"] == {
        "source": "demo",
        "system": "demo",
        "tariff": "sce_tou_d_prime",
        "nem": "nem2",
        "cycle_day": 12,
        "track_cost": True,
    }
    dashboard.assert_awaited_once()


async def test_custom_flow(hass: HomeAssistant, dashboard: AsyncMock) -> None:
    flow = Flow(hass)
    await flow.start()
    res = await flow.menu("custom")
    assert res["step_id"] == "sources"
    # nothing detected, nothing prefilled except the toggles
    assert suggested(res) == {"grid_positive_is_import": True, "max_age": 600}
    res = await flow.send(SOURCES)
    await skip_to_rates(flow)
    res = await flow.send({**RATES, "track_cost": False})
    assert res["step_id"] == "finish"
    guide = res["description_placeholders"]["guide"]
    assert "sensor.sunflow_energy_produced" in guide
    assert "import_cost" not in guide  # cost tracking is off
    res = await flow.send({"create_dashboard": False})
    assert res["type"] is FlowResultType.CREATE_ENTRY
    data = res["data"]
    assert data["source"] == "entities"
    assert data["system"] == "custom"
    assert data["max_age"] == 300
    assert data["solar_power_fallback"] == "sensor.pv_meter"
    assert data["track_cost"] is False
    for key in ("grid_power_fallback", "home_power", "panels", "cars", "battery_soc"):
        assert key not in data
    dashboard.assert_not_awaited()


async def test_single_instance(hass: HomeAssistant) -> None:
    MockConfigEntry(domain=DOMAIN, data={}, unique_id=DOMAIN).add_to_hass(hass)
    res = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    assert res["type"] is FlowResultType.ABORT
    check_strings(res, "config")


# ---- setup: detected PVS, panels, battery, cars ----


async def test_pvs_full_flow(hass: HomeAssistant, dashboard: AsyncMock) -> None:
    pvs = add_pvs(hass, ess=True, panels=3)
    _tesla, tesla_dev = add_tesla(hass)

    flow = Flow(hass)
    res = await flow.start()
    assert res["step_id"] == "user"
    assert res["description_placeholders"]["found"] == "SunPower PVS"
    assert suggested(res) == {"system": pvs.entry.entry_id}

    res = await flow.send({"system": pvs.entry.entry_id})
    assert res["step_id"] == "sources"
    assert res["description_placeholders"]["system"] == "SunPower PVS"
    assert "Live data is on" in res["description_placeholders"]["tip"]
    prefill = suggested(res)
    assert prefill["solar_power"] == "sensor.pvs_live_production_power"
    assert prefill["solar_power_fallback"] == "sensor.production_meter_power_3ph_kw"
    assert prefill["solar_energy"] == "sensor.production_meter_net_lte_kwh"
    assert prefill["home_power"] == "sensor.pvs_live_site_load_power"

    res = await flow.send(prefill)
    assert res["step_id"] == "panels"
    assert res["description_placeholders"]["count"] == "3"
    prefill = suggested(res)
    assert prefill["roof_faces"] == 1
    assert prefill["gateway_uptime"] == "sensor.pvs_gateway_uptime"
    assert "sensor.pvs_cpu_usage" in prefill["gateway_diagnostics"]

    res = await flow.send({**prefill, "roof_faces": 2})
    assert res["step_id"] == "panel_face"
    assert res["description_placeholders"] == {"number": "1", "total": "2"}
    # only the last face gets the leftovers suggested
    assert "panels" not in suggested(res)
    res = await flow.send({"label": "Front", "facing": "South", "panels": ["sensor.panel_1_power"]})
    assert res["step_id"] == "panel_face"
    assert res["description_placeholders"]["number"] == "2"
    prefill = suggested(res)
    assert prefill["label"] == "Roof 2"
    assert prefill["panels"] == ["sensor.panel_2_power", "sensor.panel_3_power"]
    res = await flow.send({"label": "Back", "panels": prefill["panels"]})

    assert res["step_id"] == "battery"
    assert res["description_placeholders"]["found"] == "SunPower PVS"
    prefill = suggested(res)
    assert prefill == {
        "battery_soc": "sensor.pvs_live_battery_soc",
        "battery_power": "sensor.pvs_live_battery_power",
        "battery_positive_is_discharge": True,
    }
    res = await flow.send({**prefill, "battery_positive_is_discharge": False})

    assert res["type"] is FlowResultType.MENU
    assert res["step_id"] == "cars"
    assert res["menu_options"] == ["car_add", "cars_done"]
    assert res["description_placeholders"]["found"] == "Tesla Fleet"
    assert "Tesla]" not in res["description_placeholders"]["links"]
    assert "Rivian" in res["description_placeholders"]["links"]

    res = await flow.menu("car_add")
    assert res["step_id"] == "car_add"
    assert suggested(res) == {"car": tesla_dev}
    res = await flow.send({"car": tesla_dev})
    assert res["step_id"] == "car"
    controls = res["description_placeholders"]["controls"]
    assert "switch.ty_charge" in controls and "lock.ty_lock" in controls
    prefill = suggested(res)
    assert prefill["name"] == "Model Y"
    assert prefill["battery"] == "sensor.ty_battery"
    assert prefill["presence"] == "device_tracker.ty_location"
    res = await flow.send({**prefill, "image": "suv"})
    assert res["step_id"] == "cars"
    assert res["description_placeholders"]["cars"] == "Model Y"
    assert res["menu_options"] == ["car_add", "car_edit", "car_remove", "cars_done"]

    # the Tesla is used, so a second car goes straight to the manual form
    res = await flow.menu("car_add")
    assert res["step_id"] == "car"
    assert suggested(res)["name"] == "Car 2"
    assert res["description_placeholders"]["controls"] == "None found."
    res = await flow.send(CAR)
    assert res["step_id"] == "cars"
    res = await flow.menu("cars_done")

    assert res["step_id"] == "rates"
    res = await flow.send({**RATES, "nem": "nem3"})
    assert res["step_id"] == "nem3"
    res = await flow.send({"pto_date": "2026-03-10", "acc_plus_class": "residential"})
    assert res["step_id"] == "finish"
    assert "sensor.sunflow_import_cost" in res["description_placeholders"]["guide"]
    assert "Home battery" in res["description_placeholders"]["guide"]
    res = await flow.send({"create_dashboard": True})
    assert res["type"] is FlowResultType.CREATE_ENTRY
    dashboard.assert_awaited_once()

    data = res["data"]
    assert data["system"] == "sunstrong_pvs"
    assert data["source"] == "entities"
    assert data["grid_power_fallback"] == "sensor.grid_meter_power_3ph_kw"
    assert data["gateway_uptime"] == "sensor.pvs_gateway_uptime"
    assert data["panels"] == [
        {
            "label": "Front",
            "facing": "South",
            "panels": [
                {
                    "power": "sensor.panel_1_power",
                    "lifetime": "sensor.panel_1_lifetime",
                    "last_reported": "sensor.panel_1_last_reported",
                }
            ],
        },
        {
            "label": "Back",
            "panels": [
                {
                    "power": "sensor.panel_2_power",
                    "lifetime": "sensor.panel_2_lifetime",
                    "last_reported": "sensor.panel_2_last_reported",
                },
                {
                    "power": "sensor.panel_3_power",
                    "lifetime": "sensor.panel_3_lifetime",
                    "last_reported": "sensor.panel_3_last_reported",
                },
            ],
        },
    ]
    assert data["battery_positive_is_discharge"] is False
    assert data["battery_soc"] == "sensor.pvs_live_battery_soc"
    assert data["cars"] == [
        {
            "name": "Model Y",
            "image": "suv",
            "device": tesla_dev,
            "presence": "device_tracker.ty_location",
            "charging": "sensor.ty_charging",
            "power": "sensor.ty_charger_power",
            "battery": "sensor.ty_battery",
            "plugged": "binary_sensor.ty_cable",
            "limit": "number.ty_limit",
        },
        CAR,
    ]
    assert data["nem"] == "nem3"
    assert data["pto_date"] == "2026-03-10"


async def test_pvs_without_live_data_tip(hass: HomeAssistant) -> None:
    pvs = add_pvs(hass, live=False, panels=0)
    flow = Flow(hass)
    await flow.start()
    res = await flow.send({"system": pvs.entry.entry_id})
    assert "turn on **live data**" in res["description_placeholders"]["tip"]


async def test_welcome_custom_and_demo(hass: HomeAssistant) -> None:
    add_pvs(hass, panels=2)
    flow = Flow(hass)
    await flow.start()
    res = await flow.send({"system": "custom"})
    assert res["step_id"] == "sources"
    assert "solar_power" not in suggested(res)
    # panels are still offered for a hand-picked setup
    res = await flow.send(SOURCES)
    assert res["description_placeholders"]["count"] == "2"

    hass.config_entries.flow.async_abort(flow.result["flow_id"])
    flow = Flow(hass)
    await flow.start()
    res = await flow.send({"system": "demo"})
    assert res["step_id"] == "rates"


async def test_wall_connector_car(hass: HomeAssistant) -> None:
    _f, dev = add_wall_connector(hass)
    flow = Flow(hass)
    await flow.start()
    await flow.menu("custom")
    await flow.send(SOURCES)
    await flow.send({"roof_faces": 0})
    await flow.send({})
    res = await flow.menu("car_add")
    assert res["step_id"] == "car_add"
    res = await flow.send({"car": dev})
    prefill = suggested(res)
    assert prefill["charging"] == "binary_sensor.wc_contactor"
    assert "battery" not in prefill
    # a charger alone is enough: only charging is required
    res = await flow.send(prefill)
    assert res["step_id"] == "cars"


async def test_car_needs_charging(hass: HomeAssistant) -> None:
    flow = Flow(hass)
    await flow.start()
    await flow.menu("custom")
    await flow.send(SOURCES)
    await flow.send({"roof_faces": 0})
    await flow.send({})
    res = await flow.menu("car_add")
    assert res["step_id"] == "car"
    with pytest.raises(InvalidData):
        await flow.send({"name": "Car 1", "image": "sedan"})
    res = await flow.send({"name": "Car 1", "image": "sedan", "charging": "binary_sensor.x"})
    assert res["step_id"] == "cars"


async def test_car_add_manual_choice(hass: HomeAssistant) -> None:
    add_tesla(hass)
    flow = Flow(hass)
    await flow.start()
    await flow.menu("custom")
    await flow.send(SOURCES)
    await flow.send({"roof_faces": 0})
    await flow.send({})
    await flow.menu("car_add")
    res = await flow.send({"car": "manual"})
    assert res["step_id"] == "car"
    assert suggested(res)["name"] == "Car 1"
    res = await flow.send(CAR)
    assert res["step_id"] == "cars"


# ---- setup: errors ----


async def test_sources_errors(hass: HomeAssistant) -> None:
    hass.states.async_set("sensor.pv_live", "3", {"unit_of_measurement": "A"})
    hass.states.async_set("sensor.pv_lifetime", "100", {})
    hass.states.async_set("sensor.grid_in_lifetime", "100", {"unit_of_measurement": "MWh"})
    flow = Flow(hass)
    await flow.start()
    await flow.menu("custom")
    res = await flow.send(
        {
            **SOURCES,
            "grid_power_fallback": "sensor.grid_live",
            "export_energy": "sensor.grid_in_lifetime",
        }
    )
    assert res["step_id"] == "sources"
    assert res["errors"] == {
        "solar_power": "bad_unit",
        "solar_energy": "bad_unit",
        "grid_power_fallback": "same_as_live",
        "base": "energy_not_distinct",
    }
    hass.states.async_set("sensor.pv_live", "3", {"unit_of_measurement": "kW"})
    hass.states.async_set("sensor.pv_lifetime", "100", {"unit_of_measurement": "kWh"})
    res = await flow.send(SOURCES)
    assert res["step_id"] == "panels"


async def test_panel_face_errors(hass: HomeAssistant) -> None:
    hass.states.async_set("sensor.amps", "3", {"unit_of_measurement": "A"})
    flow = Flow(hass)
    await flow.start()
    await flow.menu("custom")
    await flow.send(SOURCES)
    await flow.send({"roof_faces": 2})
    res = await flow.send({"label": "A", "panels": []})
    assert res["errors"] == {"panels": "no_panels"}
    res = await flow.send({"label": "A", "panels": ["sensor.amps"]})
    assert res["errors"] == {"panels": "bad_unit"}
    res = await flow.send({"label": "A", "panels": ["sensor.p1", "sensor.p2"]})
    assert res["description_placeholders"]["number"] == "2"
    res = await flow.send({"label": "B", "panels": ["sensor.p2"]})
    assert res["errors"] == {"panels": "panel_used_twice"}
    res = await flow.send({"label": "  ", "panels": ["sensor.p3"]})
    assert res["step_id"] == "battery"


async def test_battery_errors_and_skip(hass: HomeAssistant) -> None:
    hass.states.async_set("sensor.batt_soc", "50", {"unit_of_measurement": "kWh"})
    hass.states.async_set("sensor.batt_power", "1", {"unit_of_measurement": "V"})
    flow = Flow(hass)
    await flow.start()
    await flow.menu("custom")
    await flow.send(SOURCES)
    await flow.send({"roof_faces": 0})
    res = await flow.send({"battery_soc": "sensor.batt_soc", "battery_power": "sensor.batt_power"})
    assert res["errors"] == {"battery_soc": "bad_unit_percent", "battery_power": "bad_unit"}
    res = await flow.send({"battery_positive_is_discharge": True})
    assert res["step_id"] == "cars"


async def test_car_errors(hass: HomeAssistant) -> None:
    hass.states.async_set("sensor.truck_power", "7", {"unit_of_measurement": "A"})
    flow = Flow(hass)
    await flow.start()
    await flow.menu("custom")
    await flow.send(SOURCES)
    await flow.send({"roof_faces": 0})
    await flow.send({})
    await flow.menu("car_add")
    with pytest.raises(InvalidData):
        await flow.send({"name": "Truck", "image": "sedan"})
    res = await flow.send({**CAR, "name": "  ", "image": "sedan"})
    assert res["errors"] == {"name": "name_required", "power": "bad_unit"}
    res = await flow.send(CAR)
    assert res["errors"] == {"power": "bad_unit"}
    hass.states.async_set("sensor.truck_power", "7", {"unit_of_measurement": "kW"})
    res = await flow.send(CAR)
    assert res["step_id"] == "cars"
    await flow.menu("car_add")
    res = await flow.send({**CAR, "name": "truck"})
    assert res["errors"] == {"name": "name_taken"}


async def test_rates_tariff_error(hass: HomeAssistant) -> None:
    flow = Flow(hass)
    await flow.start()
    await flow.menu("demo")
    with patch(
        "custom_components.sunflow_solar.config_flow.build_engine",
        side_effect=TariffError("bad"),
    ):
        res = await flow.send({**RATES, "nem": "nem3"})
        assert res["errors"] == {"nem": "tariff_invalid"}
        res = await flow.send(RATES)
        assert res["errors"] == {"tariff": "tariff_invalid"}
    res = await flow.send(RATES)
    assert res["step_id"] == "finish"


async def test_rates_lists_presets(hass: HomeAssistant) -> None:
    flow = Flow(hass)
    await flow.start()
    res = await flow.menu("demo")
    schema = res["data_schema"].schema
    tariff_key = next(k for k in schema if str(k) == "tariff")
    options = schema[tariff_key].config["options"]
    presets = await hass.async_add_executor_job(list_presets)
    assert [o["value"] for o in options] == list(presets)


async def test_dashboard_failure_still_creates_entry(hass: HomeAssistant) -> None:
    flow = Flow(hass)
    await flow.start()
    await flow.menu("demo")
    await flow.send(RATES)
    with patch(
        "custom_components.sunflow_solar.config_flow.async_create_dashboard",
        AsyncMock(side_effect=HomeAssistantError("no lovelace")),
    ):
        res = await flow.send({"create_dashboard": True})
    assert res["type"] is FlowResultType.CREATE_ENTRY


# ---- options ----


def add_entry(hass: HomeAssistant, data: dict[str, Any]) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, data=data, unique_id=DOMAIN)
    entry.add_to_hass(hass)
    return entry


async def test_options_menu(hass: HomeAssistant) -> None:
    entry = add_entry(hass, M1_DATA)
    flow = Flow(hass, "options")
    res = await flow.start(entry)
    assert res["type"] is FlowResultType.MENU
    assert res["menu_options"] == ["sources", "panels", "battery", "cars", "rates", "dashboard"]
    assert "sensor.sunflow_energy_exported" in res["description_placeholders"]["guide"]


async def test_options_sources_keeps_the_rest(hass: HomeAssistant) -> None:
    entry = add_entry(hass, M1_DATA)
    flow = Flow(hass, "options")
    await flow.start(entry)
    res = await flow.menu("sources")
    prefill = suggested(res)
    assert prefill["home_power"] == "sensor.house"
    assert prefill["max_age"] == 600
    new = {k: v for k, v in prefill.items() if k not in ("solar_power_fallback", "home_power")}
    new["grid_positive_is_import"] = False
    res = await flow.send(new)
    assert res["type"] is FlowResultType.CREATE_ENTRY
    opts = entry.options
    assert opts["grid_positive_is_import"] is False
    assert "solar_power_fallback" not in opts
    assert "home_power" not in opts
    assert opts["source"] == "entities"
    # everything this page doesn't show is kept
    assert opts["cars"] == M1_DATA["cars"]
    assert opts["gateway_uptime"] == "sensor.gw_uptime"
    assert opts["cycle_day"] == 12
    # the entry data is never touched
    assert entry.data == M1_DATA


async def test_options_panels_edit_and_clear(hass: HomeAssistant) -> None:
    data = {
        **M1_DATA,
        "panels": [
            {"label": "Front", "facing": "East", "panels": [{"power": "sensor.p1"}]},
            {"label": "Back", "panels": [{"power": "sensor.p2"}]},
        ],
    }
    entry = add_entry(hass, data)
    flow = Flow(hass, "options")
    await flow.start(entry)
    res = await flow.menu("panels")
    prefill = suggested(res)
    assert prefill["roof_faces"] == 2
    assert prefill["gateway_uptime"] == "sensor.gw_uptime"
    res = await flow.send({"roof_faces": 1, "gateway_uptime": "sensor.gw_uptime"})
    prefill = suggested(res)
    assert prefill == {"label": "Front", "facing": "East", "panels": ["sensor.p1"]}
    res = await flow.send({"label": "Front", "panels": ["sensor.p1", "sensor.p2"]})
    assert res["type"] is FlowResultType.CREATE_ENTRY
    assert entry.options["panels"] == [
        {"label": "Front", "panels": [{"power": "sensor.p1"}, {"power": "sensor.p2"}]}
    ]

    flow = Flow(hass, "options")
    await flow.start(entry)
    await flow.menu("panels")
    res = await flow.send({"roof_faces": 0})
    assert res["type"] is FlowResultType.CREATE_ENTRY
    assert "panels" not in entry.options
    assert "gateway_uptime" not in entry.options


async def test_options_battery_remove(hass: HomeAssistant) -> None:
    entry = add_entry(
        hass,
        {**M1_DATA, "battery_soc": "sensor.b_soc", "battery_positive_is_discharge": False},
    )
    flow = Flow(hass, "options")
    await flow.start(entry)
    res = await flow.menu("battery")
    assert suggested(res) == {
        "battery_soc": "sensor.b_soc",
        "battery_positive_is_discharge": False,
    }
    res = await flow.send({"battery_positive_is_discharge": True})
    assert res["type"] is FlowResultType.CREATE_ENTRY
    for key in ("battery_soc", "battery_power", "battery_positive_is_discharge"):
        assert key not in entry.options


async def test_options_cars_add_edit_remove(hass: HomeAssistant) -> None:
    entry = add_entry(hass, M1_DATA)
    flow = Flow(hass, "options")
    await flow.start(entry)
    res = await flow.menu("cars")
    assert res["description_placeholders"]["cars"] == "Car"

    # an old car without an image or the newer roles opens fine
    await flow.menu("car_edit")
    res = await flow.send({"car": "0"})
    assert res["step_id"] == "car"
    assert suggested(res) == {
        "name": "Car",
        "image": "sedan",
        "charging": "binary_sensor.car_charging",
    }
    res = await flow.send({**CAR, "name": "Car", "image": "sedan"})
    assert res["step_id"] == "cars"

    await flow.menu("car_add")
    res = await flow.send(CAR)
    assert res["description_placeholders"]["cars"] == "Car, Truck"

    await flow.menu("car_remove")
    res = await flow.send({"cars": ["0"]})
    assert res["description_placeholders"]["cars"] == "Truck"
    res = await flow.menu("cars_done")
    assert res["type"] is FlowResultType.CREATE_ENTRY
    assert entry.options["cars"] == [CAR]

    # removing every car drops the key
    flow = Flow(hass, "options")
    await flow.start(entry)
    await flow.menu("cars")
    await flow.menu("car_remove")
    await flow.send({"cars": ["0"]})
    res = await flow.menu("cars_done")
    assert res["type"] is FlowResultType.CREATE_ENTRY
    assert "cars" not in entry.options


async def test_options_car_edit_keeps_device_and_lists_controls(hass: HomeAssistant) -> None:
    _f, dev = add_tesla(hass)
    car = {**CAR, "name": "Model Y", "device": dev}
    entry = add_entry(hass, {**M1_DATA, "cars": [car]})
    flow = Flow(hass, "options")
    await flow.start(entry)
    await flow.menu("cars")
    await flow.menu("car_edit")
    res = await flow.send({"car": "0"})
    assert "switch.ty_charge" in res["description_placeholders"]["controls"]
    # keeping its own name is fine
    form = {k: v for k, v in car.items() if k != "device"}
    res = await flow.send({**form, "image": "suv"})
    assert res["step_id"] == "cars"
    await flow.menu("cars_done")
    assert entry.options["cars"][0]["device"] == dev
    assert entry.options["cars"][0]["image"] == "suv"


async def test_options_rates_and_nem3(hass: HomeAssistant) -> None:
    data = {**M1_DATA, "nem": "nem3", "pto_date": "2025-01-02", "arecr": 0.02}
    entry = add_entry(hass, data)
    flow = Flow(hass, "options")
    await flow.start(entry)
    res = await flow.menu("rates")
    assert suggested(res)["nem"] == "nem3"
    assert suggested(res)["track_cost"] is True
    res = await flow.send({**RATES, "nem": "nem3", "cycle_day": 20})
    assert res["step_id"] == "nem3"
    assert suggested(res)["pto_date"] == "2025-01-02"
    res = await flow.send({"pto_date": "2025-06-01", "acc_plus_class": "residential"})
    assert res["type"] is FlowResultType.CREATE_ENTRY
    opts = entry.options
    assert opts["cycle_day"] == 20
    assert opts["pto_date"] == "2025-06-01"
    assert "arecr" not in opts

    # leaving NEM 3.0 drops its settings
    flow = Flow(hass, "options")
    await flow.start(entry)
    await flow.menu("rates")
    res = await flow.send({**RATES, "nem": "nem1", "track_cost": False})
    assert res["type"] is FlowResultType.CREATE_ENTRY
    assert entry.options["nem"] == "nem1"
    assert entry.options["track_cost"] is False
    assert "pto_date" not in entry.options


@pytest.mark.parametrize(
    ("returns", "reason"),
    [
        (AsyncMock(return_value=True), "dashboard_created"),
        (AsyncMock(return_value=False), "dashboard_exists"),
        (AsyncMock(side_effect=HomeAssistantError("x")), "dashboard_failed"),
    ],
)
async def test_options_dashboard(hass: HomeAssistant, returns: AsyncMock, reason: str) -> None:
    entry = add_entry(hass, M1_DATA)
    flow = Flow(hass, "options")
    await flow.start(entry)
    res = await flow.menu("dashboard")
    assert res["step_id"] == "dashboard"
    with patch("custom_components.sunflow_solar.config_flow.async_create_dashboard", returns):
        res = await flow.send({})
    assert res["type"] is FlowResultType.ABORT
    assert res["reason"] == reason
    assert entry.options == {}


async def test_options_demo_to_real(hass: HomeAssistant) -> None:
    entry = add_entry(hass, {"source": "demo", "system": "demo", **RATES, "cycle_day": 12})
    add_pvs(hass, panels=0)
    flow = Flow(hass, "options")
    res = await flow.start(entry)
    assert res["menu_options"] == ["sources", "rates", "dashboard"]
    assert "demo data" in res["description_placeholders"]["guide"]
    res = await flow.menu("sources")
    prefill = suggested(res)
    assert prefill["solar_power"] == "sensor.pvs_live_production_power"
    res = await flow.send(prefill)
    assert res["type"] is FlowResultType.CREATE_ENTRY
    assert entry.options["source"] == "entities"
    assert entry.options["system"] == "sunstrong_pvs"
    assert entry.options["tariff"] == "sce_tou_d_prime"


# ---- strings ----


def test_translations_match_strings() -> None:
    en = json.loads((COMPONENT / "translations" / "en.json").read_text())
    assert en == STRINGS


def test_options_steps_mirror_config_steps() -> None:
    shared = set(STRINGS["config"]["step"]) & set(STRINGS["options"]["step"])
    for step in shared:
        assert STRINGS["config"]["step"][step] == STRINGS["options"]["step"][step], step
    assert STRINGS["config"]["error"] == STRINGS["options"]["error"]


def test_no_urls_in_strings() -> None:
    """Links go in placeholders."""
    text = json.dumps({k: STRINGS[k] for k in ("config", "options")})
    assert "http" not in text


def test_energy_guide_battery_line() -> None:
    assert "Home battery" not in energy_guide({"solar_power": "x"})
    assert "Home battery" in energy_guide({"battery_power": "sensor.b"})
