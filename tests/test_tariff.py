"""Tariff engine tests. Pure Python, no Home Assistant instance needed."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
import yaml

from custom_components.daymill.tariff import (
    TariffEngine,
    TariffError,
    list_presets,
    load_export_table,
    load_preset,
    load_tariff,
    parse_export_table,
    validate,
)
from custom_components.daymill.tariff.loader import PRESET_DIR, TARIFF_DIR

LA = ZoneInfo("America/Los_Angeles")


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations():
    """These tests don't need hass; override the conftest fixture."""
    yield


@pytest.fixture(scope="module")
def tariff():
    return load_preset("sce_tou_d_prime")


@pytest.fixture
def engine(tariff):
    return TariffEngine(tariff)


def at(y, mo, d, h=0, mi=0, fold=0):
    return datetime(y, mo, d, h, mi, tzinfo=LA, fold=fold)


# ---------------------------------------------------------------------------
# Reference port of the period and holiday rules, written out longhand.
# ---------------------------------------------------------------------------


def ref_holidays(year):
    out = {}
    for y in (year, year + 1):
        for m, d, name in [
            (1, 1, "New Year's Day"),
            (7, 4, "Independence Day"),
            (11, 11, "Veterans Day"),
            (12, 25, "Christmas Day"),
        ]:
            x = date(y, m, d)
            x = x + timedelta(days=1) if x.weekday() == 6 else x
            out[x.isoformat()] = name
        for m, wd, n, name in [
            (2, 0, 3, "Presidents' Day"),
            (9, 0, 1, "Labor Day"),
            (11, 3, 4, "Thanksgiving"),
        ]:
            f = date(y, m, 1)
            x = f + timedelta(days=(wd - f.weekday()) % 7 + 7 * (n - 1))
            out[x.isoformat()] = name
        last = date(y, 5, 31)
        out[(last - timedelta(days=last.weekday())).isoformat()] = "Memorial Day"
    return dict(sorted(out.items()))


def ref_period(t, hol):
    we = t.weekday() >= 5 or t.date().isoformat() in hol
    if 6 <= t.month <= 9:
        return "summer", (("mid_peak" if we else "on_peak") if 16 <= t.hour < 21 else "off_peak")
    if 16 <= t.hour < 21:
        return "winter", "mid_peak"
    return "winter", ("super_off_peak" if 8 <= t.hour < 16 else "off_peak")


def ref_next(t, hol):
    for i in range(3):
        d = t + timedelta(days=i)
        s = "summer" if 6 <= d.month <= 9 else "winter"
        hrs = ([0] if d.day == 1 and d.month in (6, 10) else []) + (
            [16, 21] if s == "summer" else [8, 16, 21]
        )
        for h in hrs:
            b = d.replace(hour=h, minute=0, second=0, microsecond=0)
            if b > t:
                bwe = b.weekday() >= 5 or b.date().isoformat() in hol
                if s == "summer":
                    p = ("mid_peak" if bwe else "on_peak") if h == 16 else "off_peak"
                else:
                    p = {8: "super_off_peak", 16: "mid_peak"}.get(h, "off_peak")
                return b, p, s
    return None


def ref_attrs(t):
    hol = ref_holidays(t.year)
    season, cur = ref_period(t, hol)
    is_hol = t.date().isoformat() in hol
    m = t - timedelta(minutes=3)
    ms, mp = ref_period(m, hol)
    b, p, s = ref_next(t, hol)
    return {
        "season": season,
        "period": cur,
        "day_type": "holiday" if is_hol else ("weekend" if t.weekday() >= 5 else "weekday"),
        "holiday": hol.get(t.date().isoformat()),
        "metering": (ms, mp),
        "next": (b, p, s),
    }


# ---------------------------------------------------------------------------
# Preset and loader
# ---------------------------------------------------------------------------


def test_preset_listed():
    assert list_presets()["sce_tou_d_prime"] == "SCE TOU-D-PRIME (unofficial)"


def test_preset_numbers(tariff):
    assert tariff.effective_date == date(2026, 10, 1)
    assert tariff.timezone == "America/Los_Angeles"
    assert tariff.daily_charge == 0.794
    assert tariff.nbc.per_kwh == 0.01164
    assert tariff.nbc.parts == {"PPPC": 0.00556, "NDC": 0.00003, "CTC": 0.00014, "WFC": 0.00591}
    assert tariff.nbc.interval_minutes == 60
    assert [(a.key, a.per_kwh, a.basis) for a in tariff.adders] == [
        ("frc", 0.01118, "net_interval"),
        ("mcam", 0.00223, "net_interval"),
    ]
    assert tariff.nem["nem2"]["nscr"] == 0.01997
    assert tariff.nem["nem3"]["export_table"] == "nbt/sce_nbt_2026.yaml"
    assert tariff.extras["climate_credit"] == -36.0
    assert len(tariff.extras["unverified_items"]) == 4
    assert [s.start for s in tariff.seasons] == [(6, 1), (10, 1)]
    assert tariff.holiday_sunday_shift is True


def test_preset_is_clean():
    text = (PRESET_DIR / "sce_tou_d_prime.yaml").read_text().lower()
    for bad in ("/users/", "todo"):
        assert bad not in text


REF_DELIVERY = {
    "summer": {"on_peak": 0.30084, "mid_peak": 0.29960, "off_peak": 0.19997},
    "winter": {"mid_peak": 0.23566, "off_peak": 0.22256, "super_off_peak": 0.20645},
}
REF_GENERATION = {
    "summer": {"on_peak": 0.31175, "mid_peak": 0.09775, "off_peak": 0.06683},
    "winter": {"mid_peak": 0.21627, "off_peak": 0.08096, "super_off_peak": 0.04428},
}


def _ref_table(extra):
    return {
        s: {p: round(row[p] + REF_GENERATION[s][p] + extra, 5) for p in row}
        for s, row in REF_DELIVERY.items()
    }


def test_tables_match_reference(engine):
    t = engine.tables()
    assert list(t) == [
        "delivery_table",
        "generation_table",
        "period_total_table",
        "rate_table",
        "energy_rate_table",
    ]
    assert t["delivery_table"] == REF_DELIVERY
    assert t["generation_table"] == REF_GENERATION
    assert t["period_total_table"] == _ref_table(0)
    assert t["rate_table"] == _ref_table(0.01118 + 0.00223)
    assert t["energy_rate_table"] == _ref_table(-0.01164)
    # rows keep the tariff's season and period order
    for name in t:
        assert list(t[name]) == ["summer", "winter"]
        assert list(t[name]["summer"]) == ["on_peak", "mid_peak", "off_peak"]
        assert list(t[name]["winter"]) == ["mid_peak", "off_peak", "super_off_peak"]


EXPECTED = {
    # key: (when, period_total, import price, nem2 energy/export rate)
    "summer_on_peak": (at(2026, 7, 15, 17), 0.61259, 0.62600, 0.60095),
    "summer_mid_peak": (at(2026, 7, 18, 17), 0.39735, 0.41076, 0.38571),
    "summer_off_peak": (at(2026, 7, 15, 10), 0.26680, 0.28021, 0.25516),
    "winter_mid_peak": (at(2026, 12, 2, 17), 0.45193, 0.46534, 0.44029),
    "winter_off_peak": (at(2026, 12, 2, 22), 0.30352, 0.31693, 0.29188),
    "winter_super_off_peak": (at(2026, 12, 2, 10), 0.25073, 0.26414, 0.23909),
}


@pytest.mark.parametrize("key", list(EXPECTED))
def test_prices_all_periods(engine, tariff, key):
    when, total, imp, energy = EXPECTED[key]
    info = engine.period_at(when)
    assert info.key == key
    assert engine.period_total(info) == total
    assert engine.import_price(when) == imp
    assert engine.energy_rate(info) == energy
    assert engine.export_price(when) == energy
    # energy rate + NBCs + FRC + MCAM = import price
    assert round(energy + 0.01164 + engine.interval_adders_per_kwh, 5) == imp
    nem1 = TariffEngine(tariff, nem="nem1")
    assert nem1.export_price(when) == total
    assert nem1.import_price(when) == imp
    assert TariffEngine(tariff, nem="none").export_price(when) == 0.0


def test_rate_attributes(engine):
    a = engine.rate_attributes(at(2026, 7, 15, 17))
    assert a["period"] == "on_peak" and a["label"] == "On-Peak" and a["season"] == "summer"
    assert a["delivery"] == 0.30084 and a["generation"] == 0.31175
    assert a["period_total"] == 0.61259
    assert a["frc"] == 0.01118 and a["mcam"] == 0.00223
    assert a["interval_adders_per_kwh"] == 0.01341
    assert a["nbc_per_kwh"] == 0.01164
    assert a["net_surplus_compensation_rate"] == 0.01997
    assert a["climate_credit"] == -36.0
    assert a["effective_date"] == "2026-10-01"
    assert a["daily_charge"] == 0.794


# ---------------------------------------------------------------------------
# Periods and boundaries
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("when", "key"),
    [
        (at(2026, 5, 31, 23, 59), "winter_off_peak"),
        (at(2026, 6, 1, 0, 0), "summer_off_peak"),
        (at(2026, 9, 30, 23, 59), "summer_off_peak"),
        (at(2026, 10, 1, 0, 0), "winter_off_peak"),
        (at(2026, 12, 2, 7, 59), "winter_off_peak"),
        (at(2026, 12, 2, 8, 0), "winter_super_off_peak"),
        (at(2026, 12, 2, 15, 59), "winter_super_off_peak"),
        (at(2026, 12, 2, 16, 0), "winter_mid_peak"),
        (at(2026, 12, 2, 20, 59), "winter_mid_peak"),
        (at(2026, 12, 2, 21, 0), "winter_off_peak"),
        (at(2026, 7, 15, 15, 59), "summer_off_peak"),
        (at(2026, 7, 15, 16, 0), "summer_on_peak"),
        (at(2026, 7, 15, 21, 0), "summer_off_peak"),
        (at(2026, 7, 15, 8, 0), "summer_off_peak"),
    ],
)
def test_boundaries(engine, when, key):
    assert engine.period_at(when).key == key


@pytest.mark.parametrize(
    ("when", "key"),
    [
        (at(2026, 12, 2, 8, 2), "winter_off_peak"),
        (at(2026, 12, 2, 8, 3), "winter_super_off_peak"),
        (at(2026, 12, 2, 16, 0), "winter_super_off_peak"),
        (at(2026, 12, 2, 16, 2), "winter_super_off_peak"),
        (at(2026, 12, 2, 16, 3), "winter_mid_peak"),
        (at(2026, 12, 2, 21, 2), "winter_mid_peak"),
        (at(2026, 12, 2, 21, 3), "winter_off_peak"),
        (at(2026, 7, 15, 16, 1), "summer_off_peak"),
        (at(2026, 7, 15, 16, 3), "summer_on_peak"),
        (at(2026, 7, 15, 21, 2), "summer_on_peak"),
        (at(2026, 6, 1, 0, 2), "winter_off_peak"),
        (at(2026, 10, 1, 0, 2), "summer_off_peak"),
        (at(2026, 10, 1, 0, 3), "winter_off_peak"),
    ],
)
def test_metering_lag(engine, when, key):
    assert engine.metering_period_at(when).key == key


def test_day_types_summer(engine):
    # Fri Jul 3 2026: weekday. Sat Jul 4 2026: holiday, not moved. Sun Jul 5: weekend.
    fri = engine.period_at(at(2026, 7, 3, 17))
    assert (fri.day_type, fri.period) == ("weekday", "on_peak")
    sat = engine.period_at(at(2026, 7, 4, 17))
    assert (sat.day_type, sat.holiday, sat.period) == ("holiday", "Independence Day", "mid_peak")
    sun = engine.period_at(at(2026, 7, 5, 17))
    assert (sun.day_type, sun.holiday, sun.period) == ("weekend", None, "mid_peak")
    labor = engine.period_at(at(2026, 9, 7, 17))
    assert (labor.day_type, labor.holiday, labor.period) == ("holiday", "Labor Day", "mid_peak")
    assert engine.import_price(at(2026, 9, 7, 17)) == 0.41076
    assert engine.import_price(at(2026, 9, 8, 17)) == 0.62600


def test_sunday_shift(engine):
    # Jul 4 2027 is a Sunday: Monday Jul 5 is the holiday
    mon = engine.period_at(at(2027, 7, 5, 17))
    assert (mon.day_type, mon.holiday, mon.period) == ("holiday", "Independence Day", "mid_peak")
    sun = engine.period_at(at(2027, 7, 4, 17))
    assert (sun.day_type, sun.holiday) == ("weekend", None)
    h = engine.holidays(2022)
    assert h[date(2022, 12, 26)] == "Christmas Day"
    assert date(2022, 12, 25) not in h
    assert engine.holidays(2023)[date(2023, 1, 2)] == "New Year's Day"


def test_holiday_dates_match_reference(engine):
    for y in (2025, 2026, 2027, 2028, 2032):
        assert engine.holiday_dates(at(y, 3, 1)) == ref_holidays(y)
    h = engine.holidays(2026)
    assert h[date(2026, 2, 16)] == "Presidents' Day"
    assert h[date(2026, 5, 25)] == "Memorial Day"
    assert h[date(2026, 11, 26)] == "Thanksgiving"
    assert engine.period_at(at(2026, 11, 11, 12)).holiday == "Veterans Day"


# ---------------------------------------------------------------------------
# next_change
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("when", "nxt", "key"),
    [
        (at(2026, 7, 3, 15), at(2026, 7, 3, 16), "summer_on_peak"),
        (at(2026, 7, 3, 16), at(2026, 7, 3, 21), "summer_off_peak"),
        (at(2026, 7, 3, 22), at(2026, 7, 4, 16), "summer_mid_peak"),
        (at(2026, 12, 2, 1), at(2026, 12, 2, 8), "winter_super_off_peak"),
        (at(2026, 12, 2, 21), at(2026, 12, 3, 8), "winter_super_off_peak"),
        (at(2026, 5, 31, 22), at(2026, 6, 1, 0), "summer_off_peak"),
        (at(2026, 9, 30, 21), at(2026, 10, 1, 0), "winter_off_peak"),
        (at(2026, 10, 1, 0), at(2026, 10, 1, 8), "winter_super_off_peak"),
    ],
)
def test_next_change(engine, when, nxt, key):
    b, info = engine.next_change(when)
    assert b == nxt
    assert info.key == key


def test_dst_days(engine):
    # spring forward Mar 8 2026, fall back Nov 1 2026
    assert engine.period_at(at(2026, 3, 8, 16)).key == "winter_mid_peak"
    b, info = engine.next_change(at(2026, 3, 8, 1, 30))
    assert b == at(2026, 3, 8, 8) and info.period == "super_off_peak"
    assert b.astimezone(UTC) - at(2026, 3, 8, 1, 30).astimezone(UTC) == timedelta(
        hours=5, minutes=30
    )
    second = at(2026, 11, 1, 1, 30, fold=1)
    b, _ = engine.next_change(second)
    assert b == at(2026, 11, 1, 8)
    assert b.astimezone(UTC) - second.astimezone(UTC) == timedelta(hours=6, minutes=30)
    # UTC input is converted to local time
    assert engine.period_at(datetime(2026, 11, 2, 0, 30, tzinfo=UTC)).key == "winter_mid_peak"
    assert engine.metering_period_at(datetime(2026, 3, 8, 23, 2, tzinfo=UTC)).key == (
        "winter_super_off_peak"
    )


def test_sweep_matches_reference(engine):
    """Every 7 minutes for two years, plus a minute-by-minute pass near each boundary."""
    times = []
    t = at(2026, 1, 1)
    end = at(2028, 1, 3)
    while t < end:
        times.append(t)
        t = (t.astimezone(UTC) + timedelta(minutes=7)).astimezone(LA)
    for d in (date(2026, 6, 1), date(2026, 10, 1), date(2027, 7, 5), date(2026, 9, 7)):
        for h in (0, 8, 16, 21):
            base = datetime(d.year, d.month, d.day, h, tzinfo=LA)
            times += [base + timedelta(minutes=m) for m in range(-5, 6)]
    for t in times:
        ref = ref_attrs(t)
        attrs = engine.period_attributes(t)
        assert attrs["season"] == ref["season"], t
        assert attrs["tariff"] == f"{ref['season']}_{ref['period']}", t
        assert attrs["day_type"] == ref["day_type"], t
        assert attrs["holiday"] == ref["holiday"], t
        assert (attrs["metering_season"], attrs["metering_period"]) == ref["metering"], t
        b, p, s = ref["next"]
        assert attrs["next_change"] == b.isoformat(), t
        assert (attrs["next_period"], attrs["next_season"]) == (p, s), t


def test_period_attributes_shape(engine):
    a = engine.period_attributes(at(2026, 7, 3, 15, 0))
    assert a == {
        "season": "summer",
        "day_type": "weekday",
        "holiday": None,
        "label": "Off-Peak",
        "tariff": "summer_off_peak",
        "next_change": "2026-07-03T16:00:00-07:00",
        "next_period": "on_peak",
        "next_period_label": "On-Peak",
        "next_season": "summer",
        "metering_season": "summer",
        "metering_period": "off_peak",
        "metering_tariff": "summer_off_peak",
        "plan": "SCE TOU-D-PRIME",
        "source": "TOU-D Sheet 8 (Cal. PUC 91696-E) periods, Sheet 9 (91697-E) seasons and holidays",
    }


# ---------------------------------------------------------------------------
# NEM 3.0 export table
# ---------------------------------------------------------------------------


def _table_data():
    prices = {}
    for m in range(1, 13):
        prices[m] = {
            "weekday": [round(m / 100 + h / 10000, 5) for h in range(24)],
            "weekend": [round(m / 100 + h / 10000 + 0.5, 5) for h in range(24)],
        }
    return {
        "utility": "Example Utility",
        "name": "Test export prices",
        "effective_date": "2026-01-01",
        "source_urls": ["https://example.com/acc"],
        "notes": "test only",
        "prices": prices,
    }


@pytest.fixture
def table_file(tmp_path):
    path = tmp_path / "nbt.yaml"
    path.write_text(yaml.safe_dump(_table_data()))
    return path


def test_export_table_loads(table_file):
    table = load_export_table(table_file)
    assert table.utility == "Example Utility"
    assert table.effective_date == date(2026, 1, 1)
    assert table.price(7, "weekday", 17) == 0.0717
    assert table.price(7, "holiday", 17) == 0.5717


def test_nem3_export_price(tariff, table_file):
    eng = TariffEngine(tariff, nem="nem3", export_table=load_export_table(table_file))
    assert eng.export_price(at(2026, 7, 3, 17, 30)) == 0.0717  # weekday
    assert eng.export_price(at(2026, 7, 4, 17, 30)) == 0.5717  # holiday -> weekend
    assert eng.export_price(at(2026, 7, 5, 0, 10)) == 0.57  # weekend
    assert eng.export_price(datetime(2026, 12, 2, 7, 59, tzinfo=UTC)) == 0.1223  # 23:59 local Dec 1
    assert eng.import_price(at(2026, 7, 3, 17)) == 0.626
    assert eng.energy_rate(eng.period_at(at(2026, 7, 3, 17))) == 0.60095


def test_nem3_table_from_tariff_file(tariff, table_file):
    data = yaml.safe_load((PRESET_DIR / "sce_tou_d_prime.yaml").read_text())
    data["nem"]["nem3"] = {"export_table": str(table_file)}
    eng = TariffEngine(load_tariff(data), nem="nem3")
    assert eng.export_price(at(2026, 1, 5, 3)) == 0.0103


def test_nem3_inline_prices():
    data = yaml.safe_load((PRESET_DIR / "sce_tou_d_prime.yaml").read_text())
    data["nem"]["nem3"] = {"export_prices": _table_data()["prices"]}
    eng = TariffEngine(load_tariff(data), nem="nem3")
    assert eng.export_price(at(2026, 2, 7, 12)) == 0.5212


def test_bundled_nbt_table_if_present(tariff):
    path = TARIFF_DIR / tariff.nem["nem3"]["export_table"]
    if not path.exists():
        pytest.skip("NBT table not added yet")
    eng = TariffEngine(tariff, nem="nem3")
    assert isinstance(eng.export_price(at(2026, 7, 3, 17)), float)


def test_export_table_errors():
    bad = _table_data()
    del bad["prices"][3]
    bad["prices"][4]["weekday"] = bad["prices"][4]["weekday"][:23]
    bad["prices"][5]["weekend"][2] = "x"
    with pytest.raises(TariffError) as err:
        parse_export_table(bad)
    msg = str(err.value)
    assert "missing month 3" in msg
    assert "prices.4.weekday: needs 24 hourly prices, got 23" in msg
    assert "prices.5.weekend[2]" in msg


def test_missing_export_table_file(tariff):
    data = yaml.safe_load((PRESET_DIR / "sce_tou_d_prime.yaml").read_text())
    data["nem"]["nem3"] = {"export_table": "nbt/does_not_exist.yaml"}
    with pytest.raises(TariffError, match="file not found"):
        TariffEngine(load_tariff(data), nem="nem3")


# ---------------------------------------------------------------------------
# Validation and generic tariffs
# ---------------------------------------------------------------------------


def _preset_data():
    return yaml.safe_load((PRESET_DIR / "sce_tou_d_prime.yaml").read_text())


def test_validate_ok():
    assert validate(_preset_data()) == []


def test_validate_reports_everything():
    data = _preset_data()
    data["timezone"] = "Mars/Olympus"
    data["seasons"][0]["rules"][0]["windows"] = [["25:00", "21:00"]]
    data["seasons"][1]["start"] = "13-01"
    del data["components"][1]["per_kwh"]["winter"]["super_off_peak"]
    data["adders"][0]["basis"] = "sometimes"
    data["nbc"]["parts"]["PPPC"] = 0.1
    data["holidays"]["rules"][4]["weekday"] = "funday"
    data["nem"]["nem4"] = {}
    errors = validate(data)
    joined = "\n".join(errors)
    assert "timezone: unknown time zone 'Mars/Olympus'" in joined
    assert "seasons[0].rules[0].windows[0]: bad time '25:00'" in joined
    assert "seasons[1].start: bad month-day '13-01'" in joined
    assert "components[1].per_kwh.winter: missing price for period 'super_off_peak'" in joined
    assert "adders[0].basis: unknown basis 'sometimes'" in joined
    assert "nbc.parts: parts add up to" in joined
    assert "holidays.rules[4].weekday: bad weekday 'funday'" in joined
    assert "nem: unknown NEM mode 'nem4'" in joined
    with pytest.raises(TariffError, match="invalid tariff"):
        load_tariff(data)


def test_validate_not_a_mapping():
    assert validate([1, 2]) == ["tariff must be a mapping"]


def test_bad_yaml_file(tmp_path):
    p = tmp_path / "x.yaml"
    p.write_text("id: [unclosed")
    with pytest.raises(TariffError, match="bad YAML"):
        load_tariff(p)
    with pytest.raises(TariffError, match="file not found"):
        load_tariff(tmp_path / "nope.yaml")


def test_unquoted_yaml_times_and_wrapping_window():
    # unquoted 22:00 is read by YAML 1.1 as the int 1320; it still works
    data = yaml.safe_load(
        """
id: test_flat
name: Test
timezone: UTC
effective_date: 2026-01-01
seasons:
  - key: all
    start: "01-01"
    default_period: day
    rules:
      - period: night
        days: all
        windows: [[22:00, 06:00]]
components:
  - key: energy
    per_kwh: {all: {day: 0.2, night: 0.1}}
"""
    )
    tariff = load_tariff(data)
    eng = TariffEngine(tariff, nem="nem1")
    u = UTC
    assert eng.period_at(datetime(2026, 1, 1, 23, tzinfo=u)).period == "night"
    assert eng.period_at(datetime(2026, 1, 2, 5, 59, tzinfo=u)).period == "night"
    assert eng.period_at(datetime(2026, 1, 2, 6, tzinfo=u)).period == "day"
    assert eng.import_price(datetime(2026, 1, 2, 12, tzinfo=u)) == 0.2
    assert eng.export_price(datetime(2026, 1, 2, 12, tzinfo=u)) == 0.2
    b, info = eng.next_change(datetime(2026, 1, 2, 12, tzinfo=u))
    assert b == datetime(2026, 1, 2, 22, tzinfo=u) and info.period == "night"
    assert tariff.period_labels == {"day": "Day", "night": "Night"}
    assert tariff.nbc is None


def test_single_period_has_no_change():
    data = {
        "id": "flat",
        "name": "Flat",
        "timezone": "UTC",
        "effective_date": "2026-01-01",
        "seasons": [{"key": "all", "start": "01-01", "default_period": "flat"}],
        "components": [{"key": "energy", "per_kwh": {"all": {"flat": 0.3}}}],
    }
    eng = TariffEngine(load_tariff(data))
    assert eng.next_change(datetime(2026, 5, 1, tzinfo=UTC)) is None
    assert eng.energy_rate(eng.period_at(datetime(2026, 5, 1, tzinfo=UTC))) == 0.3


def test_season_wraps_year():
    data = {
        "id": "w",
        "name": "Wrap",
        "timezone": "UTC",
        "effective_date": "2026-01-01",
        "seasons": [
            {"key": "summer", "start": "05-01", "default_period": "p"},
            {"key": "winter", "start": "11-01", "default_period": "p"},
        ],
        "components": [{"key": "e", "per_kwh": {"summer": {"p": 0.2}, "winter": {"p": 0.1}}}],
    }
    eng = TariffEngine(load_tariff(data))
    assert eng.period_at(datetime(2026, 2, 1, tzinfo=UTC)).season == "winter"
    assert eng.period_at(datetime(2026, 5, 1, tzinfo=UTC)).season == "summer"
    b, info = eng.next_change(datetime(2026, 2, 1, tzinfo=UTC))
    assert b == datetime(2026, 5, 1, tzinfo=UTC) and info.key == "summer_p"


def test_bad_nem_mode(tariff):
    with pytest.raises(TariffError):
        TariffEngine(tariff, nem="nem9")


def test_preset_file_parses_as_plain_yaml():
    assert isinstance(yaml.safe_load(Path(PRESET_DIR / "sce_tou_d_prime.yaml").read_text()), dict)


def test_energy_rate_table_follows_nem_mode(tariff):
    for nem, nbc in (("nem2", -0.01164), ("nem3", -0.01164), ("nem1", 0), ("none", 0)):
        eng = TariffEngine(tariff, nem=nem)
        assert eng.tables()["energy_rate_table"] == _ref_table(nbc), nem
        info = eng.period_at(at(2026, 12, 2, 10))
        assert eng.tables()["energy_rate_table"][info.season][info.period] == eng.energy_rate(info)


def test_metering_lag_subtracts_real_time(engine):
    first = datetime(2026, 11, 1, 8, 1, tzinfo=UTC)  # 01:01 PDT
    second = datetime(2026, 11, 1, 9, 1, tzinfo=UTC)  # 01:01 PST
    lag = engine.metering_lag
    assert engine.metering_period_at(second) == engine.period_at(second - lag)
    assert engine.metering_period_at(first) == engine.period_at(first - lag)
