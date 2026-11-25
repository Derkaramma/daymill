"""Glue between Home Assistant states and the pure SunFlow modules.

Tracks the configured source entities, works out power with the freshness
fallback, feeds lifetime energy into the billing ledger, runs the hourly
interval close and the billing-cycle reset, and keeps the ledger in a Store
so it survives restarts. In demo mode the simulator stands in for the
source entities.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import ATTR_UNIT_OF_MEASUREMENT, EVENT_HOMEASSISTANT_STOP
from homeassistant.core import Event, EventStateChangedData, HomeAssistant, State, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.event import (
    async_track_state_change_event,
    async_track_time_change,
    async_track_time_interval,
    async_track_utc_time_change,
)
from homeassistant.helpers.storage import Store
from homeassistant.helpers.update_coordinator import CoordinatorEntity, DataUpdateCoordinator
from homeassistant.util import dt as dt_util
from homeassistant.util import slugify

from . import health, simulator, sources
from .billing import Ledger, clamp_cycle_day, nbt_options
from .const import (
    CONF_ACC_PLUS_CLASS,
    CONF_ARECR,
    CONF_BATTERY_POSITIVE_IS_DISCHARGE,
    CONF_BATTERY_POWER,
    CONF_BATTERY_SOC,
    CONF_CAR_BATTERY,
    CONF_CAR_CHARGING,
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
    CONF_GRID_POSITIVE_IS_IMPORT,
    CONF_GRID_POWER,
    CONF_GRID_POWER_FALLBACK,
    CONF_HOME_POWER,
    CONF_IMPORT_ENERGY,
    CONF_MAX_AGE,
    CONF_METERING_LAG,
    CONF_NEM,
    CONF_NSC_OPT_IN,
    CONF_NSC_RATE,
    CONF_PANEL_LABEL,
    CONF_PANEL_LAST_REPORTED,
    CONF_PANEL_LIST,
    CONF_PANEL_NAME,
    CONF_PANEL_POWER,
    CONF_PANELS,
    CONF_PTO_DATE,
    CONF_SOLAR_ENERGY,
    CONF_SOLAR_POWER,
    CONF_SOLAR_POWER_FALLBACK,
    CONF_SOURCE,
    CONF_TARIFF,
    CONF_TRACK_COST,
    DEFAULT_BATTERY_POSITIVE_IS_DISCHARGE,
    DEFAULT_CAR_IMAGE,
    DEFAULT_CYCLE_DAY,
    DEFAULT_GRID_POSITIVE_IS_IMPORT,
    DEFAULT_MAX_AGE,
    DEFAULT_METERING_LAG,
    DEFAULT_NEM,
    DEFAULT_TARIFF,
    DEFAULT_TRACK_COST,
    DEVICE_NAME,
    DOMAIN,
    MONEY_KEYS,
    NAME,
    SOURCE_DEMO,
    STORAGE_SAVE_DELAY,
    STORAGE_VERSION,
    SUN_ENTITY,
    TOTALS_INTERVAL,
    TOTALS_METRICS,
    VERSION,
)
from .tariff import (
    Tariff,
    TariffEngine,
    export_table_data,
    load_preset,
    nbt_table_for_pto,
    parse_export_table,
)
from .totals import async_fetch_totals

_LOGGER = logging.getLogger(__name__)

ENERGY_KEYS = ("produced", "imported", "exported", "consumed")
_ENERGY_SOURCES = {
    "produced": CONF_SOLAR_ENERGY,
    "imported": CONF_IMPORT_ENERGY,
    "exported": CONF_EXPORT_ENERGY,
}

type SunFlowConfigEntry = ConfigEntry[SunFlowCoordinator]


def entry_config(entry: ConfigEntry) -> dict[str, Any]:
    """Options win once the user has saved them; they hold the full config."""
    return dict(entry.options) if entry.options else dict(entry.data)


def _pto_year(conf: Mapping[str, Any]) -> int | None:
    pto = dt_util.parse_date(str(conf.get(CONF_PTO_DATE) or ""))
    return pto.year if pto else None


def export_data(conf: Mapping[str, Any], tariff: Tariff) -> dict[str, Any] | None:
    """Raw NEM 3.0 export table: the bundled one for the PTO year, else the tariff's own.

    Export prices depend on the year the system got permission to operate, so
    a 2024 system keeps the 2024 schedule whatever the rate plan points at.
    Reads files: run in an executor.
    """
    year = _pto_year(conf)
    table = nbt_table_for_pto(tariff.utility, year) if year else None
    return table or export_table_data(tariff)


def build_engine(conf: Mapping[str, Any]) -> TariffEngine:
    """Load the tariff and build its engine. Reads files: run in an executor."""
    tariff = load_preset(conf.get(CONF_TARIFF) or DEFAULT_TARIFF)
    nem = conf.get(CONF_NEM) or DEFAULT_NEM
    lag = conf.get(CONF_METERING_LAG, DEFAULT_METERING_LAG)
    table = None
    if nem == "nem3" and _pto_year(conf) and (data := export_data(conf, tariff)):
        table = parse_export_table(data)
    return TariffEngine(
        tariff,
        nem=nem,
        metering_lag=timedelta(minutes=float(lag)),
        export_table=table,
    )


def build_nbt(conf: Mapping[str, Any], engine: TariffEngine) -> dict[str, Any] | None:
    """Ledger NEM 3.0 options from the export table and the user's settings.

    Reads a file: run in an executor. None unless the engine is in NEM 3.0 mode.
    """
    if engine.nem != "nem3":
        return None
    return nbt_options(
        export_data(conf, engine.tariff),
        pto_date=conf.get(CONF_PTO_DATE) or None,
        acc_plus_class=conf.get(CONF_ACC_PLUS_CLASS) or None,
        arecr=conf.get(CONF_ARECR),
        nsc_rate=conf.get(CONF_NSC_RATE),
        nsc_opt_in=conf.get(CONF_NSC_OPT_IN),
    )


def _build_billing(conf: Mapping[str, Any]) -> tuple[TariffEngine, dict[str, Any] | None]:
    engine = build_engine(conf)
    return engine, build_nbt(conf, engine)


@dataclass(frozen=True)
class Car:
    slug: str
    name: str
    charging: str | None
    presence: str | None
    power: str | None
    # only passed on to the cards
    image: str = DEFAULT_CAR_IMAGE
    battery: str | None = None
    plugged: str | None = None
    limit: str | None = None


def cars_from_config(conf: Mapping[str, Any]) -> list[Car]:
    if conf.get(CONF_SOURCE) == SOURCE_DEMO:
        return [
            Car(
                slug=slugify(c["name"]),
                name=c["name"],
                charging=None,
                presence=None,
                power=None,
                image=image,
            )
            for c, image in zip(simulator.simulate()["cars"], ("sedan", "suv"), strict=False)
        ]
    out: list[Car] = []
    seen: set[str] = set()
    for idx, raw in enumerate(conf.get(CONF_CARS) or []):
        name = str(raw.get(CONF_CAR_NAME) or f"Car {idx + 1}")
        slug = slugify(name) or f"car_{idx + 1}"
        if slug in seen:
            slug = f"{slug}_{idx + 1}"
        seen.add(slug)
        out.append(
            Car(
                slug=slug,
                name=name,
                charging=raw.get(CONF_CAR_CHARGING),
                presence=raw.get(CONF_CAR_PRESENCE),
                power=raw.get(CONF_CAR_POWER),
                image=raw.get(CONF_CAR_IMAGE) or DEFAULT_CAR_IMAGE,
                battery=raw.get(CONF_CAR_BATTERY),
                plugged=raw.get(CONF_CAR_PLUGGED),
                limit=raw.get(CONF_CAR_LIMIT),
            )
        )
    return out


@dataclass
class Snapshot:
    """Live values recomputed on every source change and once a minute."""

    solar: sources.Reading | None = None
    grid: sources.Reading | None = None
    home: sources.Reading | None = None
    battery_kw: float | None = None
    battery_soc: float | None = None
    data_age: float | None = None
    cars: dict[str, tuple[bool, float]] = field(default_factory=dict)
    health: str | None = None
    problem: bool = False


def _unit(state: State | None) -> str | None:
    return state.attributes.get(ATTR_UNIT_OF_MEASUREMENT) if state else None


def _value(state: State | None) -> str | None:
    return state.state if state else None


class SunFlowCoordinator(DataUpdateCoordinator[Snapshot]):
    """Owns the tariff engine, the ledger and the live snapshot."""

    config_entry: SunFlowConfigEntry

    def __init__(self, hass: HomeAssistant, entry: SunFlowConfigEntry) -> None:
        super().__init__(hass, _LOGGER, config_entry=entry, name=DOMAIN, update_interval=None)
        self.conf = entry_config(entry)
        self.engine: TariffEngine
        self.ledger: Ledger
        self.energy: dict[str, float | None] = dict.fromkeys(ENERGY_KEYS)
        self.totals: dict[str, float] | None = None
        self.cars = cars_from_config(self.conf)
        self.max_age = float(self.conf.get(CONF_MAX_AGE, DEFAULT_MAX_AGE))
        self.problem_since: datetime | None = None
        self.demo = self.conf.get(CONF_SOURCE) == SOURCE_DEMO
        self._demo_last: datetime | None = None
        self._demo_snap: dict[str, Any] | None = None
        self._refresh_pending = False
        self._energy_dirty = False
        self._store: Store[dict[str, Any]] = Store(
            hass, STORAGE_VERSION, f"{DOMAIN}.{entry.entry_id}"
        )
        self._unsubs: list[Any] = []
        self._started = False

    # ---- what is configured ----

    def _entity(self, key: str) -> str | None:
        value = self.conf.get(key)
        return value or None

    @property
    def has_home_sensor(self) -> bool:
        return self._entity(CONF_HOME_POWER) is not None

    @property
    def has_battery(self) -> bool:
        if self.demo:
            return True
        return bool(self._entity(CONF_BATTERY_POWER) or self._entity(CONF_BATTERY_SOC))

    @property
    def track_cost(self) -> bool:
        return bool(self.conf.get(CONF_TRACK_COST, DEFAULT_TRACK_COST))

    @property
    def has_health(self) -> bool:
        return bool(self.conf.get(CONF_PANELS) or self._entity(CONF_GATEWAY))

    def _panel_entities(self) -> list[str]:
        out = []
        for face in self.conf.get(CONF_PANELS) or []:
            for panel in face.get(CONF_PANEL_LIST) or []:
                out.extend(
                    e
                    for e in (panel.get(CONF_PANEL_POWER), panel.get(CONF_PANEL_LAST_REPORTED))
                    if e
                )
        return out

    def _energy_entities(self) -> set[str]:
        return {e for e in (self._entity(k) for k in _ENERGY_SOURCES.values()) if e}

    def tracked_entities(self) -> list[str]:
        if self.demo:
            return []
        keys = (
            CONF_SOLAR_POWER,
            CONF_SOLAR_POWER_FALLBACK,
            CONF_GRID_POWER,
            CONF_GRID_POWER_FALLBACK,
            CONF_HOME_POWER,
            CONF_SOLAR_ENERGY,
            CONF_IMPORT_ENERGY,
            CONF_EXPORT_ENERGY,
            CONF_GATEWAY,
            CONF_BATTERY_POWER,
            CONF_BATTERY_SOC,
        )
        out = [e for e in (self._entity(k) for k in keys) if e]
        for car in self.cars:
            out.extend(e for e in (car.charging, car.presence, car.power) if e)
        out.extend(self._panel_entities())
        return sorted(set(out))

    # ---- lifecycle ----

    async def async_setup(self) -> None:
        """Load the tariff and the stored ledger. Raises TariffError."""
        self.engine, nbt = await self.hass.async_add_executor_job(_build_billing, self.conf)
        stored = await self._store.async_load() or {}
        cycle_day = clamp_cycle_day(self.conf.get(CONF_CYCLE_DAY, DEFAULT_CYCLE_DAY))
        self.ledger = Ledger(self.engine, cycle_day, stored.get("ledger"), nbt=nbt)
        if stored.get("ledger") and stored.get("cycle_day") not in (None, cycle_day):
            # the user moved the cycle day: relabel the running cycle, keep its data
            self.ledger.set_cycle_day(cycle_day, dt_util.utcnow())
        for key in ENERGY_KEYS:
            self.energy[key] = sources.to_number((stored.get("energy") or {}).get(key))
        since = stored.get("problem_since")
        self.problem_since = dt_util.parse_datetime(since) if since else None

    @callback
    def async_start(self) -> None:
        """Subscribe to sources and timers, then take a first reading."""
        hass = self.hass
        self._unsubs.append(
            async_track_state_change_event(hass, self.tracked_entities(), self._on_state)
        )
        self._unsubs.append(async_track_time_change(hass, self._on_minute, second=0))
        # Both run every 15 minutes in UTC, so they line up with the tariff's
        # own hours whatever HA's time zone is (some zones are offset by 30 or
        # 45 minutes). The interval close acts only on the tariff hour.
        self._unsubs.append(
            async_track_utc_time_change(
                hass, self._on_interval_close, minute=(0, 15, 30, 45), second=30
            )
        )
        self._unsubs.append(
            async_track_utc_time_change(
                hass, self._on_cycle_check, minute=(0, 15, 30, 45), second=45
            )
        )
        self._unsubs.append(async_track_time_interval(hass, self._on_totals_timer, TOTALS_INTERVAL))
        self._unsubs.append(hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, self._on_stop))
        self._started = True
        now = dt_util.utcnow()
        self._process_energy(now)
        self.data = self._compute(now)
        self.last_update_success = True

    async def async_shutdown(self) -> None:
        """Stop listening and write the ledger. Also runs on entry unload."""
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()
        if self._started:
            self._started = False
            await self._store.async_save(self._data_to_save())
        await super().async_shutdown()

    async def _async_update_data(self) -> Snapshot:
        return self._compute(dt_util.utcnow())

    # ---- storage ----

    def _data_to_save(self) -> dict[str, Any]:
        return {
            "cycle_day": self.ledger.cycle_day,
            "ledger": self.ledger.to_dict(),
            "energy": dict(self.energy),
            "problem_since": self.problem_since.isoformat() if self.problem_since else None,
        }

    @callback
    def _schedule_save(self) -> None:
        self._store.async_delay_save(self._data_to_save, STORAGE_SAVE_DELAY)

    async def _on_stop(self, _event: Event) -> None:
        if self._started:
            await self._store.async_save(self._data_to_save())

    # ---- event handlers ----

    @callback
    def _on_state(self, event: Event[EventStateChangedData]) -> None:
        # One poll of a gateway writes many sources in the same loop pass.
        # Gather them and recompute once, so nothing sees a half-updated set.
        if event.data["entity_id"] in self._energy_entities():
            self._energy_dirty = True
        if not self._refresh_pending:
            self._refresh_pending = True
            self.hass.async_create_task(self._flush(), "sunflow_solar refresh", eager_start=False)

    async def _flush(self) -> None:
        self._refresh_pending = False
        if not self._started:
            return
        now = dt_util.utcnow()
        if self._energy_dirty:
            self._energy_dirty = False
            self._process_energy(now)
        self.async_set_updated_data(self._compute(now))

    @callback
    def _on_minute(self, now: datetime) -> None:
        when = dt_util.as_utc(now)
        if self.demo:
            self._process_energy(when)
        self.async_set_updated_data(self._compute(when))

    @callback
    def _on_interval_close(self, now: datetime) -> None:
        if dt_util.as_utc(now).astimezone(self.engine.tz).minute != 0:
            return
        self.ledger.close_interval(dt_util.as_utc(now))
        self._schedule_save()
        self.async_set_updated_data(self._compute(dt_util.as_utc(now)))

    @callback
    def _on_cycle_check(self, now: datetime) -> None:
        if self.ledger.maybe_reset_cycle(dt_util.as_utc(now)):
            self._schedule_save()
            self.async_update_listeners()

    async def _on_totals_timer(self, _now: datetime) -> None:
        await self.async_refresh_totals()

    # ---- energy ----

    def _read_kwh(self, conf_key: str) -> float | None:
        entity_id = self._entity(conf_key)
        state = self.hass.states.get(entity_id) if entity_id else None
        if state is None:
            return None
        return sources.to_kwh(state.state, _unit(state))

    @callback
    def seed_energy(self, key: str, value: float | None) -> None:
        """Restored sensor state, used when the Store has nothing (first run)."""
        if self.energy.get(key) is None and value is not None:
            self.energy[key] = value

    def _process_energy(self, now: datetime) -> None:
        if self.demo:
            self._demo_energy(now)
            return
        raw = {key: self._read_kwh(conf_key) for key, conf_key in _ENERGY_SOURCES.items()}
        for key, value in raw.items():
            self.energy[key] = sources.clamp_total(value, self.energy.get(key))
        p, i, e = raw["produced"], raw["imported"], raw["exported"]
        if p is not None and i is not None and e is not None and p > 0 and i > 0 and e > 0:
            self.energy["consumed"] = sources.clamp_total(p + i - e, self.energy.get("consumed"))
        if self.energy["imported"] is None and self.energy["exported"] is None:
            return
        self.ledger.on_energy(
            now, self.energy["imported"], self.energy["exported"], self.energy["produced"]
        )
        self._schedule_save()

    # ---- demo ----

    def _demo(self, now: datetime) -> dict[str, Any]:
        """Simulator snapshot for this minute: day while the sun is up."""
        sun = self.hass.states.get(SUN_ENTITY)
        elevation = sun.attributes.get("elevation") if sun else None
        if isinstance(elevation, (int, float)):
            day = elevation > 0
        else:
            day = 7 <= dt_util.as_local(now).hour < 18
        # Night is when cars charge, so show one charging then.
        scenario = "normal" if day else "car-charging"
        return simulator.simulate(scenario, "day" if day else "night", now.timestamp())

    def _demo_energy(self, now: datetime) -> None:
        """Add up simulated kWh since the last call and feed the ledger."""
        snap = self._demo_snap or self._demo(now)
        if self._demo_last is not None:
            hours = min(max((now - self._demo_last).total_seconds(), 0.0), 3600.0) / 3600
            steps = {
                "produced": snap["solar_kw"],
                "imported": snap["grid_import_kw"],
                "exported": snap["grid_export_kw"],
                "consumed": snap["home_kw"],
            }
            for key, kw in steps.items():
                self.energy[key] = round((self.energy.get(key) or 0.0) + kw * hours, 6)
        else:
            for key in ENERGY_KEYS:
                self.energy[key] = self.energy.get(key) or 0.0
        self._demo_last = now
        self._demo_snap = self._demo(now)
        self.ledger.on_energy(
            now, self.energy["imported"], self.energy["exported"], self.energy["produced"]
        )
        self._schedule_save()

    def _demo_compute(self, now: datetime) -> Snapshot:
        snap = self._demo_snap = self._demo(now)
        cars = {
            slugify(c["name"]): (c["charging"] and c["home"], c["power_kw"] if c["home"] else 0.0)
            for c in snap["cars"]
        }
        return Snapshot(
            solar=sources.Reading(snap["solar_kw"], "demo"),
            grid=sources.Reading(snap["grid_kw"], "demo"),
            home=sources.Reading(snap["home_kw"], "demo"),
            battery_kw=snap["battery_kw"],
            battery_soc=snap["battery_soc"],
            data_age=0.0,
            cars=cars,
        )

    # ---- live values ----

    def _state(self, conf_key: str) -> State | None:
        entity_id = self._entity(conf_key)
        return self.hass.states.get(entity_id) if entity_id else None

    @staticmethod
    def _age(state: State | None, now: datetime) -> float | None:
        if state is None:
            return None
        return max((now - state.last_reported).total_seconds(), 0.0)

    def _compute(self, now: datetime) -> Snapshot:
        if self.demo:
            return self._demo_compute(now)
        live_solar = self._state(CONF_SOLAR_POWER)
        fb_solar = self._state(CONF_SOLAR_POWER_FALLBACK)
        live_grid = self._state(CONF_GRID_POWER)
        fb_grid = self._state(CONF_GRID_POWER_FALLBACK)
        live_home = self._state(CONF_HOME_POWER)

        solar = sources.solar_power(
            _value(live_solar),
            self._age(live_solar, now),
            _value(fb_solar),
            self.max_age,
            live_unit=_unit(live_solar),
            meter_unit=_unit(fb_solar),
        )
        grid = sources.grid_power(
            _value(live_grid),
            self._age(live_grid, now),
            _value(fb_grid),
            self.max_age,
            live_unit=_unit(live_grid),
            meter_unit=_unit(fb_grid),
            positive_is_import=self.conf.get(
                CONF_GRID_POSITIVE_IS_IMPORT, DEFAULT_GRID_POSITIVE_IS_IMPORT
            ),
        )

        battery_kw = None
        battery_soc = None
        if self.has_battery:
            bp = self._state(CONF_BATTERY_POWER)
            battery_kw = sources.battery_power(
                _value(bp),
                _unit(bp),
                positive_is_discharge=self.conf.get(
                    CONF_BATTERY_POSITIVE_IS_DISCHARGE, DEFAULT_BATTERY_POSITIVE_IS_DISCHARGE
                ),
            )
            battery_soc = sources.battery_soc(_value(self._state(CONF_BATTERY_SOC)))

        home = sources.home_power(
            _value(live_home),
            self._age(live_home, now),
            solar.kw if solar else None,
            grid.kw if grid else None,
            self.max_age,
            live_unit=_unit(live_home),
            battery_kw=battery_kw,
        )

        data_age = sources.freshest_age(
            *(
                self._age(s, now)
                for s in (live_solar, fb_solar, live_grid, fb_grid, live_home)
                if s is not None and s.state not in ("unavailable", "unknown")
            )
        )

        cars: dict[str, tuple[bool, float]] = {}
        for car in self.cars:
            charging = _value(self.hass.states.get(car.charging)) if car.charging else None
            presence = _value(self.hass.states.get(car.presence)) if car.presence else None
            power = self.hass.states.get(car.power) if car.power else None
            at_home = sources.charging_at_home(charging, presence)
            kw = sources.home_charging_power(_value(power), _unit(power), charging, presence)
            cars[car.slug] = (at_home, kw)

        snap = Snapshot(
            solar=solar,
            grid=grid,
            home=home,
            battery_kw=battery_kw,
            battery_soc=battery_soc,
            data_age=data_age,
            cars=cars,
        )
        if self.has_health:
            self._check_health(snap, now)
        return snap

    def _check_health(self, snap: Snapshot, now: datetime) -> None:
        faces = []
        for idx, face in enumerate(self.conf.get(CONF_PANELS) or []):
            panels = []
            for p_idx, panel in enumerate(face.get(CONF_PANEL_LIST) or []):
                power = self.hass.states.get(panel.get(CONF_PANEL_POWER) or "")
                last = None
                lr_entity = panel.get(CONF_PANEL_LAST_REPORTED)
                if lr_entity:
                    lr = self.hass.states.get(lr_entity)
                    last = dt_util.parse_datetime(lr.state) if lr else None
                elif power is not None:
                    last = power.last_reported
                label = face.get(CONF_PANEL_LABEL) or f"Face {idx + 1}"
                panels.append(
                    health.Panel(
                        power=sources.to_kw(_value(power), _unit(power)),
                        last_reported=last,
                        name=panel.get(CONF_PANEL_NAME) or f"{label} {p_idx + 1}",
                    )
                )
            faces.append(health.RoofFace(face.get(CONF_PANEL_LABEL) or f"Face {idx + 1}", panels))

        gateway = self._state(CONF_GATEWAY)
        online = health.gateway_online(_value(gateway)) if self._entity(CONF_GATEWAY) else True
        sun = self.hass.states.get(SUN_ENTITY)
        findings = health.evaluate(
            faces,
            now,
            sun_elevation=sun.attributes.get("elevation") if sun else None,
            gateway_online=online,
        )
        result = health.update_problem(findings, self.problem_since, now)
        if result.problem_since != self.problem_since:
            self.problem_since = result.problem_since
            self._schedule_save()
        snap.health = result.findings
        snap.problem = result.problem

    # ---- recorder totals ----

    def statistic_ids(self) -> dict[str, str | None]:
        registry = er.async_get(self.hass)
        entry_id = self.config_entry.entry_id
        return {
            metric: registry.async_get_entity_id("sensor", DOMAIN, f"{entry_id}_{key}")
            for metric, key in TOTALS_METRICS.items()
            if self.track_cost or key not in MONEY_KEYS
        }

    async def async_refresh_totals(self) -> None:
        try:
            self.totals = await async_fetch_totals(
                self.hass, self.statistic_ids(), tz=self.engine.tz
            )
        except Exception:  # recorder trouble should not take the integration down
            _LOGGER.exception("Could not read totals from the recorder")
            return
        self.async_update_listeners()


class SunFlowEntity(CoordinatorEntity[SunFlowCoordinator]):
    """Every entity hangs off one "SunFlow" service device.

    The entity_id below is only a suggestion and the user can rename it.
    Cards and templates should find entities through the registry (unique_id
    is f"{entry_id}_{key}"), not by hard-coded ids.
    """

    _attr_has_entity_name = True

    def __init__(self, coordinator: SunFlowCoordinator, key: str, platform: str) -> None:
        super().__init__(coordinator)
        entry_id = coordinator.config_entry.entry_id
        self._key = key
        self._attr_unique_id = f"{entry_id}_{key}"
        self.entity_id = f"{platform}.sunflow_{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry_id)},
            name=DEVICE_NAME,
            manufacturer=NAME,
            model=coordinator.engine.tariff.name,
            sw_version=VERSION,
            entry_type=DeviceEntryType.SERVICE,
        )
