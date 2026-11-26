"""Find solar systems, batteries, panels and cars that are already in HA.

Everything here reads the device and entity registries only. Entities are
matched on their translation key or the tail of their unique id, never on
the entity id, because users rename those all the time.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from .const import (
    CONF_BATTERY_POSITIVE_IS_DISCHARGE,
    CONF_BATTERY_POWER,
    CONF_BATTERY_SOC,
    CONF_CAR_BATTERY,
    CONF_CAR_CHARGING,
    CONF_CAR_LIMIT,
    CONF_CAR_PLUGGED,
    CONF_CAR_POWER,
    CONF_CAR_PRESENCE,
    CONF_EXPORT_ENERGY,
    CONF_GRID_POSITIVE_IS_IMPORT,
    CONF_GRID_POWER,
    CONF_GRID_POWER_FALLBACK,
    CONF_HOME_POWER,
    CONF_IMPORT_ENERGY,
    CONF_SOLAR_ENERGY,
    CONF_SOLAR_POWER,
    CONF_SOLAR_POWER_FALLBACK,
)

SOLAR_PLATFORMS: dict[str, str] = {
    "sunstrong_pvs": "SunPower PVS",
    "sunpower": "SunPower (hass-sunpower / ESunPower)",
    "enphase_envoy": "Enphase Envoy",
    "powerwall": "Tesla Powerwall",
    "solaredge": "SolarEdge",
    "fronius": "Fronius",
}

# Car and charger integrations: domain -> label
CAR_PLATFORMS: dict[str, str] = {
    "tesla_fleet": "Tesla Fleet",
    "teslemetry": "Teslemetry",
    "tessie": "Tessie",
    "rivian": "Rivian",
    "kia_uvo": "Kia / Hyundai",
    "fordpass": "Ford",
    "polestar_api": "Polestar",
    "lucidmotors": "Lucid",
    "bavariandata": "BMW / MINI",
    "abrp": "A Better Routeplanner",
    "tesla_wall_connector": "Tesla Wall Connector",
    "wallbox": "Wallbox",
    "ocpp": "OCPP charger",
    "emporia_ev": "Emporia charger",
    "chargepoint": "ChargePoint",
    "ohme": "Ohme",
    "peblar": "Peblar",
    "openevse": "OpenEVSE",
}

# What to install when a brand is missing: (label, url, domains)
CAR_LINKS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    (
        "Tesla",
        "https://www.home-assistant.io/integrations/tesla_fleet/",
        ("tesla_fleet", "teslemetry", "tessie"),
    ),
    ("Rivian", "https://github.com/bretterer/home-assistant-rivian", ("rivian",)),
    ("Kia / Hyundai", "https://github.com/Hyundai-Kia-Connect/kia_uvo", ("kia_uvo",)),
    ("Ford", "https://github.com/marq24/ha-fordpass", ("fordpass",)),
    ("Polestar", "https://github.com/pypolestar/polestar_api", ("polestar_api",)),
    ("Lucid", "https://github.com/borski/ha-lucidmotors", ("lucidmotors",)),
    ("BMW / MINI", "https://github.com/JustChr/BavarianData", ("bavariandata",)),
    ("Any car (ABRP)", "https://www.home-assistant.io/integrations/abrp/", ("abrp",)),
    (
        "Tesla Wall Connector",
        "https://www.home-assistant.io/integrations/tesla_wall_connector/",
        ("tesla_wall_connector",),
    ),
    ("Wallbox", "https://www.home-assistant.io/integrations/wallbox/", ("wallbox",)),
    ("Emporia charger", "https://github.com/Eunanibus/ha-emporia-ev", ("emporia_ev",)),
    ("ChargePoint", "https://github.com/mbillow/ha-chargepoint", ("chargepoint",)),
    ("OCPP chargers", "https://github.com/lbbrhzn/ocpp", ("ocpp",)),
)

# Entities a car integration can use to change something on the car.
CONTROL_DOMAINS = ("switch", "number", "button", "lock", "select", "update", "cover", "climate")


@dataclass
class Panel:
    power: str
    lifetime: str | None = None
    last_reported: str | None = None
    name: str | None = None


@dataclass
class SolarSystem:
    platform: str
    entry_id: str
    title: str
    roles: dict[str, Any] = field(default_factory=dict)
    battery: dict[str, Any] = field(default_factory=dict)
    panels: list[Panel] = field(default_factory=list)
    gateway: str | None = None
    diagnostics: list[str] = field(default_factory=list)
    # "no_live_data": a PVS without the live data sensors turned on
    notes: list[str] = field(default_factory=list)

    @property
    def label(self) -> str:
        return SOLAR_PLATFORMS.get(self.platform, self.platform)


@dataclass
class CarDevice:
    device_id: str
    name: str
    platform: str
    roles: dict[str, str] = field(default_factory=dict)
    controls: list[str] = field(default_factory=list)

    @property
    def label(self) -> str:
        return f"{self.name} ({CAR_PLATFORMS.get(self.platform, self.platform)})"


# ---- registry helpers ----


def _enabled(entries: Iterable[er.RegistryEntry]) -> list[er.RegistryEntry]:
    return [e for e in entries if e.disabled_by is None]


def _uid_has(entry: er.RegistryEntry, key: str) -> bool:
    uid = str(entry.unique_id)
    return uid == key or uid.endswith((f"_{key}", f"-{key}"))


def _match(
    entries: Sequence[er.RegistryEntry], keys: Sequence[str], domain: str = "sensor"
) -> er.RegistryEntry | None:
    """First entry matching a key, trying keys in order."""
    for key in keys:
        for e in entries:
            if e.domain == domain and e.translation_key == key:
                return e
        for e in entries:
            if e.domain == domain and _uid_has(e, key):
                return e
    return None


def _find(entries: Sequence[er.RegistryEntry], *keys: str, domain: str = "sensor") -> str | None:
    found = _match(_enabled(entries), keys, domain)
    return found.entity_id if found else None


def _has(entries: Sequence[er.RegistryEntry], *keys: str) -> bool:
    return _match(entries, keys) is not None


def _device_class(entry: er.RegistryEntry) -> str | None:
    return entry.device_class or entry.original_device_class


def _by_device(entries: Iterable[er.RegistryEntry]) -> dict[str, list[er.RegistryEntry]]:
    out: dict[str, list[er.RegistryEntry]] = {}
    for e in entries:
        if e.device_id:
            out.setdefault(e.device_id, []).append(e)
    return out


def _device_name(hass: HomeAssistant, device_id: str | None) -> str | None:
    device = dr.async_get(hass).async_get(device_id) if device_id else None
    return (device.name_by_user or device.name) if device else None


def _put(target: dict[str, Any], key: str, value: Any) -> None:
    if value is not None:
        target[key] = value


def _serial(entries: Sequence[er.RegistryEntry], key: str) -> str:
    """Unique ids look like '<serial>_<key>' or '<serial>_pvs_<key>'."""
    found = _match(entries, (key,))
    if found is None:
        return ""
    uid = str(found.unique_id)
    uid = uid[: -len(key)].rstrip("_-")
    return uid.removesuffix("_pvs")


def _panel(
    hass: HomeAssistant,
    entries: Sequence[er.RegistryEntry],
    power_keys: Sequence[str],
    lifetime_keys: Sequence[str],
) -> Panel | None:
    power = _find(entries, *power_keys)
    if power is None:
        power = next(
            (
                e.entity_id
                for e in _enabled(entries)
                if e.domain == "sensor" and _device_class(e) == "power"
            ),
            None,
        )
    if power is None:
        return None
    return Panel(
        power=power,
        lifetime=_find(entries, *lifetime_keys),
        last_reported=_find(entries, "last_reported"),
        name=_device_name(hass, entries[0].device_id),
    )


# ---- solar platforms ----


def _pvs(hass: HomeAssistant, system: SolarSystem, entries: list[er.RegistryEntry]) -> None:
    """SunStrong pvs-hass. Prefer the live data sensors, fall back to the meters.

    The production meter's lifetime_energy can sit at 0, so solar energy
    comes from its net_lifetime_energy.
    """
    live: list[er.RegistryEntry] = []
    prod: list[er.RegistryEntry] = []
    cons: list[er.RegistryEntry] = []
    ess: list[er.RegistryEntry] = []
    gateway: list[er.RegistryEntry] = []
    meters: list[list[er.RegistryEntry]] = []
    for ents in _by_device(entries).values():
        if any("_livedata_" in str(e.unique_id) for e in ents):
            live = ents
        elif _has(ents, "net_lte_kwh"):
            meters.append(ents)
        elif _has(ents, "soc_val", "customer_soc_val"):
            ess = ents
        elif _has(ents, "current_power_production"):
            if panel := _panel(hass, ents, ("current_power_production",), ("lifetime_production",)):
                system.panels.append(panel)
        elif _has(ents, "gateway_uptime"):
            gateway = ents
    for ents in meters:
        tail = _serial(ents, "net_lte_kwh").lower()[-1:]
        if tail == "p":
            prod = ents
        elif tail == "c" or not cons:
            cons = ents

    roles = system.roles
    live_solar = _find(live, "live_production_power")
    live_grid = _find(live, "live_net_consumption_power")
    meter_solar = _find(prod, "power_3ph_kw")
    meter_grid = _find(cons, "power_3ph_kw")
    _put(roles, CONF_SOLAR_POWER, live_solar or meter_solar)
    if live_solar and meter_solar:
        roles[CONF_SOLAR_POWER_FALLBACK] = meter_solar
    _put(roles, CONF_GRID_POWER, live_grid or meter_grid)
    if live_grid and meter_grid:
        roles[CONF_GRID_POWER_FALLBACK] = meter_grid
    _put(roles, CONF_HOME_POWER, _find(live, "live_site_load_power"))
    _put(
        roles,
        CONF_SOLAR_ENERGY,
        _find(prod, "net_lte_kwh") or _find(live, "live_production_energy"),
    )
    _put(roles, CONF_IMPORT_ENERGY, _find(cons, "pos_lte_kwh"))
    _put(roles, CONF_EXPORT_ENERGY, _find(cons, "neg_lte_kwh"))
    roles[CONF_GRID_POSITIVE_IS_IMPORT] = True
    if not live_solar and not live_grid:
        system.notes.append("no_live_data")

    if ess:
        bat = system.battery
        _put(
            bat,
            CONF_BATTERY_SOC,
            _find(live, "live_battery_soc") or _find(ess, "customer_soc_val", "soc_val"),
        )
        _put(
            bat,
            CONF_BATTERY_POWER,
            _find(live, "live_battery_power") or _find(ess, "power_3ph_kw"),
        )

    system.gateway = _find(gateway, "gateway_uptime")
    system.diagnostics = [
        e
        for e in (
            _find(gateway, key)
            for key in ("cpu_usage", "ram_usage", "flash_usage", "flashwear_type_b", "sw_version")
        )
        if e
    ]


def _sunpower(hass: HomeAssistant, system: SolarSystem, entries: list[er.RegistryEntry]) -> None:
    """krbaker hass-sunpower and smcneece ha-esunpower share the 'sunpower' domain."""
    prod: list[er.RegistryEntry] = []
    cons: list[er.RegistryEntry] = []
    pvs: list[er.RegistryEntry] = []
    meters: list[list[er.RegistryEntry]] = []
    battery: list[er.RegistryEntry] = []
    for ents in _by_device(entries).values():
        if _has(ents, "net_ltea_3phsum_kwh"):
            meters.append(ents)
        elif _has(ents, "ltea_3phsum_kwh") and _has(ents, "p_3phsum_kw"):
            if panel := _panel(hass, ents, ("p_3phsum_kw",), ("ltea_3phsum_kwh",)):
                system.panels.append(panel)
        elif _has(ents, "dl_uptime"):
            pvs = ents
        if _has(ents, "customer_state_of_charge", "sunvault_power", "agg_power"):
            battery.extend(ents)
    for ents in meters:
        tail = _serial(ents, "net_ltea_3phsum_kwh").lower()[-1:]
        if tail == "p":
            prod = ents
        elif tail == "c" or not cons:
            cons = ents

    roles = system.roles
    _put(roles, CONF_SOLAR_POWER, _find(prod, "p_3phsum_kw"))
    _put(roles, CONF_GRID_POWER, _find(cons, "p_3phsum_kw"))
    _put(roles, CONF_SOLAR_ENERGY, _find(prod, "net_ltea_3phsum_kwh"))
    _put(roles, CONF_IMPORT_ENERGY, _find(cons, "pos_ltea_3phsum_kwh"))
    _put(roles, CONF_EXPORT_ENERGY, _find(cons, "neg_ltea_3phsum_kwh"))
    roles[CONF_GRID_POSITIVE_IS_IMPORT] = True

    if battery:
        _put(
            system.battery,
            CONF_BATTERY_SOC,
            _find(battery, "sunvault_customer_state_of_charge", "customer_state_of_charge"),
        )
        _put(system.battery, CONF_BATTERY_POWER, _find(battery, "sunvault_power", "agg_power"))

    system.gateway = _find(pvs, "dl_uptime")
    system.diagnostics = [
        e
        for e in (
            _find(pvs, key)
            for key in ("dl_cpu_load", "dl_mem_used", "dl_flash_avail", "dl_err_count")
        )
        if e
    ]


def _enphase(hass: HomeAssistant, system: SolarSystem, entries: list[er.RegistryEntry]) -> None:
    registry = dr.async_get(hass)
    site: list[er.RegistryEntry] = []
    for device_id, ents in _by_device(entries).items():
        device = registry.async_get(device_id)
        if device is not None and (device.model or "").lower() == "inverter":
            if panel := _panel(hass, ents, (), ("lifetime_energy",)):
                system.panels.append(panel)
        else:
            site.extend(ents)
    roles = system.roles
    _put(roles, CONF_SOLAR_POWER, _find(site, "current_power_production"))
    _put(roles, CONF_GRID_POWER, _find(site, "net_consumption", "balanced_net_consumption"))
    _put(roles, CONF_HOME_POWER, _find(site, "current_power_consumption"))
    _put(roles, CONF_SOLAR_ENERGY, _find(site, "lifetime_production"))
    _put(roles, CONF_IMPORT_ENERGY, _find(site, "lifetime_net_consumption"))
    _put(roles, CONF_EXPORT_ENERGY, _find(site, "lifetime_net_production"))
    roles[CONF_GRID_POSITIVE_IS_IMPORT] = True
    _put(system.battery, CONF_BATTERY_SOC, _find(site, "battery_level"))
    _put(system.battery, CONF_BATTERY_POWER, _find(site, "battery_discharge"))


def _powerwall(_hass: HomeAssistant, system: SolarSystem, entries: list[er.RegistryEntry]) -> None:
    roles = system.roles
    _put(roles, CONF_SOLAR_POWER, _find(entries, "solar_instant_power"))
    _put(roles, CONF_GRID_POWER, _find(entries, "site_instant_power"))
    _put(roles, CONF_HOME_POWER, _find(entries, "load_instant_power"))
    _put(roles, CONF_SOLAR_ENERGY, _find(entries, "solar_export"))
    _put(roles, CONF_IMPORT_ENERGY, _find(entries, "site_import"))
    _put(roles, CONF_EXPORT_ENERGY, _find(entries, "site_export"))
    roles[CONF_GRID_POSITIVE_IS_IMPORT] = True
    _put(system.battery, CONF_BATTERY_SOC, _find(entries, "charge"))
    _put(system.battery, CONF_BATTERY_POWER, _find(entries, "battery_instant_power"))


def _solaredge(_hass: HomeAssistant, system: SolarSystem, entries: list[er.RegistryEntry]) -> None:
    roles = system.roles
    _put(roles, CONF_SOLAR_POWER, _find(entries, "solar_power", "current_power"))
    _put(roles, CONF_GRID_POWER, _find(entries, "grid_power"))
    _put(roles, CONF_HOME_POWER, _find(entries, "power_consumption"))
    _put(roles, CONF_SOLAR_ENERGY, _find(entries, "lifetime_energy"))
    _put(roles, CONF_IMPORT_ENERGY, _find(entries, "purchased_energy"))
    _put(roles, CONF_EXPORT_ENERGY, _find(entries, "feedin_energy"))
    roles[CONF_GRID_POSITIVE_IS_IMPORT] = True
    _put(system.battery, CONF_BATTERY_SOC, _find(entries, "storage_level"))
    _put(system.battery, CONF_BATTERY_POWER, _find(entries, "storage_power"))


def _fronius(_hass: HomeAssistant, system: SolarSystem, entries: list[er.RegistryEntry]) -> None:
    roles = system.roles
    _put(roles, CONF_SOLAR_POWER, _find(entries, "power_photovoltaics"))
    _put(roles, CONF_GRID_POWER, _find(entries, "power_grid"))
    _put(roles, CONF_HOME_POWER, _find(entries, "power_load_consumed"))
    _put(roles, CONF_SOLAR_ENERGY, _find(entries, "energy_total"))
    _put(roles, CONF_IMPORT_ENERGY, _find(entries, "energy_real_consumed"))
    _put(roles, CONF_EXPORT_ENERGY, _find(entries, "energy_real_produced"))
    roles[CONF_GRID_POSITIVE_IS_IMPORT] = True
    _put(system.battery, CONF_BATTERY_SOC, _find(entries, "state_of_charge"))
    _put(system.battery, CONF_BATTERY_POWER, _find(entries, "power_battery"))


_DETECTORS = {
    "sunstrong_pvs": _pvs,
    "sunpower": _sunpower,
    "enphase_envoy": _enphase,
    "powerwall": _powerwall,
    "solaredge": _solaredge,
    "fronius": _fronius,
}


def detect_solar(hass: HomeAssistant) -> list[SolarSystem]:
    """One entry per solar integration config entry that has entities."""
    registry = er.async_get(hass)
    found: list[SolarSystem] = []
    for platform, detector in _DETECTORS.items():
        for entry in hass.config_entries.async_entries(platform):
            entries = er.async_entries_for_config_entry(registry, entry.entry_id)
            if not entries:
                continue
            system = SolarSystem(platform=platform, entry_id=entry.entry_id, title=entry.title)
            detector(hass, system, entries)
            if system.battery:
                # every detector above reports battery power as positive = discharging
                system.battery[CONF_BATTERY_POSITIVE_IS_DISCHARGE] = True
            if system.roles.get(CONF_SOLAR_POWER) or system.roles.get(CONF_SOLAR_ENERGY):
                found.append(system)
    return found


# ---- panels ----


def panel_details(hass: HomeAssistant, power_entity: str) -> Panel:
    """Lifetime and last-reported sensors from the same device as a panel's power sensor."""
    registry = er.async_get(hass)
    entry = registry.async_get(power_entity)
    panel = Panel(power=power_entity)
    if entry is None or entry.device_id is None:
        return panel
    others = _enabled(
        e
        for e in er.async_entries_for_device(registry, entry.device_id)
        if e.entity_id != power_entity and e.domain == "sensor"
    )
    panel.lifetime = next(
        (e.entity_id for e in others if _device_class(e) == "energy"),
        None,
    )
    panel.last_reported = next(
        (
            e.entity_id
            for e in others
            if _device_class(e) == "timestamp" and "last_report" in _text(e)
        ),
        None,
    )
    return panel


# ---- cars ----


def _text(entry: er.RegistryEntry) -> str:
    parts = (
        entry.translation_key,
        str(entry.unique_id),
        entry.original_name,
        entry.entity_id.split(".", 1)[1],
    )
    return " ".join(p for p in parts if p).lower()


def _first(
    entries: Sequence[er.RegistryEntry],
    domains: Sequence[str],
    *,
    device_class: str | None = None,
    want: Sequence[str] = (),
    avoid: Sequence[str] = (),
) -> str | None:
    """First entity in the given domains (in order) that fits.

    want: the text must contain one of these; earlier words win.
    """
    for domain in domains:
        pool = [
            e
            for e in entries
            if e.domain == domain
            and (device_class is None or _device_class(e) == device_class)
            and not any(word in _text(e) for word in avoid)
        ]
        if not want:
            if pool:
                return pool[0].entity_id
            continue
        for word in want:
            for e in pool:
                if word in _text(e):
                    return e.entity_id
    return None


def _car_roles(entries: Sequence[er.RegistryEntry]) -> dict[str, str]:
    roles: dict[str, str] = {}
    not_charging = ("schedul", "cable", "port", "heater", "precondition", "fast", "limit")
    _put(
        roles,
        CONF_CAR_BATTERY,
        _first(
            entries,
            ("sensor",),
            device_class="battery",
            want=("battery_level", "state_of_charge", "soc", "battery"),
            avoid=("limit", "reserve", "usable", "target"),
        )
        or _first(
            entries,
            ("sensor",),
            device_class="battery",
            avoid=("limit", "reserve", "usable", "target"),
        ),
    )
    _put(
        roles,
        CONF_CAR_CHARGING,
        _first(entries, ("binary_sensor",), device_class="battery_charging", avoid=not_charging)
        or _first(entries, ("binary_sensor",), want=("charging",), avoid=not_charging)
        or _first(
            entries,
            ("sensor",),
            want=("charging_state", "charging_status", "charger_state", "charging"),
            avoid=("power", "rate", "speed", "time", "energy", "current", "voltage", "limit"),
        ),
    )
    _put(
        roles,
        CONF_CAR_PLUGGED,
        _first(entries, ("binary_sensor",), device_class="plug")
        or _first(
            entries,
            ("binary_sensor",),
            want=("plug", "cable", "charger_connection", "vehicle_connected", "connected"),
            avoid=("schedul",),
        ),
    )
    _put(
        roles,
        CONF_CAR_POWER,
        _first(
            entries,
            ("sensor",),
            device_class="power",
            want=("charger_power", "charging_power", "charge_power", "charging_speed", "charg"),
        )
        or _first(entries, ("sensor",), device_class="power"),
    )
    _put(
        roles,
        CONF_CAR_LIMIT,
        _first(entries, ("sensor", "number"), want=("charge_limit", "limit_soc", "battery_limit"))
        or _first(entries, ("sensor", "number"), want=("limit",), avoid=("current", "amp")),
    )
    _put(
        roles,
        CONF_CAR_PRESENCE,
        _first(entries, ("device_tracker",), want=("location",), avoid=("route", "destination"))
        or _first(entries, ("device_tracker",), avoid=("route", "destination")),
    )
    return roles


def car_controls(hass: HomeAssistant, device_id: str | None) -> list[str]:
    """Enabled entities on a car's device that can change something on the car."""
    if not device_id:
        return []
    registry = er.async_get(hass)
    return sorted(
        e.entity_id
        for e in _enabled(er.async_entries_for_device(registry, device_id))
        if e.domain in CONTROL_DOMAINS
    )


def detect_cars(hass: HomeAssistant) -> list[CarDevice]:
    """Car and charger devices from known integrations, with their roles guessed."""
    registry = er.async_get(hass)
    found: list[CarDevice] = []
    for platform in CAR_PLATFORMS:
        for entry in hass.config_entries.async_entries(platform):
            entries = er.async_entries_for_config_entry(registry, entry.entry_id)
            for device_id, ents in _by_device(_enabled(entries)).items():
                roles = _car_roles(ents)
                if not any(
                    k in roles for k in (CONF_CAR_BATTERY, CONF_CAR_CHARGING, CONF_CAR_PLUGGED)
                ):
                    continue
                found.append(
                    CarDevice(
                        device_id=device_id,
                        name=_device_name(hass, device_id) or entry.title,
                        platform=platform,
                        roles=roles,
                        controls=car_controls(hass, device_id),
                    )
                )
    return found


def installed_car_platforms(hass: HomeAssistant) -> set[str]:
    return {p for p in CAR_PLATFORMS if hass.config_entries.async_entries(p)}


def missing_car_links(hass: HomeAssistant) -> list[tuple[str, str]]:
    """(label, url) for brands with none of their integrations set up."""
    installed = installed_car_platforms(hass)
    return [(label, url) for label, url, domains in CAR_LINKS if not installed & set(domains)]
