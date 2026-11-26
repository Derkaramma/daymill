"""DayMill binary sensors."""

from __future__ import annotations

from typing import Any

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .coordinator import Car, DayMillConfigEntry, DayMillCoordinator, DayMillEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: DayMillConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    coordinator = entry.runtime_data
    entities: list[BinarySensorEntity] = []
    if coordinator.has_health:
        entities.append(SolarProblemSensor(coordinator))
    entities.extend(CarChargingSensor(coordinator, car) for car in coordinator.cars)
    async_add_entities(entities)


class SolarProblemSensor(DayMillEntity, BinarySensorEntity):
    """On once health findings have lasted 30 minutes."""

    _attr_device_class = BinarySensorDeviceClass.PROBLEM
    _attr_translation_key = "solar_problem"

    def __init__(self, coordinator: DayMillCoordinator) -> None:
        super().__init__(coordinator, "solar_problem", "binary_sensor")

    @property
    def is_on(self) -> bool:
        return self.coordinator.data.problem

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        since = self.coordinator.problem_since
        return {
            "findings": self.coordinator.data.health,
            "problem_since": since.isoformat() if since else None,
        }


class CarChargingSensor(DayMillEntity, BinarySensorEntity):
    """Car is charging and at home."""

    _attr_device_class = BinarySensorDeviceClass.BATTERY_CHARGING
    _attr_translation_key = "car_charging_at_home"

    def __init__(self, coordinator: DayMillCoordinator, car: Car) -> None:
        super().__init__(coordinator, f"car_{car.slug}_charging_at_home", "binary_sensor")
        self._car = car
        self._attr_translation_placeholders = {"car": car.name}

    @property
    def is_on(self) -> bool:
        value = self.coordinator.data.cars.get(self._car.slug)
        return bool(value and value[0])

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """The car's picture and extra sensors, for the house card."""
        car = self._car
        attrs: dict[str, Any] = {"car_image": car.image}
        for key, entity_id in (
            ("battery_entity", car.battery),
            ("plugged_entity", car.plugged),
            ("limit_entity", car.limit),
        ):
            if entity_id:
                attrs[key] = entity_id
        return attrs
