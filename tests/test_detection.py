"""Finding solar systems, batteries, panels and cars in the registries."""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.sunflow_solar import detection


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield


# ---- builders, also used by the config flow tests ----


@dataclass
class Fake:
    """One fake integration entry and the devices/entities hung off it."""

    hass: HomeAssistant
    platform: str
    title: str = "Test"
    entry: MockConfigEntry = field(init=False)

    def __post_init__(self) -> None:
        self.entry = MockConfigEntry(domain=self.platform, title=self.title)
        self.entry.add_to_hass(self.hass)

    def device(self, ident: str, name: str | None = None, model: str | None = None) -> str:
        device = dr.async_get(self.hass).async_get_or_create(
            config_entry_id=self.entry.entry_id,
            identifiers={(self.platform, ident)},
            name=name or ident,
            model=model,
        )
        return device.id

    def entity(
        self,
        device_id: str | None,
        unique_id: str,
        object_id: str,
        *,
        domain: str = "sensor",
        key: str | None = None,
        device_class: str | None = None,
        disabled: bool = False,
    ) -> str:
        entry = er.async_get(self.hass).async_get_or_create(
            domain,
            self.platform,
            unique_id,
            config_entry=self.entry,
            device_id=device_id,
            suggested_object_id=object_id,
            translation_key=key,
            original_device_class=device_class,
            disabled_by=er.RegistryEntryDisabler.USER if disabled else None,
        )
        return entry.entity_id


def add_pvs(
    hass: HomeAssistant,
    *,
    live: bool = True,
    ess: bool = False,
    panels: int = 3,
    live_battery_disabled: bool = False,
) -> Fake:
    """pvs-hass: gateway, live data, production (p) and consumption (c) meters, inverters."""
    f = Fake(hass, "sunstrong_pvs", "PVS TEST")
    sn = "PVSTEST001"
    gw = f.device(sn, f"PVS {sn}", "PVS6")
    for key in ("gateway_uptime", "cpu_usage", "ram_usage", "flash_usage", "sw_version"):
        f.entity(gw, f"{sn}_{key}", f"pvs_{key}", key=key)
    if live:
        ld = f.device(f"{sn}_livedata", f"PVS {sn} Live Data", "PVS Live Data")
        for key, dc in (
            ("live_production_power", "power"),
            ("live_net_consumption_power", "power"),
            ("live_site_load_power", "power"),
            ("live_production_energy", "energy"),
            ("live_net_consumption_energy", "energy"),
        ):
            f.entity(ld, f"{sn}_livedata_{key}", f"pvs_{key}", key=key, device_class=dc)
        for key, dc in (("live_battery_power", "power"), ("live_battery_soc", "battery")):
            f.entity(
                ld,
                f"{sn}_livedata_{key}",
                f"pvs_{key}",
                key=key,
                device_class=dc,
                disabled=live_battery_disabled,
            )
    for tail, name in (("p", "production"), ("c", "grid")):
        msn = f"PVS6M0TEST1{tail}"
        md = f.device(msn, f"Meter {msn}", "Meter")
        for key, dc in (
            ("power_3ph_kw", "power"),
            ("lte_3ph_kwh", "energy"),
            ("net_lte_kwh", "energy"),
            ("pos_lte_kwh", "energy"),
            ("neg_lte_kwh", "energy"),
        ):
            f.entity(md, f"{msn}_{key}", f"{name}_meter_{key}", key=key, device_class=dc)
    if ess:
        esn = "ESSTEST01"
        ed = f.device(esn, f"ESS {esn}", "ESS")
        f.entity(ed, f"{esn}_power_3ph_kw", "ess_power", key="power_3ph_kw", device_class="power")
        f.entity(ed, f"{esn}_soc_val", "ess_soc", key="soc_val", device_class="battery")
        f.entity(ed, f"{esn}_customer_soc_val", "ess_customer_soc", key="customer_soc_val")
        f.entity(ed, f"{esn}_neg_lte_kwh", "ess_neg", key="neg_lte_kwh", device_class="energy")
    for i in range(1, panels + 1):
        isn = f"E00TEST{i:04d}"
        idev = f.device(isn, f"MI {isn}", "Inverter")
        f.entity(
            idev,
            f"{isn}_current_power_production",
            f"panel_{i}_power",
            key="current_power_production",
            device_class="power",
        )
        f.entity(
            idev,
            f"{isn}_lifetime_production",
            f"panel_{i}_lifetime",
            key="lifetime_production",
            device_class="energy",
        )
        f.entity(
            idev,
            f"{isn}_last_reported",
            f"panel_{i}_last_reported",
            key="last_reported",
            device_class="timestamp",
        )
    return f


def add_sunpower(hass: HomeAssistant, *, battery: bool = False) -> Fake:
    """krbaker hass-sunpower: unique ids are '<serial>_pvs_<field>'."""
    f = Fake(hass, "sunpower", "SunPower")
    pvs = f.device("PVSTEST002", "PVS", "PVS6")
    f.entity(pvs, "PVSTEST002_pvs_dl_uptime", "pvs_uptime")
    f.entity(pvs, "PVSTEST002_pvs_dl_cpu_load", "pvs_load")
    for tail in ("p", "c"):
        msn = f"PVS6M0TEST2{tail}"
        md = f.device(msn, f"Power Meter {msn}")
        for field_, dc in (
            ("p_3phsum_kw", "power"),
            ("net_ltea_3phsum_kwh", "energy"),
            ("pos_ltea_3phsum_kwh", "energy"),
            ("neg_ltea_3phsum_kwh", "energy"),
        ):
            f.entity(md, f"{msn}_pvs_{field_}", f"meter_{tail}_{field_}", device_class=dc)
    for i in (1, 2):
        isn = f"E00SP{i:04d}"
        idev = f.device(isn, f"Inverter {isn}")
        f.entity(idev, f"{isn}_pvs_p_3phsum_kw", f"inv_{i}_power", device_class="power")
        f.entity(idev, f"{isn}_pvs_ltea_3phsum_kwh", f"inv_{i}_lifetime", device_class="energy")
    if battery:
        sv = f.device("sunvault", "SunVault")
        f.entity(
            sv,
            "sunvault_pvs_sunvault_customer_state_of_charge",
            "sunvault_soc",
        )
        f.entity(sv, "sunvault_pvs_sunvault_power", "sunvault_power", device_class="power")
    return f


def add_enphase(hass: HomeAssistant) -> Fake:
    f = Fake(hass, "enphase_envoy", "Envoy TEST")
    sn = "123456"
    env = f.device(sn, f"Envoy {sn}", "Envoy")
    for key, dc in (
        ("production", "power"),
        ("lifetime_production", "energy"),
        ("daily_production", "energy"),
        ("consumption", "power"),
        ("net_consumption", "power"),
        ("lifetime_net_consumption", "energy"),
        ("lifetime_net_production", "energy"),
        ("battery_discharge", "power"),
    ):
        tk = {"production": "current_power_production", "consumption": "current_power_consumption"}
        f.entity(env, f"{sn}_{key}", f"envoy_{key}", key=tk.get(key, key), device_class=dc)
    agg = f.device("enc", "Encharge", "Encharge")
    f.entity(agg, f"{sn}_battery_level", "envoy_battery", device_class="battery")
    for i in (1, 2):
        isn = f"INV{i}"
        idev = f.device(isn, f"Inverter {isn}", "Inverter")
        f.entity(idev, isn, f"inverter_{i}", device_class="power")
        f.entity(idev, f"{isn}_lifetime_energy", f"inverter_{i}_lifetime", key="lifetime_energy")
        f.entity(
            idev,
            f"{isn}_last_reported",
            f"inverter_{i}_last_reported",
            key="last_reported",
            device_class="timestamp",
        )
    return f


def add_powerwall(hass: HomeAssistant) -> Fake:
    f = Fake(hass, "powerwall", "Powerwall")
    dev = f.device("gw", "Powerwall")
    for key in (
        "solar_instant_power",
        "site_instant_power",
        "load_instant_power",
        "battery_instant_power",
        "solar_export",
        "site_import",
        "site_export",
        "charge",
    ):
        f.entity(dev, f"base_{key}", f"powerwall_{key}", key=key)
    return f


def add_solaredge(hass: HomeAssistant) -> Fake:
    f = Fake(hass, "solaredge", "SolarEdge")
    dev = f.device("site", "SolarEdge")
    for key in (
        "current_power",
        "solar_power",
        "grid_power",
        "power_consumption",
        "lifetime_energy",
        "purchased_energy",
        "feedin_energy",
        "storage_level",
        "storage_power",
    ):
        f.entity(dev, f"site_{key}", f"solaredge_{key}", key=key)
    return f


def add_fronius(hass: HomeAssistant) -> Fake:
    f = Fake(hass, "fronius", "Fronius")
    flow = f.device("flow", "SolarNet")
    for key in ("power_photovoltaics", "power_grid", "power_load_consumed", "energy_total"):
        f.entity(flow, f"solar_net_123-power_flow-{key}", f"fronius_{key}")
    meter = f.device("meter", "Smart Meter")
    for key in ("energy_real_consumed", "energy_real_produced", "energy_real_ac_consumed"):
        f.entity(meter, f"meter_uid-{key}", f"fronius_{key}")
    storage = f.device("storage", "Battery")
    for key in ("state_of_charge", "power_battery"):
        f.entity(storage, f"batt-{key}", f"fronius_{key}")
    return f


def add_tesla(hass: HomeAssistant, name: str = "Model Y") -> tuple[Fake, str]:
    f = Fake(hass, "tesla_fleet", name)
    dev = f.device("VINTEST1", name, "Model Y")
    f.entity(dev, "v_charge_state_usable_battery_level", "ty_usable", device_class="battery")
    f.entity(dev, "v_charge_state_battery_level", "ty_battery", device_class="battery")
    f.entity(dev, "v_charge_state_charging_state", "ty_charging", device_class="enum")
    f.entity(
        dev,
        "v_charge_state_charger_power",
        "ty_charger_power",
        device_class="power",
    )
    f.entity(
        dev,
        "v_charge_state_conn_charge_cable",
        "ty_cable",
        domain="binary_sensor",
        device_class="plug",
    )
    f.entity(dev, "v_charge_state_charge_limit_soc", "ty_limit", domain="number")
    f.entity(dev, "v_location", "ty_location", domain="device_tracker", key="location")
    f.entity(dev, "v_route", "ty_route", domain="device_tracker", key="route")
    f.entity(dev, "v_charge", "ty_charge", domain="switch")
    f.entity(dev, "v_wake", "ty_wake", domain="button")
    f.entity(dev, "v_lock", "ty_lock", domain="lock")
    f.entity(dev, "v_update", "ty_update", domain="update", disabled=True)
    return f, dev


def add_wall_connector(hass: HomeAssistant) -> tuple[Fake, str]:
    f = Fake(hass, "tesla_wall_connector", "Wall Connector")
    dev = f.device("wc1", "Wall Connector")
    f.entity(
        dev,
        "wc1-vehicle_connected",
        "wc_connected",
        domain="binary_sensor",
        key="vehicle_connected",
        device_class="plug",
    )
    f.entity(
        dev,
        "wc1-contactor_closed",
        "wc_contactor",
        domain="binary_sensor",
        key="contactor_closed",
        device_class="battery_charging",
    )
    f.entity(dev, "wc1-total_power_w", "wc_power", device_class="power")
    f.entity(dev, "wc1-grid_v", "wc_voltage", device_class="voltage")
    return f, dev


# ---- solar ----


async def test_nothing_found(hass: HomeAssistant) -> None:
    assert detection.detect_solar(hass) == []
    assert detection.detect_cars(hass) == []


async def test_pvs_live(hass: HomeAssistant) -> None:
    add_pvs(hass)
    [system] = detection.detect_solar(hass)
    assert system.platform == "sunstrong_pvs"
    assert system.label == "SunPower PVS"
    assert system.roles == {
        "solar_power": "sensor.pvs_live_production_power",
        "solar_power_fallback": "sensor.production_meter_power_3ph_kw",
        "grid_power": "sensor.pvs_live_net_consumption_power",
        "grid_power_fallback": "sensor.grid_meter_power_3ph_kw",
        "home_power": "sensor.pvs_live_site_load_power",
        # production meter quirk: net lifetime, not lifetime
        "solar_energy": "sensor.production_meter_net_lte_kwh",
        "import_energy": "sensor.grid_meter_pos_lte_kwh",
        "export_energy": "sensor.grid_meter_neg_lte_kwh",
        "grid_positive_is_import": True,
    }
    assert system.notes == []
    assert system.gateway == "sensor.pvs_gateway_uptime"
    assert system.diagnostics == [
        "sensor.pvs_cpu_usage",
        "sensor.pvs_ram_usage",
        "sensor.pvs_flash_usage",
        "sensor.pvs_sw_version",
    ]
    assert [p.power for p in system.panels] == [
        "sensor.panel_1_power",
        "sensor.panel_2_power",
        "sensor.panel_3_power",
    ]
    assert system.panels[0].lifetime == "sensor.panel_1_lifetime"
    assert system.panels[0].last_reported == "sensor.panel_1_last_reported"
    # no ESS device: the live battery sensors don't count as a battery
    assert system.battery == {}


async def test_pvs_meters_only(hass: HomeAssistant) -> None:
    add_pvs(hass, live=False, panels=0)
    [system] = detection.detect_solar(hass)
    assert system.roles["solar_power"] == "sensor.production_meter_power_3ph_kw"
    assert system.roles["grid_power"] == "sensor.grid_meter_power_3ph_kw"
    assert "solar_power_fallback" not in system.roles
    assert "home_power" not in system.roles
    assert system.notes == ["no_live_data"]
    assert system.panels == []


async def test_pvs_battery(hass: HomeAssistant) -> None:
    add_pvs(hass, ess=True)
    [system] = detection.detect_solar(hass)
    assert system.battery == {
        "battery_soc": "sensor.pvs_live_battery_soc",
        "battery_power": "sensor.pvs_live_battery_power",
        "battery_positive_is_discharge": True,
    }


async def test_pvs_battery_live_disabled(hass: HomeAssistant) -> None:
    """Disabled live battery sensors fall back to the ESS device."""
    add_pvs(hass, ess=True, live_battery_disabled=True)
    [system] = detection.detect_solar(hass)
    assert system.battery["battery_soc"] == "sensor.ess_customer_soc"
    assert system.battery["battery_power"] == "sensor.ess_power"


async def test_sunpower(hass: HomeAssistant) -> None:
    add_sunpower(hass, battery=True)
    [system] = detection.detect_solar(hass)
    assert system.roles == {
        "solar_power": "sensor.meter_p_p_3phsum_kw",
        "grid_power": "sensor.meter_c_p_3phsum_kw",
        "solar_energy": "sensor.meter_p_net_ltea_3phsum_kwh",
        "import_energy": "sensor.meter_c_pos_ltea_3phsum_kwh",
        "export_energy": "sensor.meter_c_neg_ltea_3phsum_kwh",
        "grid_positive_is_import": True,
    }
    assert [p.power for p in system.panels] == ["sensor.inv_1_power", "sensor.inv_2_power"]
    assert system.panels[1].lifetime == "sensor.inv_2_lifetime"
    assert system.gateway == "sensor.pvs_uptime"
    assert system.diagnostics == ["sensor.pvs_load"]
    assert system.battery["battery_soc"] == "sensor.sunvault_soc"
    assert system.battery["battery_power"] == "sensor.sunvault_power"


async def test_enphase(hass: HomeAssistant) -> None:
    add_enphase(hass)
    [system] = detection.detect_solar(hass)
    assert system.roles == {
        "solar_power": "sensor.envoy_production",
        "grid_power": "sensor.envoy_net_consumption",
        "home_power": "sensor.envoy_consumption",
        "solar_energy": "sensor.envoy_lifetime_production",
        "import_energy": "sensor.envoy_lifetime_net_consumption",
        "export_energy": "sensor.envoy_lifetime_net_production",
        "grid_positive_is_import": True,
    }
    assert system.battery == {
        "battery_soc": "sensor.envoy_battery",
        "battery_power": "sensor.envoy_battery_discharge",
        "battery_positive_is_discharge": True,
    }
    assert [p.power for p in system.panels] == ["sensor.inverter_1", "sensor.inverter_2"]
    assert system.panels[0].lifetime == "sensor.inverter_1_lifetime"
    assert system.panels[0].last_reported == "sensor.inverter_1_last_reported"


async def test_powerwall(hass: HomeAssistant) -> None:
    add_powerwall(hass)
    [system] = detection.detect_solar(hass)
    assert system.roles == {
        "solar_power": "sensor.powerwall_solar_instant_power",
        "grid_power": "sensor.powerwall_site_instant_power",
        "home_power": "sensor.powerwall_load_instant_power",
        "solar_energy": "sensor.powerwall_solar_export",
        "import_energy": "sensor.powerwall_site_import",
        "export_energy": "sensor.powerwall_site_export",
        "grid_positive_is_import": True,
    }
    assert system.battery["battery_soc"] == "sensor.powerwall_charge"
    assert system.battery["battery_power"] == "sensor.powerwall_battery_instant_power"


async def test_solaredge(hass: HomeAssistant) -> None:
    add_solaredge(hass)
    [system] = detection.detect_solar(hass)
    assert system.roles["solar_power"] == "sensor.solaredge_solar_power"
    assert system.roles["grid_power"] == "sensor.solaredge_grid_power"
    assert system.roles["home_power"] == "sensor.solaredge_power_consumption"
    assert system.roles["solar_energy"] == "sensor.solaredge_lifetime_energy"
    assert system.roles["import_energy"] == "sensor.solaredge_purchased_energy"
    assert system.roles["export_energy"] == "sensor.solaredge_feedin_energy"
    assert system.battery["battery_soc"] == "sensor.solaredge_storage_level"


async def test_fronius(hass: HomeAssistant) -> None:
    add_fronius(hass)
    [system] = detection.detect_solar(hass)
    assert system.roles == {
        "solar_power": "sensor.fronius_power_photovoltaics",
        "grid_power": "sensor.fronius_power_grid",
        "home_power": "sensor.fronius_power_load_consumed",
        "solar_energy": "sensor.fronius_energy_total",
        "import_energy": "sensor.fronius_energy_real_consumed",
        "export_energy": "sensor.fronius_energy_real_produced",
        "grid_positive_is_import": True,
    }
    assert system.battery["battery_power"] == "sensor.fronius_power_battery"


async def test_several_systems(hass: HomeAssistant) -> None:
    add_pvs(hass, panels=0)
    add_powerwall(hass)
    systems = detection.detect_solar(hass)
    assert [s.platform for s in systems] == ["sunstrong_pvs", "powerwall"]


async def test_entry_without_solar_is_skipped(hass: HomeAssistant) -> None:
    f = Fake(hass, "fronius", "Only a meter")
    dev = f.device("meter")
    f.entity(dev, "m-energy_real_consumed", "only_meter")
    assert detection.detect_solar(hass) == []


async def test_panel_details(hass: HomeAssistant) -> None:
    f = Fake(hass, "some_inverters")
    dev = f.device("inv")
    power = f.entity(dev, "p", "inv_power", device_class="power")
    f.entity(dev, "e", "inv_energy", device_class="energy")
    f.entity(dev, "t", "inv_last_reported", device_class="timestamp")
    panel = detection.panel_details(hass, power)
    assert panel.lifetime == "sensor.inv_energy"
    assert panel.last_reported == "sensor.inv_last_reported"
    # an entity with no device gets nothing extra
    lone = f.entity(None, "lone", "lone_power", device_class="power")
    assert detection.panel_details(hass, lone).lifetime is None
    assert detection.panel_details(hass, "sensor.unknown").lifetime is None


# ---- cars ----


async def test_tesla_car(hass: HomeAssistant) -> None:
    _f, dev = add_tesla(hass)
    [car] = detection.detect_cars(hass)
    assert car.device_id == dev
    assert car.name == "Model Y"
    assert car.label == "Model Y (Tesla Fleet)"
    assert car.roles == {
        "battery": "sensor.ty_battery",
        "charging": "sensor.ty_charging",
        "plugged": "binary_sensor.ty_cable",
        "power": "sensor.ty_charger_power",
        "limit": "number.ty_limit",
        "presence": "device_tracker.ty_location",
    }
    # disabled entities are not listed
    assert car.controls == ["button.ty_wake", "lock.ty_lock", "number.ty_limit", "switch.ty_charge"]


async def test_wall_connector(hass: HomeAssistant) -> None:
    add_wall_connector(hass)
    [charger] = detection.detect_cars(hass)
    assert charger.roles == {
        "charging": "binary_sensor.wc_contactor",
        "plugged": "binary_sensor.wc_connected",
        "power": "sensor.wc_power",
    }
    assert charger.controls == []


async def test_car_device_without_car_sensors_is_skipped(hass: HomeAssistant) -> None:
    f = Fake(hass, "rivian", "Rivian")
    dev = f.device("wallbox_only")
    f.entity(dev, "x_temperature", "rivian_temp", device_class="temperature")
    assert detection.detect_cars(hass) == []


async def test_missing_car_links(hass: HomeAssistant) -> None:
    labels = [label for label, _url in detection.missing_car_links(hass)]
    assert "Tesla" in labels and "Rivian" in labels
    add_tesla(hass)
    Fake(hass, "rivian", "Rivian")
    labels = [label for label, _url in detection.missing_car_links(hass)]
    assert "Tesla" not in labels and "Rivian" not in labels
    assert detection.installed_car_platforms(hass) == {"tesla_fleet", "rivian"}
    assert all(url.startswith("https://") for _l, url in detection.missing_car_links(hass))


async def test_car_controls_no_device(hass: HomeAssistant) -> None:
    assert detection.car_controls(hass, None) == []
