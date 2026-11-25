"""Tests for the billing ledger, using a small stand-in tariff engine."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from custom_components.sunflow_solar.billing import (
    Ledger,
    clamp_cycle_day,
    cycle_start_for,
    normalize_nem,
)

TZ = ZoneInfo("America/Los_Angeles")

# Round example prices, $/kWh.
DELIVERY = {
    "summer": {"on_peak": 0.30, "off_peak": 0.15},
    "winter": {"mid_peak": 0.25, "off_peak": 0.12},
}
GENERATION = {
    "summer": {"on_peak": 0.20, "off_peak": 0.10},
    "winter": {"mid_peak": 0.15, "off_peak": 0.08},
}
NBC = 0.02
FRC = 0.01
MCAM = 0.004
FM = FRC + MCAM
DAILY = 0.5

# NEM 2.0 energy rate = period total - NBC
ER = {
    "summer_on_peak": 0.48,
    "summer_off_peak": 0.23,
    "winter_mid_peak": 0.38,
    "winter_off_peak": 0.18,
}


def make_tariff(adders=None, nbc=NBC):
    return SimpleNamespace(
        timezone="America/Los_Angeles",
        seasons=(SimpleNamespace(key="summer"), SimpleNamespace(key="winter")),
        components=(
            SimpleNamespace(key="delivery", per_kwh=DELIVERY),
            SimpleNamespace(key="generation", per_kwh=GENERATION),
        ),
        adders=tuple(
            adders
            if adders is not None
            else (
                SimpleNamespace(key="frc", label="FRC", per_kwh=FRC, basis="net_interval"),
                SimpleNamespace(key="mcam", label="MCAM", per_kwh=MCAM, basis="net_interval"),
            )
        ),
        nbc=SimpleNamespace(per_kwh=nbc) if nbc is not None else None,
        daily_charge=DAILY,
    )


@dataclass(frozen=True)
class Info:
    season: str
    period: str

    @property
    def key(self):
        return f"{self.season}_{self.period}"


class FakeEngine:
    """Summer Jun-Sep. Peak 16:00-21:00 (on_peak in summer, mid_peak in winter)."""

    def __init__(self, nem="nem2", tariff=None, export_prices=None):
        self.nem = nem
        self.tariff = tariff or make_tariff()
        self.metering_lag = timedelta(minutes=3)
        self.export_prices = export_prices or {}
        self.broken = False

    def period_at(self, when):
        if self.broken:
            return None
        local = when.astimezone(TZ)
        season = "summer" if 6 <= local.month <= 9 else "winter"
        peak = 16 <= local.hour < 21
        if season == "summer":
            return Info(season, "on_peak" if peak else "off_peak")
        return Info(season, "mid_peak" if peak else "off_peak")

    def metering_period_at(self, when):
        return self.period_at(when - self.metering_lag)

    def export_price(self, when):
        return self.export_prices.get(when.astimezone(TZ).hour, 0.05)


def at(y, mo, d, h=12, mi=0, s=0):
    return datetime(y, mo, d, h, mi, s, tzinfo=TZ)


def ledger(nem="nem2", cycle_day=1, engine=None, state=None):
    return Ledger(engine or FakeEngine(nem), cycle_day, state)


# ---------------------------------------------------------------- helpers


def test_cycle_start_and_clamp():
    assert clamp_cycle_day(31) == 28
    assert clamp_cycle_day(0) == 1
    assert clamp_cycle_day("x") == 1
    assert cycle_start_for(at(2026, 3, 10).date(), 15).isoformat() == "2026-02-15"
    assert cycle_start_for(at(2026, 3, 15).date(), 15).isoformat() == "2026-03-15"
    assert cycle_start_for(at(2026, 1, 3).date(), 5).isoformat() == "2025-12-05"
    assert cycle_start_for(at(2026, 3, 1).date(), 31).isoformat() == "2026-02-28"


def test_normalize_nem():
    assert normalize_nem("NEM 2.0") == "nem2"
    assert normalize_nem("nem1") == "nem1"
    assert normalize_nem("NBT") == "nem3"
    assert normalize_nem(None) == "none"
    with pytest.raises(ValueError):
        normalize_nem("nem9")


# ---------------------------------------------------------------- NEM 2.0 steps


def test_first_call_only_records_baselines():
    lg = ledger()
    lg.on_energy(at(2026, 7, 1, 10), 1000.0, 500.0, 2000.0)
    assert lg.totals["import_energy_charge"] == 0
    assert lg.totals["savings"] == 0
    assert lg.interval["last_import"] == 1000.0


@pytest.mark.parametrize(
    ("when", "key"),
    [
        (at(2026, 7, 1, 10), "summer_off_peak"),
        (at(2026, 7, 1, 17), "summer_on_peak"),
        (at(2026, 12, 1, 17), "winter_mid_peak"),
        (at(2026, 12, 1, 3), "winter_off_peak"),
    ],
)
def test_nem2_step_each_period(when, key):
    lg = ledger()
    lg.on_energy(when - timedelta(minutes=5), 100.0, 50.0, 200.0)
    lg.on_energy(when, 102.0, 51.0, 203.0)
    rate = ER[key]
    t = lg.totals
    assert t["import_energy_charge"] == pytest.approx(2 * rate)
    assert t["export_credit"] == pytest.approx(1 * rate)
    # dProd x rate + (dProd - dExp) x (NBC + FRC + MCAM)
    assert t["savings"] == pytest.approx(3 * rate + 2 * (NBC + FM))
    row = next(
        r
        for r in lg.bill_estimate(when)["attributes"]["periods"]
        if f"{r['season']}_{r['period']}" == key
    )
    assert row["import_kwh"] == 2.0
    assert row["export_kwh"] == 1.0
    assert row["amount"] == pytest.approx(round(1 * rate, 4))


def test_metering_lag_prices_previous_period():
    lg = ledger()
    lg.on_energy(at(2026, 7, 1, 15, 55), 10.0, 0.0, 0.0)
    lg.on_energy(at(2026, 7, 1, 16, 0, 10), 11.0, 0.0, 0.0)  # 15:57 -> off peak
    assert lg.totals["import_energy_charge"] == pytest.approx(ER["summer_off_peak"])
    lg.on_energy(at(2026, 7, 1, 16, 5), 12.0, 0.0, 0.0)  # 16:02 -> on peak
    assert lg.totals["import_energy_charge"] == pytest.approx(
        ER["summer_off_peak"] + ER["summer_on_peak"]
    )


def test_step_glitches_are_skipped_but_baseline_moves():
    lg = ledger()
    t0 = at(2026, 12, 1, 3)
    lg.on_energy(t0, 100.0, 50.0, 200.0)
    lg.on_energy(t0 + timedelta(minutes=5), 99.0, 50.0, 200.0)  # negative
    assert lg.totals["import_energy_charge"] == 0
    lg.on_energy(t0 + timedelta(minutes=10), 199.0, 50.0, 200.0)  # exactly +100
    assert lg.totals["import_energy_charge"] == 0
    lg.on_energy(t0 + timedelta(minutes=15), 200.0, 50.0, 200.0)  # +1 from new baseline
    assert lg.totals["import_energy_charge"] == pytest.approx(ER["winter_off_peak"])
    lg.on_energy(t0 + timedelta(minutes=20), 299.9, 50.0, 200.0)  # 99.9 counts
    assert lg.totals["import_energy_charge"] == pytest.approx(100.9 * ER["winter_off_peak"])


def test_unavailable_reading_keeps_its_baseline():
    lg = ledger()
    t0 = at(2026, 12, 1, 3)
    lg.on_energy(t0, 100.0, 50.0, 200.0)
    lg.on_energy(t0 + timedelta(minutes=5), None, 51.0, 201.0)
    assert lg.totals["import_energy_charge"] == 0
    assert lg.totals["export_credit"] == pytest.approx(0.18)
    lg.on_energy(t0 + timedelta(minutes=10), 102.0, 51.0, 201.0)
    assert lg.totals["import_energy_charge"] == pytest.approx(2 * 0.18)


def test_no_price_holds_everything_until_next_priced_step():
    eng = FakeEngine()
    lg = ledger(engine=eng)
    t0 = at(2026, 12, 1, 3)
    lg.on_energy(t0, 100.0, 50.0, 200.0)
    eng.broken = True
    lg.on_energy(t0 + timedelta(minutes=5), 101.0, 50.0, 201.0)
    assert lg.totals["import_energy_charge"] == 0
    eng.broken = False
    lg.on_energy(t0 + timedelta(minutes=10), 102.0, 50.0, 202.0)
    assert lg.totals["import_energy_charge"] == pytest.approx(2 * 0.18)
    assert lg.totals["savings"] == pytest.approx(2 * 0.18 + 2 * (NBC + FM))


def test_zero_production_does_not_move_production_baseline():
    lg = ledger()
    t0 = at(2026, 12, 1, 3)
    lg.on_energy(t0, 100.0, 50.0, 200.0)
    lg.on_energy(t0 + timedelta(minutes=5), 100.0, 50.0, 0.0)
    lg.on_energy(t0 + timedelta(minutes=10), 100.0, 50.0, 201.0)
    assert lg.totals["savings"] == pytest.approx(0.18 + (NBC + FM))


def test_savings_can_go_negative_on_export_heavy_step():
    # (dProd - dExp) is not clamped, so an export-heavy step can lower savings.
    lg = ledger()
    t0 = at(2026, 12, 1, 3)
    lg.on_energy(t0, 0.0, 0.0, 10.0)
    lg.on_energy(t0 + timedelta(minutes=5), 0.0, 2.0, 11.0)
    assert lg.totals["savings"] == pytest.approx(1 * 0.18 + (1 - 2) * (NBC + FM))


# ---------------------------------------------------------------- hourly close


def test_hourly_close_charges_net_import():
    lg = ledger()
    lg.on_energy(at(2026, 12, 1, 2, 0, 10), 100.0, 50.0, 0.0)
    lg.on_energy(at(2026, 12, 1, 3, 0, 10), 103.0, 51.0, 0.0)
    lg.close_interval(at(2026, 12, 1, 3, 0, 30))
    assert lg.totals["nbc"] == pytest.approx(2 * NBC)
    assert lg.adder_totals["frc"] == pytest.approx(2 * FRC)
    assert lg.adder_totals["mcam"] == pytest.approx(2 * MCAM)
    assert lg.interval["last_interval_net_kwh"] == 2.0
    assert lg.interval["last_interval_end"] == at(2026, 12, 1, 3, 0, 30).isoformat()

    # Net export hour: nothing charged.
    lg.on_energy(at(2026, 12, 1, 4, 0, 10), 104.0, 55.0, 0.0)
    lg.close_interval(at(2026, 12, 1, 4, 0, 30))
    assert lg.totals["nbc"] == pytest.approx(2 * NBC)
    assert lg.interval["last_interval_net_kwh"] == -3.0


def test_close_glitch_skipped_and_unavailable_nets_longer_span():
    lg = ledger()
    lg.on_energy(at(2026, 12, 1, 2), 100.0, 50.0, 0.0)
    lg.on_energy(at(2026, 12, 1, 3), 1100.0, 50.0, 0.0)  # +1000: glitch
    lg.close_interval(at(2026, 12, 1, 3, 0, 30))
    assert lg.totals["nbc"] == 0
    assert lg.interval["last_import"] == 1100.0

    lg.on_energy(at(2026, 12, 1, 3, 30), 1101.0, 50.0, 0.0)
    lg.on_energy(at(2026, 12, 1, 4), None, 50.0, 0.0)
    lg.close_interval(at(2026, 12, 1, 4, 0, 30))  # import unavailable: left open
    assert lg.totals["nbc"] == 0
    assert lg.interval["last_import"] == 1100.0
    lg.on_energy(at(2026, 12, 1, 5), 1104.0, 51.0, 0.0)
    lg.close_interval(at(2026, 12, 1, 5, 0, 30))
    assert lg.totals["nbc"] == pytest.approx(3 * NBC)


def test_first_close_without_baseline_only_records():
    lg = ledger(state={"latest_import": 10.0, "latest_export": 5.0})
    lg.close_interval(at(2026, 12, 1, 3, 0, 30))
    assert lg.totals["nbc"] == 0
    assert lg.interval["last_import"] == 10.0


def test_totals_sum_up():
    lg = ledger()
    lg.on_energy(at(2026, 12, 1, 2, 0, 10), 100.0, 50.0, 0.0)
    lg.on_energy(at(2026, 12, 1, 3, 0, 10), 104.0, 51.0, 0.0)
    lg.close_interval(at(2026, 12, 1, 3, 0, 30))
    t = lg.totals
    assert t["import_energy_charge"] == pytest.approx(4 * 0.18)
    assert t["export_credit"] == pytest.approx(0.18)
    assert t["adders"] == pytest.approx(3 * FM)
    assert t["import_cost"] == pytest.approx(4 * 0.18 + 3 * NBC + 3 * FM)
    assert t["net_cost"] == pytest.approx(3 * 0.18 + 3 * NBC + 3 * FM)


# ---------------------------------------------------------------- billing cycle


def test_cycle_reset_after_midnight_close():
    lg = ledger(cycle_day=5)
    lg.on_energy(at(2026, 12, 4, 23, 0, 10), 100.0, 0.0, 0.0)
    lg.close_interval(at(2026, 12, 4, 23, 0, 30))
    lg.on_energy(at(2026, 12, 4, 23, 55), 102.0, 0.0, 0.0)
    lg.on_energy(at(2026, 12, 5, 0, 0, 10), 103.0, 0.0, 0.0)  # midnight reading
    lg.close_interval(at(2026, 12, 5, 0, 0, 30))

    before = lg.bill_estimate(at(2026, 12, 5, 0, 0, 40))["attributes"]
    assert before["cycle_start"] == "2026-11-05"
    assert before["import_kwh"] == 3.0
    assert before["nbc_charges"] == round(3 * NBC, 2)

    assert lg.maybe_reset_cycle(at(2026, 12, 5, 0, 0, 30)) is False
    assert lg.maybe_reset_cycle(at(2026, 12, 5, 0, 0, 45)) is True
    assert lg.maybe_reset_cycle(at(2026, 12, 5, 0, 0, 46)) is False

    after = lg.bill_estimate(at(2026, 12, 5, 0, 1))
    attrs = after["attributes"]
    assert attrs["cycle_start"] == "2026-12-05"
    assert attrs["days_in_cycle"] == 1
    assert attrs["import_kwh"] == 0
    assert attrs["nbc_charges"] == 0
    assert attrs["adder_charges"] == 0
    assert after["state"] == DAILY
    # Lifetime totals are untouched.
    assert lg.totals["nbc"] == pytest.approx(3 * NBC)


def test_missed_reset_happens_on_next_call():
    lg = ledger(cycle_day=5)
    lg.on_energy(at(2026, 12, 4, 20), 100.0, 0.0, 0.0)
    lg.on_energy(at(2026, 12, 4, 22), 101.0, 0.0, 0.0)
    # Down over the cycle start; next reading is a day later.
    lg.on_energy(at(2026, 12, 6, 9), 102.0, 0.0, 0.0)
    attrs = lg.bill_estimate(at(2026, 12, 6, 9))["attributes"]
    assert attrs["cycle_start"] == "2026-12-05"
    assert attrs["import_kwh"] == 1.0


def test_season_spanning_cycle():
    lg = ledger(cycle_day=20)
    lg.on_energy(at(2026, 9, 25, 10), 100.0, 50.0, 0.0)
    lg.on_energy(at(2026, 9, 25, 11), 105.0, 52.0, 0.0)  # summer off peak
    lg.on_energy(at(2026, 10, 2, 17), 110.0, 52.0, 0.0)  # winter mid peak
    lg.on_energy(at(2026, 10, 3, 12), 110.0, 60.0, 0.0)  # winter off peak
    est = lg.bill_estimate(at(2026, 10, 3, 12))
    a = est["attributes"]
    rows = {f"{r['season']}_{r['period']}": r for r in a["periods"]}
    assert list(rows) == list(ER)
    assert rows["summer_off_peak"]["net_kwh"] == 3.0
    assert rows["winter_mid_peak"]["net_kwh"] == 5.0
    assert rows["winter_off_peak"]["net_kwh"] == -8.0
    energy = round(3 * 0.23, 4) + round(5 * 0.38, 4) + round(-8 * 0.18, 4)
    assert a["nem_energy_balance"] == round(energy, 2)
    assert a["energy_charges"] == round(3 * 0.23 + 5 * 0.38, 2)
    assert a["energy_credits"] == round(-8 * 0.18, 2)
    assert a["cycle_start"] == "2026-09-20"
    assert a["days_in_cycle"] == 14
    assert a["base_charges"] == round(14 * DAILY, 2)
    assert est["state"] == round(energy + 14 * DAILY, 2)


def test_bill_estimate_attributes():
    lg = ledger(cycle_day=1)
    lg.on_energy(at(2026, 12, 3, 1, 0, 10), 100.0, 50.0, 0.0)
    lg.on_energy(at(2026, 12, 3, 2, 0, 10), 110.0, 52.0, 0.0)
    lg.close_interval(at(2026, 12, 3, 2, 0, 30))
    est = lg.bill_estimate(at(2026, 12, 3, 12))
    a = est["attributes"]
    energy = round(8 * 0.18, 4)
    nbc = 8 * NBC
    adders = 8 * FM
    base = 3 * DAILY
    assert set(a) >= {
        "cycle_start",
        "days_in_cycle",
        "base_charges",
        "nbc_charges",
        "adder_charges",
        "adders",
        "energy_charges",
        "energy_credits",
        "nem_energy_balance",
        "due_this_cycle_mbo",
        "credit_carried_forward",
        "due_monthly_minimum",
        "import_kwh",
        "export_kwh",
        "periods",
        "note",
    }
    assert a["cycle_start"] == "2026-12-01"
    assert a["days_in_cycle"] == 3
    assert a["base_charges"] == 1.5
    assert a["nbc_charges"] == round(nbc, 2)
    assert a["adder_charges"] == round(adders, 2)
    assert a["adders"] == {"frc": round(8 * FRC, 2), "mcam": round(8 * MCAM, 2)}
    assert a["due_this_cycle_mbo"] == round(base + nbc + adders + energy, 2)
    assert a["due_monthly_minimum"] == round(base + nbc + adders, 2)
    assert a["credit_carried_forward"] == 0
    assert a["import_kwh"] == 10.0
    assert a["export_kwh"] == 2.0
    assert set(a["periods"][0]) == {
        "season",
        "period",
        "import_kwh",
        "export_kwh",
        "net_kwh",
        "energy_rate",
        "amount",
    }
    assert est["state"] == round(energy + nbc + adders + base, 2)


def test_credit_cycle_carries_forward():
    lg = ledger()
    lg.on_energy(at(2026, 12, 3, 10), 0.0, 0.0, 0.0)
    lg.on_energy(at(2026, 12, 3, 11), 0.0, 10.0, 10.0)
    a = lg.bill_estimate(at(2026, 12, 3, 12))["attributes"]
    assert a["credit_carried_forward"] == round(-10 * 0.18, 2)
    assert a["due_this_cycle_mbo"] == a["due_monthly_minimum"] == round(3 * DAILY, 2)


# ---------------------------------------------------------------- daily


def test_cost_today_adds_full_daily_charge_from_midnight():
    lg = ledger()
    assert lg.cost_today(at(2026, 12, 3, 0, 0, 1)) == DAILY
    lg.on_energy(at(2026, 12, 3, 1), 100.0, 0.0, 0.0)
    lg.on_energy(at(2026, 12, 3, 2, 0, 10), 105.0, 1.0, 0.0)
    lg.close_interval(at(2026, 12, 3, 2, 0, 30))
    expected = 5 * 0.18 - 0.18 + 4 * (NBC + FM) + DAILY
    assert lg.cost_today(at(2026, 12, 3, 9)) == round(expected, 2)
    assert lg.cost_today(at(2026, 12, 4, 0, 0, 1)) == DAILY


# ---------------------------------------------------------------- other modes


def test_nem1_full_retail_and_no_nbc():
    lg = ledger("nem1")
    lg.on_energy(at(2026, 12, 3, 2, 0, 10), 100.0, 50.0, 0.0)
    lg.on_energy(at(2026, 12, 3, 3, 0, 10), 104.0, 51.0, 6.0)
    lg.on_energy(at(2026, 12, 3, 3, 5), 104.0, 51.0, 7.0)
    lg.close_interval(at(2026, 12, 3, 3, 0, 30))
    total = 0.20  # winter off peak period total
    t = lg.totals
    assert t["import_energy_charge"] == pytest.approx(4 * total)
    assert t["export_credit"] == pytest.approx(1 * total)
    assert t["nbc"] == 0
    assert t["adders"] == pytest.approx(3 * FM)
    # First production reading is only a baseline, so step 2 has dProd 0, dExp 1.
    assert t["savings"] == pytest.approx((0 - 1) * FM + 1 * total + (1 - 0) * FM)
    rows = lg.bill_estimate(at(2026, 12, 3, 4))["attributes"]["periods"]
    assert {r["energy_rate"] for r in rows} == {0.5, 0.25, 0.4, 0.2}


def test_no_nem_exports_earn_nothing():
    lg = ledger("none")
    lg.on_energy(at(2026, 12, 3, 2, 0, 10), 100.0, 50.0, 10.0)
    lg.on_energy(at(2026, 12, 3, 3, 0, 10), 104.0, 52.0, 15.0)
    lg.close_interval(at(2026, 12, 3, 3, 0, 30))
    t = lg.totals
    assert t["export_credit"] == 0
    assert t["nbc"] == 0
    assert t["import_energy_charge"] == pytest.approx(4 * 0.20)
    # Adders on gross import, per step.
    assert t["adders"] == pytest.approx(4 * FM)
    assert t["import_cost"] == pytest.approx(4 * (0.20 + FM))
    assert t["savings"] == pytest.approx((5 - 2) * (0.20 + FM))
    a = lg.bill_estimate(at(2026, 12, 3, 4))["attributes"]
    row = next(r for r in a["periods"] if r["period"] == "off_peak" and r["season"] == "winter")
    assert row["amount"] == pytest.approx(0.8)


def test_nem3_hourly_export_price():
    eng = FakeEngine("nem3", export_prices={13: 0.03, 18: 0.40})
    lg = ledger(engine=eng)
    lg.on_energy(at(2026, 12, 3, 13, 0, 10), 100.0, 50.0, 10.0)
    lg.on_energy(at(2026, 12, 3, 13, 30), 101.0, 54.0, 16.0)
    lg.on_energy(at(2026, 12, 3, 18, 30), 101.0, 55.0, 17.0)
    t = lg.totals
    assert t["import_energy_charge"] == pytest.approx(1 * 0.18)
    assert t["export_credit"] == pytest.approx(4 * 0.03 + 1 * 0.40)
    import_price = 0.18 + NBC + FM
    s1 = 6 * 0.03 + (6 - 4) * (0.18 - 0.03 + NBC + FM)
    s2 = 1 * 0.40 + 0 * (0.38 - 0.40 + NBC + FM)
    assert t["savings"] == pytest.approx(s1 + s2)
    assert s1 == pytest.approx(4 * 0.03 + 2 * import_price)
    a = lg.bill_estimate(at(2026, 12, 3, 19))["attributes"]
    rows = {f"{r['season']}_{r['period']}": r for r in a["periods"]}
    assert rows["winter_off_peak"]["export_credit"] == pytest.approx(0.12)
    assert rows["winter_off_peak"]["amount"] == pytest.approx(0.18 - 0.12)
    assert rows["winter_mid_peak"]["amount"] == pytest.approx(-0.40)


def test_import_basis_adder_charged_on_gross_import():
    tariff = make_tariff(
        adders=(SimpleNamespace(key="ppp", label="PPP", per_kwh=0.01, basis="import"),)
    )
    lg = ledger(engine=FakeEngine("nem2", tariff=tariff))
    lg.on_energy(at(2026, 12, 3, 2, 0, 10), 100.0, 50.0, 0.0)
    lg.on_energy(at(2026, 12, 3, 3, 0, 10), 104.0, 54.0, 0.0)
    lg.close_interval(at(2026, 12, 3, 3, 0, 30))
    assert lg.adder_totals == {"ppp": pytest.approx(0.04)}
    assert lg.totals["nbc"] == 0


# ---------------------------------------------------------------- restart


def _feed(lg, steps):
    for kind, when, *vals in steps:
        if kind == "e":
            lg.on_energy(when, *vals)
        elif kind == "c":
            lg.close_interval(when)
        else:
            lg.maybe_reset_cycle(when)


def test_restart_round_trip_matches_uninterrupted_run():
    steps = []
    imp, exp, prod = 100.0, 50.0, 200.0
    when = at(2026, 9, 28, 0, 2)
    for i in range(24 * 6 * 4):  # four days, 10 minute steps, across Oct 1 and cycle day
        when += timedelta(minutes=10)
        imp += 0.3 if when.hour < 10 or when.hour >= 17 else 0.05
        exp += 0.4 if 10 <= when.hour < 16 else 0.0
        prod += 0.6 if 9 <= when.hour < 17 else 0.0
        steps.append(("e", when, round(imp, 3), round(exp, 3), round(prod, 3)))
        if when.minute == 0 or (when - timedelta(minutes=10)).hour != when.hour:
            close = when.replace(minute=0, second=30)
            steps.append(("c", close))
            steps.append(("r", close + timedelta(seconds=15)))

    straight = ledger(cycle_day=1)
    _feed(straight, steps)

    half = len(steps) // 2
    first = ledger(cycle_day=1)
    _feed(first, steps[:half])
    saved = json.loads(json.dumps(first.to_dict()))
    second = Ledger(FakeEngine("nem2"), 1, saved)
    _feed(second, steps[half:])

    assert second.totals == straight.totals
    end = steps[-1][1]
    assert second.bill_estimate(end) == straight.bill_estimate(end)
    assert second.to_dict() == straight.to_dict()
    assert straight.bill_estimate(end)["attributes"]["cycle_start"] == "2026-10-01"
    assert straight.totals["nbc"] > 0


def test_to_dict_is_json_safe():
    lg = ledger()
    lg.on_energy(at(2026, 12, 3, 2), 1.0, 1.0, 1.0)
    json.dumps(lg.to_dict())


def test_set_cycle_day_relabels_without_wiping():
    lg = ledger(cycle_day=1)
    lg.on_energy(at(2026, 12, 3, 2), 100.0, 0.0, 0.0)
    lg.on_energy(at(2026, 12, 3, 3), 101.0, 0.0, 0.0)
    lg.set_cycle_day(2, at(2026, 12, 3, 4))
    a = lg.bill_estimate(at(2026, 12, 3, 4))["attributes"]
    assert a["cycle_start"] == "2026-12-02"
    assert a["import_kwh"] == 1.0
