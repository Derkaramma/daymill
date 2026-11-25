"""Setup wizard and options for SunFlow Solar.

Setup: welcome (pick a detected system, set it up by hand, or use demo
data) -> sources -> panels -> battery -> cars -> rates (-> NEM 3.0) ->
finish. Demo data skips straight to rates.

Options: a menu that opens any one of those pages and saves the whole
config into entry.options, which the coordinator prefers over entry.data.
"""

from __future__ import annotations

import copy
import logging
from collections.abc import Mapping
from typing import Any

import voluptuous as vol
from homeassistant.components.sensor import SensorDeviceClass
from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlowWithReload,
)
from homeassistant.const import ATTR_UNIT_OF_MEASUREMENT
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.selector import (
    BooleanSelector,
    DateSelector,
    EntitySelector,
    EntitySelectorConfig,
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
    TextSelector,
)
from homeassistant.util import slugify

from . import detection
from .const import (
    ACC_PLUS_OPTIONS,
    CAR_IMAGES,
    CAR_ROLES,
    CONF_ACC_PLUS_CLASS,
    CONF_ARECR,
    CONF_BATTERY_POSITIVE_IS_DISCHARGE,
    CONF_BATTERY_POWER,
    CONF_BATTERY_SOC,
    CONF_CAR_BATTERY,
    CONF_CAR_CHARGING,
    CONF_CAR_DEVICE,
    CONF_CAR_IMAGE,
    CONF_CAR_LIMIT,
    CONF_CAR_NAME,
    CONF_CAR_PLUGGED,
    CONF_CAR_POWER,
    CONF_CAR_PRESENCE,
    CONF_CARS,
    CONF_CYCLE_DAY,
    CONF_EXPORT_ENERGY,
    CONF_GATEWAY,
    CONF_GATEWAY_DIAGNOSTICS,
    CONF_GRID_POSITIVE_IS_IMPORT,
    CONF_GRID_POWER,
    CONF_GRID_POWER_FALLBACK,
    CONF_HOME_POWER,
    CONF_IMPORT_ENERGY,
    CONF_MAX_AGE,
    CONF_NEM,
    CONF_NSC_OPT_IN,
    CONF_NSC_RATE,
    CONF_PANEL_FACING,
    CONF_PANEL_LABEL,
    CONF_PANEL_LAST_REPORTED,
    CONF_PANEL_LIFETIME,
    CONF_PANEL_LIST,
    CONF_PANEL_POWER,
    CONF_PANELS,
    CONF_PTO_DATE,
    CONF_SOLAR_ENERGY,
    CONF_SOLAR_POWER,
    CONF_SOLAR_POWER_FALLBACK,
    CONF_SOURCE,
    CONF_SYSTEM,
    CONF_TARIFF,
    CONF_TRACK_COST,
    DEFAULT_ACC_PLUS_CLASS,
    DEFAULT_BATTERY_POSITIVE_IS_DISCHARGE,
    DEFAULT_CAR_IMAGE,
    DEFAULT_CYCLE_DAY,
    DEFAULT_GRID_POSITIVE_IS_IMPORT,
    DEFAULT_MAX_AGE,
    DEFAULT_NEM,
    DEFAULT_TARIFF,
    DEFAULT_TRACK_COST,
    DOMAIN,
    MAX_ROOF_FACES,
    NAME,
    NEM3_KEYS,
    NEM_OPTIONS,
    SOURCE_DEMO,
    SOURCE_ENTITIES,
    SYSTEM_CUSTOM,
)
from .coordinator import build_engine, entry_config
from .frontend import async_create_dashboard
from .sources import ENERGY_UNITS, POWER_UNITS
from .tariff import TariffError, list_presets

_LOGGER = logging.getLogger(__name__)

PVS_URL = "https://github.com/SunStrong-Management/pvs-hass"
INTEGRATIONS_URL = "https://www.home-assistant.io/integrations/#energy"
ENERGY_URL = "https://my.home-assistant.io/redirect/config_energy/"

CHOICE_CUSTOM = SYSTEM_CUSTOM
CHOICE_DEMO = "demo"
CHOICE_MANUAL = "manual"

# form fields that are not stored as-is
CONF_CHOICE = "system"
CONF_FACES = "roof_faces"
CONF_FACE_PANELS = "panels"
CONF_CAR_PICK = "car"
CONF_CAR_REMOVE = "cars"
CONF_CREATE_DASHBOARD = "create_dashboard"

REQUIRED_ENTITIES = (
    CONF_SOLAR_POWER,
    CONF_GRID_POWER,
    CONF_SOLAR_ENERGY,
    CONF_IMPORT_ENERGY,
    CONF_EXPORT_ENERGY,
)
OPTIONAL_ENTITIES = (CONF_SOLAR_POWER_FALLBACK, CONF_GRID_POWER_FALLBACK, CONF_HOME_POWER)
SOURCE_KEYS = (*REQUIRED_ENTITIES, *OPTIONAL_ENTITIES, CONF_GRID_POSITIVE_IS_IMPORT, CONF_MAX_AGE)
POWER_ENTITIES = (
    CONF_SOLAR_POWER,
    CONF_SOLAR_POWER_FALLBACK,
    CONF_GRID_POWER,
    CONF_GRID_POWER_FALLBACK,
    CONF_HOME_POWER,
)
ENERGY_ENTITIES = (CONF_SOLAR_ENERGY, CONF_IMPORT_ENERGY, CONF_EXPORT_ENERGY)
BATTERY_KEYS = (CONF_BATTERY_SOC, CONF_BATTERY_POWER, CONF_BATTERY_POSITIVE_IS_DISCHARGE)
RATE_KEYS = (CONF_TARIFF, CONF_NEM, CONF_CYCLE_DAY, CONF_TRACK_COST)
# SunFlow itself only needs to know when the car charges; the rest is shown
# on the cards when it's there.
REQUIRED_CAR_ROLES = (CONF_CAR_CHARGING,)
PERCENT_UNITS = frozenset({"%"})

_POWER = EntitySelector(EntitySelectorConfig(domain="sensor", device_class=SensorDeviceClass.POWER))
# Hand-picked sensors may be templates or helpers without a device class.
# The unit is still checked on submit.
_ANY_SENSOR = EntitySelector(EntitySelectorConfig(domain="sensor"))
_POWER_MANY = EntitySelector(
    EntitySelectorConfig(domain="sensor", device_class=SensorDeviceClass.POWER, multiple=True)
)
_ENERGY = EntitySelector(
    EntitySelectorConfig(domain="sensor", device_class=SensorDeviceClass.ENERGY)
)
_SOC = EntitySelector(EntitySelectorConfig(domain="sensor", device_class=SensorDeviceClass.BATTERY))
_GATEWAY = EntitySelector(EntitySelectorConfig(domain=["sensor", "binary_sensor"]))
_DIAGNOSTICS = EntitySelector(
    EntitySelectorConfig(domain=["sensor", "binary_sensor"], multiple=True)
)
_PRESENCE = EntitySelector(EntitySelectorConfig(domain=["device_tracker", "person"]))
_ON_OFF = EntitySelector(EntitySelectorConfig(domain=["binary_sensor", "sensor"]))
_LIMIT = EntitySelector(EntitySelectorConfig(domain=["sensor", "number"]))
_RATE = NumberSelector(NumberSelectorConfig(min=0, max=5, step="any", mode=NumberSelectorMode.BOX))
_TEXT = TextSelector()

_TIPS = {
    "": "",
    "pvs": (
        "**Tip:** turn on **live data** in the PVS integration's options for updates every "
        "few seconds, and keep its polling at 15 seconds or more."
    ),
    "pvs_live": "Live data is on. The meter sensors take over when it stops updating.",
}


def _suggest(value: Any) -> dict[str, Any]:
    return {"suggested_value": value} if value not in (None, "", []) else {}


def _select(options: list[SelectOptionDict] | list[str], **kwargs: Any) -> SelectSelector:
    return SelectSelector(
        SelectSelectorConfig(options=options, mode=SelectSelectorMode.DROPDOWN, **kwargs)
    )


def _unit_ok(hass: HomeAssistant, entity_id: str | None, units: frozenset[str]) -> bool:
    """False only when the entity exists and its unit is not one we can use."""
    state = hass.states.get(entity_id) if entity_id else None
    if state is None:
        return True
    unit = state.attributes.get(ATTR_UNIT_OF_MEASUREMENT)
    return isinstance(unit, str) and unit.strip().lower() in units


def _clean_nem3(user_input: Mapping[str, Any]) -> dict[str, Any]:
    return {k: user_input[k] for k in NEM3_KEYS if user_input.get(k) not in (None, "")}


def _bullets(items: list[str], empty: str) -> str:
    return "\n".join(f"- `{i}`" for i in items) if items else empty


def _car_label(index: int, car: Mapping[str, Any]) -> str:
    return str(car.get(CONF_CAR_NAME) or f"Car {index + 1}")


# ---- schemas ----


def _sources_schema(current: Mapping[str, Any], strict: bool = True) -> vol.Schema:
    def entity(key: str, selector: EntitySelector) -> tuple[Any, EntitySelector]:
        marker = vol.Required if key in REQUIRED_ENTITIES else vol.Optional
        return marker(key, description=_suggest(current.get(key))), (
            selector if strict else _ANY_SENSOR
        )

    fields = dict(
        [
            entity(CONF_SOLAR_POWER, _POWER),
            entity(CONF_SOLAR_POWER_FALLBACK, _POWER),
            entity(CONF_GRID_POWER, _POWER),
            entity(CONF_GRID_POWER_FALLBACK, _POWER),
        ]
    )
    sign = bool(current.get(CONF_GRID_POSITIVE_IS_IMPORT, DEFAULT_GRID_POSITIVE_IS_IMPORT))
    fields[vol.Required(CONF_GRID_POSITIVE_IS_IMPORT, default=sign)] = BooleanSelector()
    fields.update(
        [
            entity(CONF_HOME_POWER, _POWER),
            entity(CONF_SOLAR_ENERGY, _ENERGY),
            entity(CONF_IMPORT_ENERGY, _ENERGY),
            entity(CONF_EXPORT_ENERGY, _ENERGY),
        ]
    )
    fields[vol.Required(CONF_MAX_AGE, default=current.get(CONF_MAX_AGE, DEFAULT_MAX_AGE))] = (
        NumberSelector(
            NumberSelectorConfig(
                min=30, max=3600, step=1, unit_of_measurement="s", mode=NumberSelectorMode.BOX
            )
        )
    )
    return vol.Schema(fields)


def _rates_schema(presets: Mapping[str, str], current: Mapping[str, Any]) -> vol.Schema:
    tariff = current.get(CONF_TARIFF)
    if tariff not in presets:
        tariff = DEFAULT_TARIFF if DEFAULT_TARIFF in presets else next(iter(presets), None)
    tariff_options = [SelectOptionDict(value=k, label=v) for k, v in presets.items()]
    return vol.Schema(
        {
            vol.Required(CONF_TARIFF, default=tariff): _select(tariff_options),
            vol.Required(CONF_NEM, default=current.get(CONF_NEM, DEFAULT_NEM)): _select(
                list(NEM_OPTIONS), translation_key=CONF_NEM
            ),
            vol.Required(
                CONF_CYCLE_DAY, default=current.get(CONF_CYCLE_DAY, DEFAULT_CYCLE_DAY)
            ): NumberSelector(
                NumberSelectorConfig(min=1, max=28, step=1, mode=NumberSelectorMode.BOX)
            ),
            vol.Required(
                CONF_TRACK_COST, default=bool(current.get(CONF_TRACK_COST, DEFAULT_TRACK_COST))
            ): BooleanSelector(),
        }
    )


def _nem3_schema(current: Mapping[str, Any]) -> vol.Schema:
    return vol.Schema(
        {
            vol.Optional(CONF_PTO_DATE, description=_suggest(current.get(CONF_PTO_DATE))): (
                DateSelector()
            ),
            vol.Required(
                CONF_ACC_PLUS_CLASS,
                default=current.get(CONF_ACC_PLUS_CLASS, DEFAULT_ACC_PLUS_CLASS),
            ): _select(list(ACC_PLUS_OPTIONS), translation_key=CONF_ACC_PLUS_CLASS),
            vol.Optional(CONF_ARECR, description=_suggest(current.get(CONF_ARECR))): _RATE,
            vol.Required(
                CONF_NSC_OPT_IN, default=bool(current.get(CONF_NSC_OPT_IN, False))
            ): BooleanSelector(),
            vol.Optional(CONF_NSC_RATE, description=_suggest(current.get(CONF_NSC_RATE))): _RATE,
        }
    )


def energy_guide(conf: Mapping[str, Any]) -> str:
    """What to pick in Settings > Dashboards > Energy, as markdown."""
    if conf.get(CONF_SOURCE) == SOURCE_DEMO:
        return (
            "You're on demo data, so skip the Energy dashboard for now. Once your solar "
            "is in Home Assistant, open SunFlow's **Configure** > **Power and energy "
            "sensors** to switch over."
        )
    cost = conf.get(CONF_TRACK_COST, DEFAULT_TRACK_COST)
    lines = [
        "1. **Solar production:** `sensor.sunflow_energy_produced`",
        "2. **Grid consumption:** `sensor.sunflow_energy_imported`"
        + (", with the cost entity `sensor.sunflow_import_cost`" if cost else ""),
        "3. **Return to grid:** `sensor.sunflow_energy_exported`"
        + (", with the compensation entity `sensor.sunflow_export_credit`" if cost else ""),
    ]
    if conf.get(CONF_BATTERY_POWER) or conf.get(CONF_BATTERY_SOC):
        lines.append(
            "4. **Home battery:** the lifetime charged and discharged energy sensors "
            "from your battery's own integration."
        )
    lines.append("\nIf an entity id ends in `_2` or similar on your system, pick that one instead.")
    return "\n".join(lines)


async def _create_dashboard(hass: HomeAssistant) -> str:
    """'created', 'exists' or 'failed'."""
    try:
        created = await async_create_dashboard(hass)
    except HomeAssistantError as err:
        _LOGGER.warning("Could not create the SunFlow dashboard: %s", err)
        return "failed"
    return "created" if created else "exists"


# ---- pages shared by setup and options ----


class _Steps:
    """Subclasses say where each page goes next through _after()."""

    hass: HomeAssistant
    _conf: dict[str, Any]

    def _init_state(self) -> None:
        self._systems: list[detection.SolarSystem] | None = None
        self._system: detection.SolarSystem | None = None
        self._faces: list[dict[str, Any]] = []
        self._face_count = 0
        self._car_devices: list[detection.CarDevice] | None = None
        self._car_device: detection.CarDevice | None = None
        self._car_index: int | None = None

    async def _after(self, step: str) -> ConfigFlowResult:
        raise NotImplementedError

    # ---- detection, cached for the life of the flow ----

    def _detected(self) -> list[detection.SolarSystem]:
        if self._systems is None:
            self._systems = detection.detect_solar(self.hass)
        return self._systems

    def _current_system(self) -> detection.SolarSystem | None:
        if self._system is None:
            platform = self._conf.get(CONF_SYSTEM)
            self._system = next((s for s in self._detected() if s.platform == platform), None)
        return self._system

    def _any_system(self) -> detection.SolarSystem | None:
        return self._current_system() or next(iter(self._detected()), None)

    def _cars_found(self) -> list[detection.CarDevice]:
        if self._car_devices is None:
            self._car_devices = detection.detect_cars(self.hass)
        return self._car_devices

    # ---- sources ----

    async def async_step_sources(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        system = self._current_system()
        if system is None and self._conf.get(CONF_SOURCE) == SOURCE_DEMO:
            # leaving demo mode: start from whatever solar is installed now
            system = self._system = next(iter(self._detected()), None)
        if user_input is not None:
            data = {k: v for k, v in user_input.items() if k in SOURCE_KEYS and v not in (None, "")}
            data[CONF_MAX_AGE] = int(data.get(CONF_MAX_AGE, DEFAULT_MAX_AGE))
            errors = self._check_sources(data)
            if not errors:
                for key in OPTIONAL_ENTITIES:
                    self._conf.pop(key, None)
                self._conf.update(data)
                self._conf[CONF_SOURCE] = SOURCE_ENTITIES
                if self._conf.get(CONF_SYSTEM) in (None, CHOICE_DEMO):
                    self._conf[CONF_SYSTEM] = system.platform if system else SYSTEM_CUSTOM
                return await self._after("sources")
            current: Mapping[str, Any] = user_input
        elif self._conf.get(CONF_SOLAR_POWER):
            current = self._conf
        else:
            current = {**self._conf, **(system.roles if system else {})}

        tip = ""
        if system and system.platform == "sunstrong_pvs":
            tip = "pvs" if "no_live_data" in system.notes else "pvs_live"
        return self.async_show_form(  # type: ignore[attr-defined]
            step_id="sources",
            data_schema=_sources_schema(current, strict=system is not None),
            errors=errors,
            description_placeholders={
                "system": system.label if system else "-",
                "tip": _TIPS[tip],
            },
        )

    def _check_sources(self, data: Mapping[str, Any]) -> dict[str, str]:
        errors: dict[str, str] = {}
        for key in POWER_ENTITIES:
            if not _unit_ok(self.hass, data.get(key), POWER_UNITS):
                errors[key] = "bad_unit"
        for key in ENERGY_ENTITIES:
            if not _unit_ok(self.hass, data.get(key), ENERGY_UNITS):
                errors[key] = "bad_unit"
        for live, fallback in (
            (CONF_SOLAR_POWER, CONF_SOLAR_POWER_FALLBACK),
            (CONF_GRID_POWER, CONF_GRID_POWER_FALLBACK),
        ):
            if data.get(fallback) and data.get(fallback) == data.get(live):
                errors[fallback] = "same_as_live"
        energy = [data[k] for k in ENERGY_ENTITIES if data.get(k)]
        if len(set(energy)) != len(energy):
            errors["base"] = "energy_not_distinct"
        return errors

    # ---- panels ----

    async def async_step_panels(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        system = self._any_system()
        found = system.panels if system else []
        existing = self._conf.get(CONF_PANELS) or []
        if user_input is not None:
            self._face_count = int(user_input.get(CONF_FACES, 0))
            for key in (CONF_GATEWAY, CONF_GATEWAY_DIAGNOSTICS):
                if user_input.get(key):
                    self._conf[key] = user_input[key]
                else:
                    self._conf.pop(key, None)
            self._faces = []
            if self._face_count == 0:
                self._conf.pop(CONF_PANELS, None)
                return await self._after("panels")
            return await self.async_step_panel_face()

        if CONF_GATEWAY in self._conf or CONF_GATEWAY_DIAGNOSTICS in self._conf:
            gateway = self._conf.get(CONF_GATEWAY)
            diagnostics = self._conf.get(CONF_GATEWAY_DIAGNOSTICS) or []
        elif self._conf.get(CONF_PANELS):
            gateway, diagnostics = None, []
        else:
            gateway = system.gateway if system else None
            diagnostics = system.diagnostics if system else []
        faces = len(existing) if existing else (1 if found else 0)
        schema = vol.Schema(
            {
                vol.Required(CONF_FACES, default=faces): NumberSelector(
                    NumberSelectorConfig(
                        min=0, max=MAX_ROOF_FACES, step=1, mode=NumberSelectorMode.BOX
                    )
                ),
                vol.Optional(CONF_GATEWAY, description=_suggest(gateway)): _GATEWAY,
                vol.Optional(CONF_GATEWAY_DIAGNOSTICS, description=_suggest(diagnostics)): (
                    _DIAGNOSTICS
                ),
            }
        )
        return self.async_show_form(  # type: ignore[attr-defined]
            step_id="panels",
            data_schema=schema,
            description_placeholders={"count": str(len(found))},
        )

    async def async_step_panel_face(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        index = len(self._faces)
        existing = self._conf.get(CONF_PANELS) or []
        old = existing[index] if index < len(existing) else {}
        errors: dict[str, str] = {}
        if user_input is not None:
            chosen: list[str] = list(user_input.get(CONF_FACE_PANELS) or [])
            used = {p[CONF_PANEL_POWER] for f in self._faces for p in f[CONF_PANEL_LIST]}
            if not chosen:
                errors[CONF_FACE_PANELS] = "no_panels"
            elif used & set(chosen) or len(set(chosen)) != len(chosen):
                errors[CONF_FACE_PANELS] = "panel_used_twice"
            elif not all(_unit_ok(self.hass, e, POWER_UNITS) for e in chosen):
                errors[CONF_FACE_PANELS] = "bad_unit"
            if not errors:
                label = str(user_input.get(CONF_PANEL_LABEL) or "").strip()
                face: dict[str, Any] = {
                    CONF_PANEL_LABEL: label or f"Roof {index + 1}",
                    CONF_PANEL_LIST: [self._panel_entry(e) for e in chosen],
                }
                if facing := str(user_input.get(CONF_PANEL_FACING) or "").strip():
                    face[CONF_PANEL_FACING] = facing
                self._faces.append(face)
                if len(self._faces) < self._face_count:
                    return await self.async_step_panel_face()
                self._conf[CONF_PANELS] = self._faces
                return await self._after("panels")
            current: Mapping[str, Any] = user_input
        else:
            old_panels = [p.get(CONF_PANEL_POWER) for p in old.get(CONF_PANEL_LIST) or []]
            current = {
                CONF_PANEL_LABEL: old.get(CONF_PANEL_LABEL) or f"Roof {index + 1}",
                CONF_PANEL_FACING: old.get(CONF_PANEL_FACING),
                CONF_FACE_PANELS: [p for p in old_panels if p] or self._panel_suggestion(index),
            }
        schema = vol.Schema(
            {
                vol.Required(
                    CONF_PANEL_LABEL, description=_suggest(current.get(CONF_PANEL_LABEL))
                ): _TEXT,
                vol.Optional(
                    CONF_PANEL_FACING, description=_suggest(current.get(CONF_PANEL_FACING))
                ): _TEXT,
                vol.Required(
                    CONF_FACE_PANELS, description=_suggest(current.get(CONF_FACE_PANELS))
                ): _POWER_MANY,
            }
        )
        return self.async_show_form(  # type: ignore[attr-defined]
            step_id="panel_face",
            data_schema=schema,
            errors=errors,
            description_placeholders={"number": str(index + 1), "total": str(self._face_count)},
        )

    def _panel_suggestion(self, index: int) -> list[str]:
        """The last face gets every found panel not picked yet."""
        if index != self._face_count - 1:
            return []
        system = self._any_system()
        found = [p.power for p in system.panels] if system else []
        used = {p[CONF_PANEL_POWER] for f in self._faces for p in f[CONF_PANEL_LIST]}
        return [p for p in found if p not in used]

    def _panel_entry(self, power: str) -> dict[str, Any]:
        system = self._any_system()
        known = next((p for p in system.panels if p.power == power), None) if system else None
        panel = known or detection.panel_details(self.hass, power)
        out: dict[str, Any] = {CONF_PANEL_POWER: power}
        if panel.lifetime:
            out[CONF_PANEL_LIFETIME] = panel.lifetime
        if panel.last_reported:
            out[CONF_PANEL_LAST_REPORTED] = panel.last_reported
        return out

    # ---- battery ----

    async def async_step_battery(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            if not _unit_ok(self.hass, user_input.get(CONF_BATTERY_POWER), POWER_UNITS):
                errors[CONF_BATTERY_POWER] = "bad_unit"
            if not _unit_ok(self.hass, user_input.get(CONF_BATTERY_SOC), PERCENT_UNITS):
                errors[CONF_BATTERY_SOC] = "bad_unit_percent"
            if not errors:
                for key in BATTERY_KEYS:
                    self._conf.pop(key, None)
                if user_input.get(CONF_BATTERY_SOC) or user_input.get(CONF_BATTERY_POWER):
                    for key in BATTERY_KEYS:
                        if user_input.get(key) not in (None, ""):
                            self._conf[key] = user_input[key]
                return await self._after("battery")
            current: Mapping[str, Any] = user_input
        elif self._conf.get(CONF_BATTERY_SOC) or self._conf.get(CONF_BATTERY_POWER):
            current = self._conf
        else:
            current = next((s.battery for s in self._battery_systems()), {})

        sign = bool(
            current.get(CONF_BATTERY_POSITIVE_IS_DISCHARGE, DEFAULT_BATTERY_POSITIVE_IS_DISCHARGE)
        )
        schema = vol.Schema(
            {
                vol.Optional(
                    CONF_BATTERY_SOC, description=_suggest(current.get(CONF_BATTERY_SOC))
                ): _SOC,
                vol.Optional(
                    CONF_BATTERY_POWER, description=_suggest(current.get(CONF_BATTERY_POWER))
                ): _POWER,
                vol.Required(CONF_BATTERY_POSITIVE_IS_DISCHARGE, default=sign): BooleanSelector(),
            }
        )
        found = ", ".join(s.label for s in self._battery_systems())
        return self.async_show_form(  # type: ignore[attr-defined]
            step_id="battery",
            data_schema=schema,
            errors=errors,
            description_placeholders={"found": found or "-"},
        )

    def _battery_systems(self) -> list[detection.SolarSystem]:
        current = self._current_system()
        ordered = ([current] if current else []) + [s for s in self._detected() if s is not current]
        return [s for s in ordered if s.battery]

    # ---- cars ----

    def _cars(self) -> list[dict[str, Any]]:
        return self._conf.setdefault(CONF_CARS, [])

    async def async_step_cars(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        cars = self._cars()
        options = ["car_add"]
        if cars:
            options += ["car_edit", "car_remove"]
        options.append("cars_done")
        links = detection.missing_car_links(self.hass)
        found = sorted(
            detection.CAR_PLATFORMS[p] for p in detection.installed_car_platforms(self.hass)
        )
        return self.async_show_menu(  # type: ignore[attr-defined]
            step_id="cars",
            menu_options=options,
            description_placeholders={
                "cars": ", ".join(_car_label(i, c) for i, c in enumerate(cars)) or "-",
                "found": ", ".join(found) or "-",
                "links": "\n".join(f"- [{label}]({url})" for label, url in links) or "-",
            },
        )

    async def async_step_cars_done(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if not self._conf.get(CONF_CARS):
            self._conf.pop(CONF_CARS, None)
        return await self._after("cars")

    async def async_step_car_add(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        self._car_index = None
        used = {c.get(CONF_CAR_DEVICE) for c in self._cars()}
        devices = [d for d in self._cars_found() if d.device_id not in used]
        if user_input is not None:
            choice = user_input.get(CONF_CAR_PICK)
            self._car_device = next((d for d in devices if d.device_id == choice), None)
            return await self.async_step_car()
        self._car_device = None
        if not devices:
            return await self.async_step_car()
        options = [SelectOptionDict(value=d.device_id, label=d.label) for d in devices]
        options.append(SelectOptionDict(value=CHOICE_MANUAL, label="I'll pick the sensors myself"))
        return self.async_show_form(  # type: ignore[attr-defined]
            step_id="car_add",
            data_schema=vol.Schema(
                {vol.Required(CONF_CAR_PICK, default=devices[0].device_id): _select(options)}
            ),
        )

    async def async_step_car_edit(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        cars = self._cars()
        if user_input is not None:
            self._car_index = int(user_input[CONF_CAR_PICK])
            self._car_device = None
            return await self.async_step_car()
        options = [
            SelectOptionDict(value=str(i), label=_car_label(i, c)) for i, c in enumerate(cars)
        ]
        return self.async_show_form(  # type: ignore[attr-defined]
            step_id="car_edit",
            data_schema=vol.Schema({vol.Required(CONF_CAR_PICK, default="0"): _select(options)}),
        )

    async def async_step_car_remove(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        cars = self._cars()
        if user_input is not None:
            drop = {int(i) for i in user_input.get(CONF_CAR_REMOVE) or []}
            self._conf[CONF_CARS] = [c for i, c in enumerate(cars) if i not in drop]
            return await self.async_step_cars()
        options = [
            SelectOptionDict(value=str(i), label=_car_label(i, c)) for i, c in enumerate(cars)
        ]
        return self.async_show_form(  # type: ignore[attr-defined]
            step_id="car_remove",
            data_schema=vol.Schema(
                {
                    vol.Optional(CONF_CAR_REMOVE, default=[]): SelectSelector(
                        SelectSelectorConfig(
                            options=options, multiple=True, mode=SelectSelectorMode.LIST
                        )
                    )
                }
            ),
        )

    async def async_step_car(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        cars = self._cars()
        editing = cars[self._car_index] if self._car_index is not None else None
        device = self._car_device
        device_id = device.device_id if device else (editing or {}).get(CONF_CAR_DEVICE)
        errors: dict[str, str] = {}
        if user_input is not None:
            errors = self._check_car(user_input, cars)
            if not errors:
                car: dict[str, Any] = {
                    CONF_CAR_NAME: str(user_input[CONF_CAR_NAME]).strip(),
                    CONF_CAR_IMAGE: user_input.get(CONF_CAR_IMAGE) or DEFAULT_CAR_IMAGE,
                }
                if device_id:
                    car[CONF_CAR_DEVICE] = device_id
                car.update({k: user_input[k] for k in CAR_ROLES if user_input.get(k)})
                if self._car_index is None:
                    cars.append(car)
                else:
                    cars[self._car_index] = car
                self._car_index = None
                self._car_device = None
                return await self.async_step_cars()
            current: Mapping[str, Any] = user_input
        elif editing is not None:
            current = editing
        elif device is not None:
            current = {CONF_CAR_NAME: device.name, **device.roles}
        else:
            current = {CONF_CAR_NAME: f"Car {len(cars) + 1}"}

        def role(key: str, selector: EntitySelector) -> tuple[Any, EntitySelector]:
            marker = vol.Required if key in REQUIRED_CAR_ROLES else vol.Optional
            if device_id is None and selector in (_POWER, _SOC):
                selector = _ANY_SENSOR
            return marker(key, description=_suggest(current.get(key))), selector

        image = current.get(CONF_CAR_IMAGE) or DEFAULT_CAR_IMAGE
        schema = vol.Schema(
            dict(
                [
                    (
                        vol.Required(
                            CONF_CAR_NAME, description=_suggest(current.get(CONF_CAR_NAME))
                        ),
                        _TEXT,
                    ),
                    (
                        vol.Required(CONF_CAR_IMAGE, default=image),
                        _select(list(CAR_IMAGES), translation_key=CONF_CAR_IMAGE),
                    ),
                    role(CONF_CAR_PRESENCE, _PRESENCE),
                    role(CONF_CAR_CHARGING, _ON_OFF),
                    role(CONF_CAR_POWER, _POWER),
                    role(CONF_CAR_BATTERY, _SOC),
                    role(CONF_CAR_PLUGGED, _ON_OFF),
                    role(CONF_CAR_LIMIT, _LIMIT),
                ]
            )
        )
        controls = device.controls if device else detection.car_controls(self.hass, device_id)
        return self.async_show_form(  # type: ignore[attr-defined]
            step_id="car",
            data_schema=schema,
            errors=errors,
            description_placeholders={"controls": _bullets(controls, "None found.")},
        )

    def _check_car(
        self, user_input: Mapping[str, Any], cars: list[dict[str, Any]]
    ) -> dict[str, str]:
        errors: dict[str, str] = {}
        name = str(user_input.get(CONF_CAR_NAME) or "").strip()
        others = {
            slugify(str(c.get(CONF_CAR_NAME) or ""))
            for i, c in enumerate(cars)
            if i != self._car_index
        }
        if not slugify(name):
            errors[CONF_CAR_NAME] = "name_required"
        elif slugify(name) in others:
            errors[CONF_CAR_NAME] = "name_taken"
        if not _unit_ok(self.hass, user_input.get(CONF_CAR_POWER), POWER_UNITS):
            errors[CONF_CAR_POWER] = "bad_unit"
        if not _unit_ok(self.hass, user_input.get(CONF_CAR_BATTERY), PERCENT_UNITS):
            errors[CONF_CAR_BATTERY] = "bad_unit_percent"
        return errors

    # ---- rates ----

    async def async_step_rates(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        presets = await self.hass.async_add_executor_job(list_presets)
        if user_input is not None:
            data = {k: user_input[k] for k in RATE_KEYS if k in user_input}
            data[CONF_CYCLE_DAY] = int(data.get(CONF_CYCLE_DAY, DEFAULT_CYCLE_DAY))
            data[CONF_TRACK_COST] = bool(data.get(CONF_TRACK_COST, DEFAULT_TRACK_COST))
            try:
                await self.hass.async_add_executor_job(build_engine, data)
            except TariffError as err:
                _LOGGER.warning("Tariff check failed: %s", err)
                field = CONF_NEM if data.get(CONF_NEM) == "nem3" else CONF_TARIFF
                errors[field] = "tariff_invalid"
            if not errors:
                self._conf.update(data)
                if data[CONF_NEM] == "nem3":
                    return await self.async_step_nem3()
                for key in NEM3_KEYS:
                    self._conf.pop(key, None)
                return await self._after("rates")
            current: Mapping[str, Any] = user_input
        else:
            current = self._conf
        return self.async_show_form(  # type: ignore[attr-defined]
            step_id="rates", data_schema=_rates_schema(presets, current), errors=errors
        )

    async def async_step_nem3(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            for key in NEM3_KEYS:
                self._conf.pop(key, None)
            self._conf.update(_clean_nem3(user_input))
            return await self._after("rates")
        return self.async_show_form(  # type: ignore[attr-defined]
            step_id="nem3", data_schema=_nem3_schema(self._conf)
        )


# ---- setup ----


class SunFlowConfigFlow(_Steps, ConfigFlow, domain=DOMAIN):
    VERSION = 1

    def __init__(self) -> None:
        self._conf: dict[str, Any] = {}
        self._init_state()

    async def _after(self, step: str) -> ConfigFlowResult:
        nxt = {
            "sources": self.async_step_panels,
            "panels": self.async_step_battery,
            "battery": self.async_step_cars,
            "cars": self.async_step_rates,
            "rates": self.async_step_finish,
        }[step]
        return await nxt()

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if user_input is None:
            self._systems = None  # look again, the user may have just added something
        systems = self._detected()
        if not systems:
            return await self.async_step_no_solar()
        if user_input is not None:
            choice = user_input[CONF_CHOICE]
            if choice == CHOICE_DEMO:
                return await self.async_step_demo()
            if choice == CHOICE_CUSTOM:
                return await self.async_step_custom()
            self._system = next((s for s in systems if s.entry_id == choice), None)
            self._conf[CONF_SYSTEM] = self._system.platform if self._system else SYSTEM_CUSTOM
            return await self.async_step_sources()

        options = [
            SelectOptionDict(value=s.entry_id, label=f"{s.label}: {s.title}") for s in systems
        ]
        options.append(SelectOptionDict(value=CHOICE_CUSTOM, label="I'll pick the sensors myself"))
        options.append(SelectOptionDict(value=CHOICE_DEMO, label="Use demo data"))
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {vol.Required(CONF_CHOICE, default=systems[0].entry_id): _select(options)}
            ),
            description_placeholders={"found": ", ".join(s.label for s in systems)},
        )

    async def async_step_no_solar(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        return self.async_show_menu(
            step_id="no_solar",
            menu_options=["user", "custom", "demo"],
            description_placeholders={"pvs_url": PVS_URL, "integrations_url": INTEGRATIONS_URL},
        )

    async def async_step_custom(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        self._system = None
        self._conf[CONF_SYSTEM] = SYSTEM_CUSTOM
        return await self.async_step_sources()

    async def async_step_demo(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        self._conf = {CONF_SOURCE: SOURCE_DEMO, CONF_SYSTEM: CHOICE_DEMO}
        return await self.async_step_rates()

    async def async_step_finish(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            if user_input.get(CONF_CREATE_DASHBOARD):
                await _create_dashboard(self.hass)
            return self.async_create_entry(title=NAME, data=self._conf)
        return self.async_show_form(
            step_id="finish",
            data_schema=vol.Schema(
                {vol.Required(CONF_CREATE_DASHBOARD, default=True): BooleanSelector()}
            ),
            description_placeholders={"guide": energy_guide(self._conf), "energy_url": ENERGY_URL},
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> SunFlowOptionsFlow:
        return SunFlowOptionsFlow()


# ---- options ----


class SunFlowOptionsFlow(_Steps, OptionsFlowWithReload):
    """Edit one part at a time. Saving writes the full config to options."""

    def __init__(self) -> None:
        self._conf = {}
        self._init_state()

    async def _after(self, step: str) -> ConfigFlowResult:
        return self.async_create_entry(data=self._conf)

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        self._conf = copy.deepcopy(entry_config(self.config_entry))
        if self._conf.get(CONF_SOURCE) == SOURCE_DEMO:
            # the simulator brings its own panels, battery and cars
            options = ["sources", "rates", "dashboard"]
        else:
            options = ["sources", "panels", "battery", "cars", "rates", "dashboard"]
        return self.async_show_menu(
            step_id="init",
            menu_options=options,
            description_placeholders={"guide": energy_guide(self._conf), "energy_url": ENERGY_URL},
        )

    async def async_step_dashboard(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            result = await _create_dashboard(self.hass)
            return self.async_abort(reason=f"dashboard_{result}")
        return self.async_show_form(step_id="dashboard", data_schema=vol.Schema({}))
