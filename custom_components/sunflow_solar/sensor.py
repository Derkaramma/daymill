"""SunFlow Solar sensors."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from homeassistant.components.sensor import (
    RestoreSensor,
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.const import (
    PERCENTAGE,
    EntityCategory,
    UnitOfEnergy,
    UnitOfPower,
    UnitOfTime,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from . import sources
from .const import (
    CONF_GATEWAY,
    CONF_GATEWAY_DIAGNOSTICS,
    CONF_PANEL_LABEL,
    CONF_PANEL_LIST,
    CONF_PANEL_NAME,
    CONF_PANEL_POWER,
    CONF_PANELS,
    MONEY_KEYS,
)
from .coordinator import Car, SunFlowConfigEntry, SunFlowCoordinator, SunFlowEntity
from .totals import self_sufficiency_today

type ValueFn = Callable[[SunFlowCoordinator, datetime], Any]
type AttrsFn = Callable[[SunFlowCoordinator, datetime], dict[str, Any] | None]

PERIOD_ICONS = {
    "on_peak": "mdi:clock-alert",
    "mid_peak": "mdi:clock-time-four",
    "off_peak": "mdi:clock-outline",
    "super_off_peak": "mdi:clock-check",
}

NEM_TEXT = {
    "nem1": ("NEM 1.0", "Full energy rate of the period."),
    "nem2": (
        "NEM 2.0",
        "Energy rate of the period minus non-bypassable charges. Interval adders are not credited.",
    ),
    "nem3": ("NEM 3.0 (net billing)", "Hourly export price from the utility's export table."),
    "none": ("No net metering", "Exports are not credited."),
}


@dataclass(frozen=True, kw_only=True)
class SunFlowSensorDescription(SensorEntityDescription):
    value_fn: ValueFn
    attrs_fn: AttrsFn | None = None
    icon_fn: Callable[[Any], str | None] | None = None
    currency_unit: str | None = None  # "{c}" or "{c}/kWh": filled from the tariff


# ---- value helpers ----


def _w(reading: sources.Reading | None) -> int | None:
    return sources.kw_to_w(reading.kw) if reading else None


def _source(reading: sources.Reading | None) -> dict[str, Any] | None:
    return {"source": reading.source} if reading else None


def _grid_split(c: SunFlowCoordinator, fn: Callable[[float], float]) -> int | None:
    grid = c.data.grid
    return sources.kw_to_w(fn(grid.kw)) if grid else None


def _self_sufficiency(c: SunFlowCoordinator, _now: datetime) -> int | None:
    solar, home = c.data.solar, c.data.home
    if solar is None or home is None:
        return None
    return sources.self_sufficiency(solar.kw, home.kw)


def _status(c: SunFlowCoordinator, _now: datetime) -> str | None:
    solar, grid = c.data.solar, c.data.grid
    if solar is None or grid is None:
        return None
    return sources.status(solar.kw, grid.kw)


def _status_attrs(c: SunFlowCoordinator, _now: datetime) -> dict[str, Any] | None:
    solar, grid, home = c.data.solar, c.data.grid, c.data.home
    if solar is None or grid is None:
        return None
    return {"summary": sources.status_summary(solar.kw, grid.kw, home.kw if home else 0.0)}


def _cost_rate(c: SunFlowCoordinator, now: datetime) -> float | None:
    grid = c.data.grid
    if grid is None:
        return None
    rate = c.engine.import_price(now) if grid.kw >= 0 else c.engine.export_price(now)
    return round(grid.kw * rate, 4)


def _cost_rate_attrs(c: SunFlowCoordinator, now: datetime) -> dict[str, Any] | None:
    cost = _cost_rate(c, now)
    if cost is None:
        return None
    if cost < -0.005:
        text = f"Earning ${-cost:.2f}/h"
    elif cost > 0.005:
        text = f"Paying ${cost:.2f}/h"
    else:
        text = "About $0.00/h"
    return {"text": text}


def _export_rate_attrs(c: SunFlowCoordinator, _now: datetime) -> dict[str, Any]:
    version, rule = NEM_TEXT.get(c.engine.nem, (c.engine.nem, ""))
    return {
        "nem_version": version,
        "non_bypassable_charge": c.engine.nbc_per_kwh,
        "rule": rule,
    }


def _bill(c: SunFlowCoordinator, now: datetime) -> dict[str, Any]:
    return c.ledger.bill_estimate(now)


def _total(key: str) -> ValueFn:
    return lambda c, _now: c.ledger.totals[key]


def _totals_attrs(c: SunFlowCoordinator, _now: datetime) -> dict[str, Any] | None:
    if c.totals is None:
        return None
    start = c.ledger.tracking_start
    return {**c.totals, "tracking_start": start.isoformat() if start else None}


def _totals_value(c: SunFlowCoordinator, _now: datetime) -> float | None:
    return c.totals.get("produced_today") if c.totals is not None else None


# Optional extras a panel group or panel may carry for the panels card.
_GROUP_EXTRAS = ("facing", "note", "color")
_PANEL_EXTRAS = ("energy", "today", "short")


def _panel_attrs(c: SunFlowCoordinator, _now: datetime) -> dict[str, Any]:
    """Panel groups and gateway diagnostics, so the panels card needs no config."""
    groups = []
    for idx, face in enumerate(c.conf.get(CONF_PANELS) or []):
        label = face.get(CONF_PANEL_LABEL) or f"Face {idx + 1}"
        panels = []
        for p_idx, panel in enumerate(face.get(CONF_PANEL_LIST) or []):
            power = panel.get(CONF_PANEL_POWER)
            if not power:
                continue
            item = {"power": power, "name": panel.get(CONF_PANEL_NAME) or f"{label} {p_idx + 1}"}
            item.update({k: panel[k] for k in _PANEL_EXTRAS if panel.get(k)})
            panels.append(item)
        if panels:
            group = {"label": label, "panels": panels}
            group.update({k: face[k] for k in _GROUP_EXTRAS if face.get(k) is not None})
            groups.append(group)
    attrs: dict[str, Any] = {"groups": groups}
    diagnostics = [c.conf.get(CONF_GATEWAY), *(c.conf.get(CONF_GATEWAY_DIAGNOSTICS) or [])]
    if diagnostics := list(dict.fromkeys(d for d in diagnostics if d)):
        attrs["diagnostics"] = diagnostics
    return attrs


def _health_icon(value: Any) -> str:
    return "mdi:solar-panel" if value in (None, "OK") else "mdi:solar-panel-large"


def _battery_split(index: int) -> ValueFn:
    def fn(c: SunFlowCoordinator, _now: datetime) -> int | None:
        kw = c.data.battery_kw
        return sources.kw_to_w(sources.battery_split(kw)[index]) if kw is not None else None

    return fn


_POWER = {
    "native_unit_of_measurement": UnitOfPower.WATT,
    "device_class": SensorDeviceClass.POWER,
    "state_class": SensorStateClass.MEASUREMENT,
}
_MONEY = {
    "device_class": SensorDeviceClass.MONETARY,
    "state_class": SensorStateClass.TOTAL,
    "currency_unit": "{c}",
    "suggested_display_precision": 2,
}
_RATE = {
    "state_class": SensorStateClass.MEASUREMENT,
    "currency_unit": "{c}/kWh",
    "suggested_display_precision": 5,
}

POWER_SENSORS: tuple[SunFlowSensorDescription, ...] = (
    SunFlowSensorDescription(
        key="solar_power",
        icon="mdi:solar-power-variant",
        value_fn=lambda c, _n: _w(c.data.solar),
        attrs_fn=lambda c, _n: _source(c.data.solar),
        **_POWER,
    ),
    SunFlowSensorDescription(
        key="grid_power",
        icon="mdi:transmission-tower",
        value_fn=lambda c, _n: _w(c.data.grid),
        attrs_fn=lambda c, _n: _source(c.data.grid),
        **_POWER,
    ),
    SunFlowSensorDescription(
        key="home_power",
        icon="mdi:home-lightning-bolt",
        value_fn=lambda c, _n: _w(c.data.home),
        attrs_fn=lambda c, _n: _source(c.data.home),
        **_POWER,
    ),
    SunFlowSensorDescription(
        key="grid_import_power",
        icon="mdi:transmission-tower-import",
        value_fn=lambda c, _n: _grid_split(c, sources.grid_import_kw),
        **_POWER,
    ),
    SunFlowSensorDescription(
        key="grid_export_power",
        icon="mdi:transmission-tower-export",
        value_fn=lambda c, _n: _grid_split(c, sources.grid_export_kw),
        **_POWER,
    ),
    SunFlowSensorDescription(
        key="self_sufficiency",
        icon="mdi:home-percent",
        native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=_self_sufficiency,
    ),
    SunFlowSensorDescription(
        key="status",
        value_fn=_status,
        attrs_fn=_status_attrs,
        icon_fn=lambda v: sources.STATUS_ICONS.get(v, "mdi:solar-power"),
    ),
)

TOU_SENSORS: tuple[SunFlowSensorDescription, ...] = (
    SunFlowSensorDescription(
        key="tou_period",
        value_fn=lambda c, n: c.engine.period_at(n).period,
        attrs_fn=lambda c, n: c.engine.period_attributes(n),
        icon_fn=lambda v: PERIOD_ICONS.get(v, "mdi:clock-outline"),
    ),
    SunFlowSensorDescription(
        key="tou_holiday",
        icon="mdi:calendar-star",
        value_fn=lambda c, n: c.engine.period_at(n).holiday or "none",
        attrs_fn=lambda c, n: {"dates": c.engine.holiday_dates(n)},
    ),
    SunFlowSensorDescription(
        key="import_rate",
        icon="mdi:cash-plus",
        value_fn=lambda c, n: c.engine.import_price(n),
        attrs_fn=lambda c, n: c.engine.rate_attributes(n),
        **_RATE,
    ),
    SunFlowSensorDescription(
        key="export_rate",
        icon="mdi:cash-minus",
        value_fn=lambda c, n: c.engine.export_price(n),
        attrs_fn=_export_rate_attrs,
        **_RATE,
    ),
    SunFlowSensorDescription(
        key="cost_rate",
        icon="mdi:cash-clock",
        state_class=SensorStateClass.MEASUREMENT,
        currency_unit="{c}/h",
        suggested_display_precision=2,
        value_fn=_cost_rate,
        attrs_fn=_cost_rate_attrs,
    ),
)

MONEY_SENSORS: tuple[SunFlowSensorDescription, ...] = (
    SunFlowSensorDescription(
        key="import_energy_charge",
        icon="mdi:cash-plus",
        value_fn=_total("import_energy_charge"),
        attrs_fn=lambda c, _n: {"last_import": c.ledger.to_dict()["last_import"]},
        **_MONEY,
    ),
    SunFlowSensorDescription(
        key="export_credit",
        icon="mdi:cash-minus",
        value_fn=_total("export_credit"),
        attrs_fn=lambda c, _n: {"last_export": c.ledger.to_dict()["last_export"]},
        **_MONEY,
    ),
    SunFlowSensorDescription(
        key="nbc_charges",
        icon="mdi:cash-lock",
        value_fn=_total("nbc"),
        attrs_fn=lambda c, _n: {
            **c.ledger.interval,
            "rule": "Non-bypassable charge on each hour's net import. Never credited.",
        },
        **_MONEY,
    ),
    SunFlowSensorDescription(
        key="adder_charges",
        icon="mdi:cash-lock",
        value_fn=_total("adders"),
        attrs_fn=lambda c, _n: {"adders": c.ledger.adder_totals},
        **_MONEY,
    ),
    SunFlowSensorDescription(
        key="import_cost",
        icon="mdi:cash-plus",
        value_fn=_total("import_cost"),
        **_MONEY,
    ),
    SunFlowSensorDescription(
        key="net_cost",
        icon="mdi:cash-multiple",
        value_fn=_total("net_cost"),
        attrs_fn=lambda c, _n: {
            "definition": (
                "Import energy charges minus export credit, plus non-bypassable charges and "
                "adders. Negative = credit. Daily charge not included."
            )
        },
        **_MONEY,
    ),
    SunFlowSensorDescription(
        key="solar_savings",
        icon="mdi:piggy-bank",
        value_fn=_total("savings"),
        **_MONEY,
    ),
)

DAILY_SENSORS: tuple[SunFlowSensorDescription, ...] = (
    SunFlowSensorDescription(
        key="cost_today",
        icon="mdi:cash-clock",
        device_class=SensorDeviceClass.MONETARY,
        currency_unit="{c}",
        suggested_display_precision=2,
        value_fn=lambda c, n: c.ledger.cost_today(n),
        attrs_fn=lambda c, n: c.ledger.today(n),
    ),
    SunFlowSensorDescription(
        key="self_sufficiency_today",
        icon="mdi:home-percent-outline",
        native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda c, _n: self_sufficiency_today(c.totals) if c.totals else None,
    ),
    SunFlowSensorDescription(
        key="bill_estimate",
        icon="mdi:receipt-text-clock",
        device_class=SensorDeviceClass.MONETARY,
        currency_unit="{c}",
        suggested_display_precision=2,
        value_fn=lambda c, n: _bill(c, n)["state"],
        attrs_fn=lambda c, n: _bill(c, n)["attributes"],
    ),
    SunFlowSensorDescription(
        key="totals",
        icon="mdi:sigma",
        native_unit_of_measurement=UnitOfEnergy.KILO_WATT_HOUR,
        value_fn=_totals_value,
        attrs_fn=_totals_attrs,
    ),
    SunFlowSensorDescription(
        key="data_age",
        icon="mdi:timer-sand",
        native_unit_of_measurement=UnitOfTime.SECONDS,
        device_class=SensorDeviceClass.DURATION,
        entity_category=EntityCategory.DIAGNOSTIC,
        suggested_display_precision=0,
        # Whole minutes only: cards add the time since the last write, and a
        # value that changes on every poll would fill the recorder.
        value_fn=lambda c, _n: (
            int(c.data.data_age // 60) * 60 if c.data.data_age is not None else None
        ),
    ),
)

HEALTH_SENSORS: tuple[SunFlowSensorDescription, ...] = (
    SunFlowSensorDescription(
        key="panel_health",
        value_fn=lambda c, _n: c.data.health,
        attrs_fn=_panel_attrs,
        icon_fn=_health_icon,
    ),
)

BATTERY_SENSORS: tuple[SunFlowSensorDescription, ...] = (
    SunFlowSensorDescription(
        key="battery_soc",
        native_unit_of_measurement=PERCENTAGE,
        device_class=SensorDeviceClass.BATTERY,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda c, _n: c.data.battery_soc,
    ),
    SunFlowSensorDescription(
        key="battery_power",
        icon="mdi:battery-charging",
        value_fn=lambda c, _n: (
            sources.kw_to_w(c.data.battery_kw) if c.data.battery_kw is not None else None
        ),
        **_POWER,
    ),
    SunFlowSensorDescription(
        key="battery_charge_power",
        icon="mdi:battery-arrow-up",
        value_fn=_battery_split(0),
        **_POWER,
    ),
    SunFlowSensorDescription(
        key="battery_discharge_power",
        icon="mdi:battery-arrow-down",
        value_fn=_battery_split(1),
        **_POWER,
    ),
)

ENERGY_SENSORS: tuple[SensorEntityDescription, ...] = (
    SensorEntityDescription(key="energy_produced", icon="mdi:solar-power"),
    SensorEntityDescription(key="energy_imported", icon="mdi:transmission-tower-import"),
    SensorEntityDescription(key="energy_exported", icon="mdi:transmission-tower-export"),
    SensorEntityDescription(key="energy_consumed", icon="mdi:home-lightning-bolt-outline"),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: SunFlowConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    coordinator = entry.runtime_data
    descriptions = [*POWER_SENSORS, *TOU_SENSORS, *MONEY_SENSORS, *DAILY_SENSORS]
    if not coordinator.track_cost:
        descriptions = [d for d in descriptions if d.key not in MONEY_KEYS]
    if coordinator.has_health:
        descriptions.extend(HEALTH_SENSORS)
    if coordinator.has_battery:
        descriptions.extend(BATTERY_SENSORS)

    entities: list[SensorEntity] = [SunFlowSensor(coordinator, d) for d in descriptions]
    entities.extend(SunFlowEnergySensor(coordinator, d) for d in ENERGY_SENSORS)
    entities.extend(SunFlowCarPowerSensor(coordinator, car) for car in coordinator.cars)
    async_add_entities(entities)


class SunFlowSensor(SunFlowEntity, SensorEntity):
    """A sensor whose value comes from the coordinator."""

    entity_description: SunFlowSensorDescription
    # the status summary repeats live kW numbers: no need to keep each one
    _unrecorded_attributes = frozenset({"summary"})

    def __init__(
        self, coordinator: SunFlowCoordinator, description: SunFlowSensorDescription
    ) -> None:
        super().__init__(coordinator, description.key, "sensor")
        self.entity_description = description
        self._attr_translation_key = description.key
        if description.currency_unit:
            currency = coordinator.engine.tariff.currency
            self._attr_native_unit_of_measurement = description.currency_unit.format(c=currency)

    def _value(self) -> Any:
        return self.entity_description.value_fn(self.coordinator, dt_util.utcnow())

    @property
    def available(self) -> bool:
        return super().available and self._value() is not None

    @property
    def native_value(self) -> Any:
        return self._value()

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        fn = self.entity_description.attrs_fn
        return fn(self.coordinator, dt_util.utcnow()) if fn else None

    @property
    def icon(self) -> str | None:
        if self.entity_description.icon_fn:
            return self.entity_description.icon_fn(self._value())
        return super().icon


class SunFlowEnergySensor(SunFlowEntity, RestoreSensor):
    """Lifetime kWh that never goes down (clamped in the coordinator)."""

    _attr_native_unit_of_measurement = UnitOfEnergy.KILO_WATT_HOUR
    _attr_device_class = SensorDeviceClass.ENERGY
    _attr_state_class = SensorStateClass.TOTAL_INCREASING
    _attr_suggested_display_precision = 3

    def __init__(self, coordinator: SunFlowCoordinator, description: SensorEntityDescription):
        super().__init__(coordinator, description.key, "sensor")
        self.entity_description = description
        self._attr_translation_key = description.key
        self._energy_key = description.key.removeprefix("energy_")

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        last = await self.async_get_last_sensor_data()
        if last is not None:
            self.coordinator.seed_energy(self._energy_key, sources.to_number(last.native_value))

    @property
    def available(self) -> bool:
        return super().available and self.native_value is not None

    @property
    def native_value(self) -> float | None:
        return self.coordinator.energy.get(self._energy_key)


class SunFlowCarPowerSensor(SunFlowEntity, SensorEntity):
    """Charging power of one car while it charges at home, else 0."""

    _attr_native_unit_of_measurement = UnitOfPower.KILO_WATT
    _attr_device_class = SensorDeviceClass.POWER
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_translation_key = "car_home_charging_power"

    def __init__(self, coordinator: SunFlowCoordinator, car: Car) -> None:
        super().__init__(coordinator, f"car_{car.slug}_home_charging_power", "sensor")
        self._car = car
        self._attr_translation_placeholders = {"car": car.name}

    @property
    def native_value(self) -> float | None:
        value = self.coordinator.data.cars.get(self._car.slug)
        return round(value[1], 3) if value else None
