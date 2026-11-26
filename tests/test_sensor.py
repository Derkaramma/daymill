"""Sensors driven by mocked source states."""

from __future__ import annotations

from datetime import timedelta

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import async_fire_time_changed

from .test_init import (
    BASE_CONFIG,
    GRID_LIVE,
    GRID_METER,
    PV_LIVE,
    PV_METER,
    set_energy,
    set_power,
    setup_entry,
)


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(recorder_mock, enable_custom_integrations):
    """Recorder first: the integration depends on it."""
    yield


def _state(hass: HomeAssistant, key: str, domain: str = "sensor"):
    return hass.states.get(f"{domain}.daymill_{key}")


async def test_power_sensors(hass: HomeAssistant) -> None:
    await setup_entry(hass)
    assert _state(hass, "solar_power").state == "3000"
    assert _state(hass, "solar_power").attributes["source"] == "live"
    assert _state(hass, "grid_power").state == "-1000"
    assert _state(hass, "grid_import_power").state == "0"
    assert _state(hass, "grid_export_power").state == "1000"
    home = _state(hass, "home_power")
    assert home.state == "2000"
    assert home.attributes["source"] == "solar + grid"
    assert _state(hass, "self_sufficiency").state == "100"
    status = _state(hass, "status")
    assert status.state == "Exporting"
    assert status.attributes["icon"] == "mdi:transmission-tower-export"
    assert status.attributes["summary"] == "Solar 3.00 kW, home 2.00 kW, exporting 1.00 kW"

    # watts are converted, and a change pushes straight through
    set_power(hass, PV_LIVE, 500, "W")
    set_power(hass, GRID_LIVE, 1500, "W")
    await hass.async_block_till_done()
    assert _state(hass, "solar_power").state == "500"
    assert _state(hass, "home_power").state == "2000"
    assert _state(hass, "self_sufficiency").state == "25"
    assert _state(hass, "status").state == "Producing"


async def test_grid_sign_flip(hass: HomeAssistant) -> None:
    await setup_entry(hass, {**BASE_CONFIG, "grid_positive_is_import": False})
    assert _state(hass, "grid_power").state == "1000"
    assert _state(hass, "status").state == "Producing"


async def test_freshness_fallback(hass: HomeAssistant, freezer) -> None:
    await setup_entry(hass)
    assert _state(hass, "solar_power").attributes["source"] == "live"

    # the live sensors stop reporting; the meters keep going
    freezer.tick(timedelta(seconds=540))
    set_power(hass, PV_METER, 2.5)
    set_power(hass, GRID_METER, -0.5)
    freezer.tick(timedelta(seconds=120))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    solar = _state(hass, "solar_power")
    assert solar.state == "2500"
    assert solar.attributes["source"] == "meter"
    assert _state(hass, "grid_power").state == "-500"
    assert float(_state(hass, "data_age").state) == 120

    # live comes back
    set_power(hass, PV_LIVE, 2.0)
    await hass.async_block_till_done()
    assert _state(hass, "solar_power").state == "2000"
    assert _state(hass, "solar_power").attributes["source"] == "live"


async def test_unavailable_without_fallback(hass: HomeAssistant, freezer) -> None:
    config = {k: v for k, v in BASE_CONFIG.items() if k != "solar_power_fallback"}
    await setup_entry(hass, config)
    freezer.tick(timedelta(seconds=700))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    # stale live value and no meter: unavailable, never a false 0
    assert _state(hass, "solar_power").state == "unavailable"
    assert _state(hass, "home_power").state == "unavailable"


async def test_tou_sensors(hass: HomeAssistant, freezer) -> None:
    # summer weekday, 4:01 pm local
    freezer.move_to("2026-07-15 16:01:00-07:00")
    await setup_entry(hass)
    period = _state(hass, "tou_period")
    assert period.state == "on_peak"
    a = period.attributes
    assert a["season"] == "summer"
    assert a["day_type"] == "weekday"
    assert a["holiday"] is None
    assert a["tariff"] == "summer_on_peak"
    assert a["metering_tariff"] == "summer_off_peak"
    assert a["next_period"] == "off_peak"
    assert a["next_change"] == "2026-07-15T21:00:00-07:00"
    assert a["plan"] == "SCE TOU-D-PRIME"
    assert a["icon"] == "mdi:clock-alert"

    assert _state(hass, "import_rate").state == "0.626"
    assert _state(hass, "import_rate").attributes["unit_of_measurement"] == "USD/kWh"
    rates = _state(hass, "import_rate").attributes
    assert rates["energy_rate_table"]["summer"]["on_peak"] == 0.60095
    assert rates["nbc_per_kwh"] == 0.01164
    assert _state(hass, "export_rate").state == "0.60095"
    assert _state(hass, "export_rate").attributes["nem_version"] == "NEM 2.0"

    # exporting 1 kW at the export rate
    cost = _state(hass, "cost_rate")
    assert float(cost.state) == round(-1 * 0.60095, 4)
    assert cost.attributes["text"] == "Earning $0.60/h"

    holiday = _state(hass, "tou_holiday")
    assert holiday.state == "none"
    assert holiday.attributes["dates"]["2026-07-04"] == "Independence Day"


async def test_holiday_and_minute_tick(hass: HomeAssistant, freezer) -> None:
    # Labor Day 2026 is Mon Sep 7: weekday 4-9 pm is mid-peak on a holiday
    freezer.move_to("2026-09-07 15:59:00-07:00")
    await setup_entry(hass)
    assert _state(hass, "tou_holiday").state == "Labor Day"
    assert _state(hass, "tou_period").state == "off_peak"
    freezer.move_to("2026-09-07 16:00:00-07:00")
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert _state(hass, "tou_period").state == "mid_peak"
    assert _state(hass, "tou_period").attributes["day_type"] == "holiday"


async def test_money_and_interval_close(hass: HomeAssistant, freezer) -> None:
    # winter weekday 10:10 local: super off-peak, energy rate 0.23909
    freezer.move_to("2026-01-14 10:10:00-08:00")
    await setup_entry(hass)
    set_energy(hass, 1004.0, 502.0, 201.0)
    await hass.async_block_till_done()

    rate = 0.23909
    assert float(_state(hass, "import_energy_charge").state) == round(2 * rate, 5)
    assert float(_state(hass, "export_credit").state) == round(1 * rate, 5)
    assert float(_state(hass, "energy_produced").state) == 1004.0
    # all three meters land in one pass, so consumed is produced + imported - exported
    assert float(_state(hass, "energy_consumed").state) == 1305.0
    assert _state(hass, "energy_imported").attributes["state_class"] == "total_increasing"

    # a meter dip is ignored
    set_energy(hass, 1004.0, 400.0, 201.0)
    await hass.async_block_till_done()
    assert float(_state(hass, "energy_imported").state) == 502.0

    # 11:00:30 hourly close: NBC and FRC/MCAM on 1 kWh net import
    freezer.move_to("2026-01-14 11:00:30-08:00")
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    nbc = _state(hass, "nbc_charges")
    assert float(nbc.state) == round(1 * 0.01164, 5)
    assert nbc.attributes["last_interval_net_kwh"] == 1.0
    assert float(_state(hass, "adder_charges").state) == round(1 * 0.01341, 5)
    net = 2 * rate - rate + 0.01164 + 0.01341
    assert float(_state(hass, "net_cost").state) == round(net, 5)
    assert float(_state(hass, "import_cost").state) == round(2 * rate + 0.01164 + 0.01341, 5)
    assert _state(hass, "net_cost").attributes["device_class"] == "monetary"
    assert _state(hass, "net_cost").attributes["state_class"] == "total"

    cost_today = float(_state(hass, "cost_today").state)
    assert cost_today == round(net + 0.794, 2)

    bill = _state(hass, "bill_estimate")
    assert bill.attributes["cycle_start"] == "2026-01-01"
    assert bill.attributes["days_in_cycle"] == 14
    assert bill.attributes["import_kwh"] == 2.0
    assert bill.attributes["export_kwh"] == 1.0
    assert float(bill.state) == round(rate + 0.01164 + 0.01341 + 14 * 0.794, 2)


async def test_optional_entities_from_options(hass: HomeAssistant, freezer) -> None:
    freezer.move_to("2026-07-15 12:00:00-07:00")
    hass.states.async_set("sun.sun", "above_horizon", {"elevation": 50})
    for i, kw in enumerate((0.3, 0.3, 0.0), start=1):
        set_power(hass, f"sensor.panel_{i}", kw)
    hass.states.async_set("sensor.ev_charging", "on")
    hass.states.async_set("device_tracker.ev", "home")
    set_power(hass, "sensor.ev_power", 7.2)
    set_power(hass, "sensor.batt_power", -1.0)
    hass.states.async_set("sensor.batt_soc", "55")
    config = {
        **BASE_CONFIG,
        "panels": [
            {
                "label": "South",
                "panels": [{"power": f"sensor.panel_{i}"} for i in (1, 2, 3)],
            }
        ],
        "cars": [
            {
                "name": "Family EV",
                "charging": "sensor.ev_charging",
                "presence": "device_tracker.ev",
                "power": "sensor.ev_power",
            }
        ],
        "battery_power": "sensor.batt_power",
        "battery_soc": "sensor.batt_soc",
    }
    await setup_entry(hass, config)

    health = _state(hass, "panel_health")
    assert health.state == "South 3 no output"
    # the panels card reads its groups from here
    assert health.attributes["groups"] == [
        {
            "label": "South",
            "panels": [{"power": f"sensor.panel_{i}", "name": f"South {i}"} for i in (1, 2, 3)],
        }
    ]
    assert "diagnostics" not in health.attributes
    problem = _state(hass, "solar_problem", "binary_sensor")
    assert problem.state == "off"
    assert problem.attributes["problem_since"] is not None

    freezer.tick(timedelta(minutes=31))
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert _state(hass, "solar_problem", "binary_sensor").state == "on"

    assert _state(hass, "car_family_ev_charging_at_home", "binary_sensor").state == "on"
    assert _state(hass, "car_family_ev_home_charging_power").state == "7.2"
    hass.states.async_set("device_tracker.ev", "not_home")
    await hass.async_block_till_done()
    assert _state(hass, "car_family_ev_charging_at_home", "binary_sensor").state == "off"
    assert _state(hass, "car_family_ev_home_charging_power").state == "0.0"

    assert _state(hass, "battery_soc").state == "55.0"
    assert _state(hass, "battery_power").state == "-1000"
    assert _state(hass, "battery_charge_power").state == "1000"
    assert _state(hass, "battery_discharge_power").state == "0"
    # home = solar + grid + battery = 3 - 1 - 1
    assert _state(hass, "home_power").state == "1000"


async def test_no_optional_entities_by_default(hass: HomeAssistant) -> None:
    await setup_entry(hass)
    assert _state(hass, "panel_health") is None
    assert _state(hass, "solar_problem", "binary_sensor") is None
    assert _state(hass, "battery_soc") is None


async def test_nem3_export_rate(hass: HomeAssistant, freezer) -> None:
    freezer.move_to("2026-07-15 18:30:00-07:00")
    await setup_entry(hass, {**BASE_CONFIG, "nem": "nem3"})
    export = _state(hass, "export_rate")
    assert export.attributes["nem_version"] == "NEM 3.0 (net billing)"
    assert float(export.state) > 0


async def test_cycle_reset_on_cycle_day(hass: HomeAssistant, freezer) -> None:
    freezer.move_to("2026-01-31 23:50:00-08:00")
    await setup_entry(hass)
    set_energy(hass, 1000.0, 503.0, 200.0)
    await hass.async_block_till_done()
    assert _state(hass, "bill_estimate").attributes["import_kwh"] == 3.0

    # the 00:00:30 close stays in the old cycle, 00:00:45 starts the new one
    freezer.move_to("2026-02-01 00:00:30-08:00")
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert _state(hass, "bill_estimate").attributes["cycle_start"] == "2026-01-01"
    freezer.move_to("2026-02-01 00:00:45-08:00")
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    attrs = _state(hass, "bill_estimate").attributes
    assert attrs["cycle_start"] == "2026-02-01"
    assert attrs["import_kwh"] == 0.0
    # lifetime money is untouched
    assert float(_state(hass, "import_energy_charge").state) > 0


async def test_energy_units(hass: HomeAssistant) -> None:
    await setup_entry(hass)
    hass.states.async_set("sensor.pv_lifetime", "1002500", {"unit_of_measurement": "Wh"})
    await hass.async_block_till_done()
    assert float(_state(hass, "energy_produced").state) == 1002.5
