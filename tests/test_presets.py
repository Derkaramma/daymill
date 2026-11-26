"""Checks every bundled rate preset and NEM 3.0 export price file."""

from __future__ import annotations

from datetime import date, time

import pytest
import yaml

from custom_components.daymill.billing import nbt_options
from custom_components.daymill.tariff import (
    TariffEngine,
    list_presets,
    load_export_table,
    load_tariff,
    validate,
)
from custom_components.daymill.tariff.loader import PRESET_DIR, TARIFF_DIR

PRESET_FILES = sorted(PRESET_DIR.glob("*.yaml"))
NBT_FILES = sorted((TARIFF_DIR / "nbt").glob("*.yaml"))
DAY_TYPES = ("weekday", "weekend", "holiday")
YEARS = (2026, 2027, 2028)

# Hour by hour (0-23), one letter per hour:
# P on-peak/peak, M mid-peak, O off-peak, S super off-peak, F flat.
LETTERS = {
    "on_peak": "P",
    "peak": "P",
    "mid_peak": "M",
    "off_peak": "O",
    "super_off_peak": "S",
    "flat": "F",
}
SCE_TOU_D = {
    "summer": {
        "weekday": "OOOOOOOOOOOOOOOOPPPPPOOO",
        "weekend": "OOOOOOOOOOOOOOOOMMMMMOOO",
        "holiday": "OOOOOOOOOOOOOOOOMMMMMOOO",
    },
    "winter": dict.fromkeys(DAY_TYPES, "OOOOOOOOSSSSSSSSMMMMMOOO"),
}
EXPECTED_HOURS = {
    "sce_tou_d_prime": SCE_TOU_D,
    "sce_tou_d_4_9pm": SCE_TOU_D,
    "pge_e_tou_c": {
        s: dict.fromkeys(DAY_TYPES, "OOOOOOOOOOOOOOOOPPPPPOOO") for s in ("summer", "winter")
    },
    "sdge_tou_dr1": {
        s: {
            "weekday": "SSSSSSOOOOSSSSOOPPPPPOOO",
            "weekend": "SSSSSSSSSSSSSSOOPPPPPOOO",
            "holiday": "SSSSSSSSSSSSSSOOPPPPPOOO",
        }
        for s in ("summer", "winter")
    },
    "flat_example": {"all_year": dict.fromkeys(DAY_TYPES, "F" * 24)},
}
# First day of each season, as (month, day)
EXPECTED_SEASONS = {
    "sce_tou_d_prime": {"summer": (6, 1), "winter": (10, 1)},
    "sce_tou_d_4_9pm": {"summer": (6, 1), "winter": (10, 1)},
    "pge_e_tou_c": {"summer": (6, 1), "winter": (10, 1)},
    "sdge_tou_dr1": {"summer": (6, 1), "winter": (11, 1)},
    "flat_example": {"all_year": (1, 1)},
}
# Holidays observed on another day or skipped, by year
SHIFTED = {
    2026: {},
    2027: {date(2027, 7, 5): "Independence Day"},  # Jul 4 is a Sunday
    2028: {},
}


def _raw(path):
    return yaml.safe_load(path.read_text(encoding="utf-8"))


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations():
    """These tests don't need hass; override the conftest fixture."""
    yield


@pytest.fixture(params=PRESET_FILES, ids=lambda p: p.stem, scope="module")
def preset(request):
    return load_tariff(request.param)


def test_every_expected_preset_is_bundled():
    assert set(list_presets()) == set(EXPECTED_HOURS)


@pytest.mark.parametrize("path", PRESET_FILES, ids=lambda p: p.stem)
def test_preset_file_validates(path):
    data = _raw(path)
    assert validate(data) == []
    assert data["id"] == path.stem
    assert data["name"].endswith("(unofficial)")
    assert data["timezone"] == "America/Los_Angeles"


def test_preset_metadata(preset):
    assert preset.utility and preset.plan
    assert date(2025, 1, 1) <= preset.effective_date <= date(2027, 12, 31)
    assert preset.daily_charge >= 0
    assert "unverified_items" in preset.extras
    for p in (p for s in preset.seasons for p in s.periods):
        assert preset.label(p)


def test_prices_are_positive(preset):
    for s in preset.seasons:
        for p in s.periods:
            parts = [c.per_kwh[s.key][p] for c in preset.components]
            assert all(v >= 0 for v in parts), (s.key, p, parts)
            total = sum(parts)
            assert 0.05 < total < 1.5, (s.key, p, total)
            if preset.nbc:
                assert preset.nbc.per_kwh < total
    for a in preset.adders:
        assert a.per_kwh > 0
    if preset.nbc:
        assert preset.nbc.per_kwh > 0
        assert abs(sum(preset.nbc.parts.values()) - preset.nbc.per_kwh) < 1e-9


def test_seasons(preset):
    starts = {s.key: s.start for s in preset.seasons}
    assert starts == EXPECTED_SEASONS[preset.id]
    engine = TariffEngine(preset)
    for key, (m, d) in starts.items():
        assert engine.season_for(date(2027, m, d)).key == key


def test_windows_cover_every_hour(preset):
    """Every minute of every day type lands in a priced period, and matches the schedule."""
    expected = EXPECTED_HOURS[preset.id]
    for s in preset.seasons:
        priced = set(s.periods)
        for c in preset.components:
            assert set(c.per_kwh[s.key]) == priced
        for day_type in DAY_TYPES:
            hours = ""
            for minute in range(24 * 60):
                t = time(minute // 60, minute % 60)
                period = s.period_for(t, day_type)
                assert period in priced
                if minute % 60 == 0:
                    hours += LETTERS[period]
                else:
                    # no period changes mid-hour in any bundled preset
                    assert LETTERS[period] == hours[-1], (s.key, day_type, t)
            assert hours == expected[s.key][day_type], (s.key, day_type)


def test_rules_do_not_overlap(preset):
    """Two rules for the same day type never claim the same minute."""
    for s in preset.seasons:
        for day_type in DAY_TYPES:
            rules = [r for r in s.rules if day_type in r.day_types]
            for minute in range(0, 24 * 60, 15):
                t = time(minute // 60, minute % 60)
                hits = {r.period for r in rules if r.matches(t, day_type)}
                assert len(hits) <= 1, (s.key, day_type, t, hits)


@pytest.mark.parametrize("year", YEARS)
def test_holiday_dates(preset, year):
    engine = TariffEngine(preset)
    days = engine.holidays(year)
    assert len(days) == len(preset.holidays)
    if not preset.holidays:
        return
    by_name = {name: d for d, name in days.items()}
    assert all(d.year == year for d in days)
    if preset.holiday_sunday_shift:
        assert all(d.weekday() != 6 for d in days)
    for d, name in SHIFTED[year].items():
        assert by_name[name] == d
    assert by_name["New Year's Day"] in (date(year, 1, 1), date(year, 1, 2))
    assert by_name["Christmas Day"] in (date(year, 12, 25), date(year, 12, 26))
    assert by_name["Veterans Day"] in (date(year, 11, 11), date(year, 11, 12))
    assert by_name["Presidents' Day"].weekday() == 0
    assert 15 <= by_name["Presidents' Day"].day <= 21
    assert by_name["Memorial Day"].weekday() == 0 and by_name["Memorial Day"].day >= 25
    assert by_name["Labor Day"].weekday() == 0 and by_name["Labor Day"].day <= 7
    assert by_name["Thanksgiving"].weekday() == 3
    assert 22 <= by_name["Thanksgiving"].day <= 28
    for d in days:
        assert engine.day_type(d) == ("holiday", days[d])


def test_known_holidays():
    engine = TariffEngine(load_tariff(PRESET_DIR / "sdge_tou_dr1.yaml"))
    assert list(engine.holidays(2026)) == [
        date(2026, 1, 1),
        date(2026, 2, 16),
        date(2026, 5, 25),
        date(2026, 7, 4),  # Saturday, not moved
        date(2026, 9, 7),
        date(2026, 11, 11),
        date(2026, 11, 26),
        date(2026, 12, 25),
    ]
    assert engine.day_type(date(2026, 7, 3)) == ("weekday", None)


def test_nem3_only_where_export_prices_exist(preset):
    nem3 = preset.nem.get("nem3")
    if preset.utility == "SCE":
        assert (TARIFF_DIR / nem3["export_table"]).is_file()
        TariffEngine(preset, nem="nem3")
    else:
        assert nem3 is None


# ---------------------------------------------------------------- NBT files


@pytest.fixture(params=NBT_FILES, ids=lambda p: p.stem, scope="module")
def nbt(request):
    return request.param, _raw(request.param)


def test_nbt_file_loads(nbt):
    path, data = nbt
    table = load_export_table(path)
    assert table.utility == "SCE"
    assert path.stem == f"sce_nbt_{data['vintage_year']}"
    assert data["vintage"] == f"NBT{data['vintage_year'] % 100:02d}"
    assert data["vintage_year"] in data["price_vintages"]
    assert data["price_year"] == data["vintage_year"]


def test_nbt_years_cover_lock_in(nbt):
    _path, data = nbt
    years = nbt_options(data)["prices_by_year"]
    first = data["vintage_year"]
    for pto_year in data["price_vintages"]:
        # a December PTO stays locked in through the same month 9 years on
        need = range(max(pto_year, first), pto_year + data["lock_in_years"] + 1)
        assert set(need) <= set(years), (pto_year, sorted(years))
    for year, months in years.items():
        assert set(months) == set(range(1, 13)), year
        for m, kinds in months.items():
            for kind in ("weekday", "weekend"):
                hours = kinds[kind]
                assert len(hours) == 24
                # NBT23/NBT24 September evenings really do reach about $3.78/kWh
                assert all(0 <= v < 5 for v in hours), (year, m, kind)
                assert sum(hours) > 0


def test_nbt_acc_plus_matches_vintage(nbt):
    _path, data = nbt
    row = data["acc_plus_by_vintage"][data["vintage_year"]]
    assert data["acc_plus_adder"] == row


def test_nbt_vintages_do_not_overlap():
    seen: dict[int, str] = {}
    for path in NBT_FILES:
        for year in _raw(path)["price_vintages"]:
            assert year not in seen, (year, seen.get(year), path.name)
            seen[year] = path.name
    assert set(seen) == {2023, 2024, 2025, 2026, 2027}


def test_nbt_spot_values():
    """A few cells copied by hand from SCE's EEC price files."""
    nbt24 = load_export_table("nbt/sce_nbt_2024.yaml")
    assert nbt24.prices[1]["weekday"][0] == pytest.approx(0.05681)
    nbt27 = load_export_table("nbt/sce_nbt_2027.yaml")
    # Jan 2027 HS0 weekday: delivery 0.11638 + generation 0.07919
    assert nbt27.prices[1]["weekday"][0] == pytest.approx(0.19557)
