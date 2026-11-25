"""Tests for sources.py."""

import pytest

from custom_components.sunflow_solar import sources as s


@pytest.mark.parametrize(
    ("value", "unit", "expected"),
    [
        ("1500", "W", 1.5),
        (2.5, "kW", 2.5),
        ("0.002", "MW", 2.0),
        (0.000001, "GW", 1.0),
        ("3", None, 3.0),
        ("3", "kw", 3.0),
        ("750", " w ", 0.75),
        ("unavailable", "W", None),
        ("unknown", "kW", None),
        (None, "kW", None),
        ("nan", "kW", None),
        (True, "kW", None),
    ],
)
def test_to_kw(value, unit, expected):
    result = s.to_kw(value, unit)
    if expected is None:
        assert result is None
    else:
        assert result == pytest.approx(expected)


def test_to_kwh():
    assert s.to_kwh("1500", "Wh") == pytest.approx(1.5)
    assert s.to_kwh("2", "MWh") == pytest.approx(2000)
    assert s.to_kwh("x", "kWh") is None


def test_is_fresh():
    assert s.is_fresh(0)
    assert s.is_fresh(599.9)
    assert not s.is_fresh(600)
    assert not s.is_fresh(None)
    assert s.is_fresh(100, max_age_s=120)


def test_pick_fresh_live_wins_when_fresh():
    assert s.pick_fresh("2.0", 10, "1.0") == (2.0, "live")


def test_pick_fresh_stale_live_uses_meter():
    assert s.pick_fresh("2.0", 600, "1.0") == (1.0, "meter")
    assert s.pick_fresh("2.0", None, "1.0") == (1.0, "meter")


def test_pick_fresh_bad_live_uses_meter():
    assert s.pick_fresh("unavailable", 1, "1.0") == (1.0, "meter")


def test_pick_fresh_stale_live_and_dead_meter_is_unavailable():
    # A frozen live value must not turn into a false 0.
    assert s.pick_fresh("2.0", 900, "unavailable") is None
    assert s.pick_fresh(None, None, None) is None


def test_pick_fresh_units():
    r = s.pick_fresh("1800", 5, "1", live_unit="W", fallback_unit="kW")
    assert r.kw == pytest.approx(1.8)
    r = s.pick_fresh("1800", 5000, "900", live_unit="W", fallback_unit="W")
    assert r == (pytest.approx(0.9), "meter")


def test_solar_power_clamps_negative():
    assert s.solar_power("-0.01", 1, "0") == (0.0, "live")
    assert s.solar_power("x", 1, "-5", meter_unit="W") == (0.0, "meter")


def test_grid_power_signed_and_flipped():
    assert s.grid_power("-1.2", 1, None) == (pytest.approx(-1.2), "live")
    r = s.grid_power("-1.2", 1, None, positive_is_import=False)
    assert r.kw == pytest.approx(1.2)
    r = s.grid_power(None, None, "500", meter_unit="W", positive_is_import=False)
    assert r == (pytest.approx(-0.5), "meter")


def test_normalize_grid_sign():
    assert s.normalize_grid_sign(2.0) == 2.0
    assert s.normalize_grid_sign(2.0, positive_is_import=False) == -2.0


def test_home_power_live():
    assert s.home_power("1.5", 1, 3.0, -1.0) == (1.5, "live")
    assert s.home_power("-0.2", 1, 3.0, -1.0) == (0.0, "live")


def test_home_power_fallback():
    assert s.home_power("1.5", 700, 3.0, -1.0) == (pytest.approx(2.0), "solar + grid")
    assert s.home_power(None, None, 1.0, -3.0) == (0.0, "solar + grid")
    assert s.home_power(None, None, 1.0, 0.5, battery_kw=1.0) == (
        pytest.approx(2.5),
        "solar + grid",
    )


def test_home_power_unavailable():
    assert s.home_power(None, None, None, 1.0) is None
    assert s.home_power("1", 900, 1.0, None) is None


def test_import_export_split():
    assert s.grid_import_kw(1.5) == 1.5
    assert s.grid_export_kw(1.5) == 0.0
    assert s.grid_import_kw(-2.0) == 0.0
    assert s.grid_export_kw(-2.0) == 2.0


@pytest.mark.parametrize(
    ("solar", "home", "expected"),
    [(0, 0, 100), (1, -1, 100), (2, 1, 100), (0.5, 2, 25), (0, 2, 0), (1, 3, 33)],
)
def test_self_sufficiency(solar, home, expected):
    assert s.self_sufficiency(solar, home) == expected


@pytest.mark.parametrize(
    ("solar", "grid", "expected"),
    [
        (5.0, -0.026, "Exporting"),
        (5.0, -0.025, "Producing"),
        (0.026, 1.0, "Producing"),
        (0.025, 1.0, "Importing"),
        (0.0, 0.0, "Importing"),
        (0.0, -1.0, "Exporting"),
    ],
)
def test_status(solar, grid, expected):
    assert s.status(solar, grid) == expected
    assert s.status_icon(solar, grid) == s.STATUS_ICONS[expected]


def test_status_summary():
    assert s.status_summary(4.1, -2.9, 1.2) == ("Solar 4.10 kW, home 1.20 kW, exporting 2.90 kW")
    assert s.status_summary(0, 1.234, 1.234) == ("Solar 0.00 kW, home 1.23 kW, importing 1.23 kW")
    assert s.status_summary(1, 0.01, 1.01).endswith("grid balanced")


def test_kw_to_w():
    assert s.kw_to_w(1.2345) == 1234
    assert s.kw_to_w(0) == 0


def test_clamp_total():
    assert s.clamp_total("10.5", "10.0") == 10.5
    assert s.clamp_total("9.0", "10.0") == 10.0  # dip ignored
    assert s.clamp_total("0", "10.0") == 10.0  # reset ignored
    assert s.clamp_total("unavailable", "10.0") == 10.0
    assert s.clamp_total("unavailable", None) is None
    assert s.clamp_total("0", None) is None  # meter not loaded yet
    assert s.clamp_total("1.23456", None) == 1.235
    assert s.clamp_total(5, "unknown") == 5.0


def test_freshest_age():
    assert s.freshest_age(30, None, 5) == 5
    assert s.freshest_age(None, None) is None


def test_battery_soc():
    assert s.battery_soc("55") == 55.0
    assert s.battery_soc("101") == 100.0
    assert s.battery_soc(-1) == 0.0
    assert s.battery_soc("unknown") is None


def test_battery_power_sign():
    assert s.battery_power("2000", "W") == pytest.approx(2.0)
    assert s.battery_power("2", "kW", positive_is_discharge=False) == -2.0
    assert s.battery_power("x") is None


def test_battery_split():
    assert s.battery_split(2.0) == (0.0, 2.0)
    assert s.battery_split(-3.0) == (3.0, 0.0)
    assert s.battery_split(0.0) == (0.0, 0.0)


def test_charging_at_home():
    assert s.charging_at_home("on", "home")
    assert not s.charging_at_home("on", "not_home")
    assert not s.charging_at_home("off", "home")
    assert s.charging_at_home("on")  # no tracker configured
    assert s.charging_at_home(True, None)
    assert not s.charging_at_home("unavailable", "home")


def test_home_charging_power():
    assert s.home_charging_power("7.2", "kW", "on", "home") == 7.2
    assert s.home_charging_power("7200", "W", "on", None) == pytest.approx(7.2)
    assert s.home_charging_power("7.2", "kW", "on", "away") == 0.0
    assert s.home_charging_power("unknown", "kW", "on", "home") == 0.0
