"""Tests for simulator.py."""

import pytest

from custom_components.sunflow_solar import simulator as sim


@pytest.mark.parametrize("scenario", sim.SCENARIOS)
@pytest.mark.parametrize("tod", sim.TIMES)
def test_every_scenario_balances(scenario, tod):
    for t in (0, 13.7, 600, 86_400):
        d = sim.simulate(scenario, tod, t)
        assert d["home_kw"] == pytest.approx(
            d["solar_kw"] + d["grid_kw"] + d["battery_kw"], abs=0.002
        )
        assert d["solar_kw"] >= 0
        assert d["home_kw"] > 0
        assert 0 <= d["battery_soc"] <= 100
        assert 0 <= d["self_sufficiency"] <= 100
        assert 0 <= d["self_sufficiency_today"] <= 100
        assert d["used_today"] == pytest.approx(
            d["produced_today"] - d["exported_today"] + d["imported_today"], abs=0.02
        )
        assert len(d["cars"]) == 2
        for car in d["cars"]:
            assert car["soc"] <= car["limit"]
            if car["charging"]:
                assert car["plugged"] and car["home"] and car["power_kw"] > 0
            else:
                assert car["power_kw"] == 0


def test_deterministic():
    assert sim.simulate("cloudy", "day", 42.5) == sim.simulate("cloudy", "day", 42.5)


def test_drift_is_small_and_smooth():
    a = sim.simulate("normal", "day", 10)
    b = sim.simulate("normal", "day", 11)
    assert a != b
    assert abs(a["solar_kw"] - b["solar_kw"]) < 0.05
    assert abs(a["solar_kw"] - 5.2) <= 5.2 * 0.04 + 1e-9


def test_night_has_no_solar():
    for scenario in sim.SCENARIOS:
        d = sim.simulate(scenario, "night", 5)
        assert d["solar_kw"] == 0
        assert d["status"] in ("Importing", "Exporting")
        assert d["period"] == "on_peak"


def test_scenario_shapes():
    assert sim.simulate("normal", "day")["status"] == "Exporting"
    assert sim.simulate("high-usage", "day")["grid_kw"] > 0
    assert sim.simulate("high-generation", "day")["grid_export_kw"] > 5
    assert sim.simulate("cloudy", "day", 0)["solar_kw"] < 2

    cars = sim.simulate("car-charging", "day")["cars"]
    assert [c["charging"] for c in cars] == [True, False]

    cars = sim.simulate("both-plugged", "day")["cars"]
    assert [c["plugged"] for c in cars] == [True, True]
    assert cars[1]["soc"] == cars[1]["limit"]

    cars = sim.simulate("car-away", "day")["cars"]
    assert [c["home"] for c in cars] == [False, True]

    assert sim.simulate("battery-charging", "day")["battery_kw"] < 0
    assert sim.simulate("battery-discharging", "night")["battery_kw"] > 0


def test_night_today_is_believable():
    # after sunset the grid covers the evening, so solar can't be 100 %
    for scenario in sim.SCENARIOS:
        d = sim.simulate(scenario, "night", 0)
        share = (d["produced_today"] - d["exported_today"]) / d["used_today"]
        assert share <= 0.505, scenario  # totals are rounded to 0.01 kWh
        assert d["self_sufficiency_today"] < 100, scenario
    # a big solar day still shows a big solar share at night, just not all of it
    assert sim.simulate("high-generation", "night")["self_sufficiency_today"] == 50


def test_battery_charging_holds_at_night():
    d = sim.simulate("battery-charging", "night", 0)
    assert d["battery_kw"] == 0
    assert d["battery_soc"] >= 90
    # nothing charges from the grid, so there's no credit to brag about
    assert d["cost_today"] > 0


def test_car_charging_adds_to_home():
    base = sim.simulate("normal", "night", 0)
    charging = sim.simulate("car-charging", "night", 0)
    car_kw = charging["cars"][0]["power_kw"]
    assert charging["home_kw"] == pytest.approx(base["home_kw"] + car_kw, abs=0.002)
    assert charging["used_today"] > base["used_today"]


def test_cost_rate_sign():
    exporting = sim.simulate("high-generation", "day")
    assert exporting["cost_rate"] < 0
    assert exporting["rate"] == exporting["import_rate"]
    importing = sim.simulate("high-usage", "night")
    assert importing["cost_rate"] == pytest.approx(importing["grid_kw"] * 0.52, abs=0.001)


def test_aliases_and_errors():
    assert sim.simulate("car_charging")["scenario"] == "car-charging"
    with pytest.raises(ValueError):
        sim.simulate("party")
    with pytest.raises(ValueError):
        sim.simulate("normal", "dusk")
