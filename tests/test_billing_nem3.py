"""NEM 3.0 (SCE Net Billing Tariff) ledger tests against the bundled preset and NBT table.

Prices used below, $/kWh:
    TOU-D-PRIME period totals (delivery + generation), NBC 0.01164,
    FRC 0.01118 + MCAM 0.00223 = 0.01341, daily charge 0.794
    summer on_peak   0.61259 -> energy rate 0.60095
    summer off_peak  0.26680 -> energy rate 0.25516
    winter off_peak  0.30352 -> energy rate 0.29188
    NBT26 export prices copied from tariff/nbt/sce_nbt_2026.yaml.
"""

from __future__ import annotations

import dataclasses
import json
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
import yaml

from custom_components.daymill.billing import Ledger, nbt_options
from custom_components.daymill.tariff import TariffEngine, load_preset
from custom_components.daymill.tariff.loader import TARIFF_DIR

TZ = ZoneInfo("America/Los_Angeles")

NBC = 0.01164
FRC = 0.01118
MCAM = 0.00223
ADDERS = FRC + MCAM
DAILY = 0.794
ER_SUMMER_ON = 0.60095
ER_SUMMER_OFF = 0.25516
ER_WINTER_OFF = 0.29188
ACC = 0.016
ACC_EQUITY = 0.037

# NBT26 export prices
JUL_WD_12 = 0.05273
JUL_WD_18 = 0.2321
NOV_WD_13 = 0.04893
NOV_WE_13 = 0.02214
JAN_WD_12_2026 = 0.06282
JAN_WD_12_2027 = 0.05822
JAN_WD_12_2035 = 0.0284


@pytest.fixture(scope="module")
def tariff():
    return load_preset("sce_tou_d_prime")


@pytest.fixture(scope="module")
def nbt_raw(tariff):
    path = TARIFF_DIR / tariff.nem["nem3"]["export_table"]
    return yaml.safe_load(path.read_text())


def at(y, mo, d, h=12, mi=0, s=0):
    return datetime(y, mo, d, h, mi, s, tzinfo=TZ)


def make(tariff, nbt_raw, cycle_day=1, state=None, table=True, **settings):
    engine = TariffEngine(tariff, nem="nem3")
    options = nbt_options(nbt_raw if table else None, **settings)
    return Ledger(engine, cycle_day, state, nbt=options)


# ---------------------------------------------------------------- wiring


def test_preset_points_at_nbt_table(tariff, nbt_raw):
    assert tariff.nem["nem3"]["export_table"] == "nbt/sce_nbt_2026.yaml"
    engine = TariffEngine(tariff, nem="nem3")
    assert engine.export_price(at(2026, 7, 15, 18, 30)) == JUL_WD_18
    opts = nbt_options(nbt_raw, pto_date="2026-05-01", arecr=None)
    assert sorted(opts["prices_by_year"]) == list(range(2026, 2036))
    assert opts["prices_by_year"][2026][7]["weekday"][18] == JUL_WD_18
    assert opts["acc_plus_adder"] == {"residential": ACC, "residential_equity": ACC_EQUITY}
    assert opts["lock_in_years"] == 9
    assert opts["pto_date"] == "2026-05-01"
    assert "arecr" not in opts


# ---------------------------------------------------------------- pricing


def test_import_and_export_priced_gross_in_same_hour(tariff, nbt_raw):
    lg = make(tariff, nbt_raw)
    lg.on_energy(at(2026, 7, 15, 18, 0, 10), 100.0, 50.0, 10.0)
    lg.close_interval(at(2026, 7, 15, 18, 0, 30))
    lg.on_energy(at(2026, 7, 15, 18, 30), 101.5, 52.0, 14.0)
    lg.close_interval(at(2026, 7, 15, 19, 0, 30))

    t = lg.totals
    assert t["import_energy_charge"] == pytest.approx(1.5 * ER_SUMMER_ON, abs=1e-5)
    # NBC and adders on all 1.5 kWh, not on max(0, 1.5 - 2) = 0
    assert t["nbc"] == pytest.approx(1.5 * NBC, abs=1e-5)
    assert lg.adder_totals == {
        "frc": pytest.approx(1.5 * FRC, abs=1e-5),
        "mcam": pytest.approx(1.5 * MCAM, abs=1e-5),
    }
    assert t["export_credit"] == pytest.approx(2 * JUL_WD_18, abs=1e-5)
    assert t["acc_plus_credit"] == pytest.approx(2 * ACC, abs=1e-5)
    # 2 kWh exported at 0.2481, 2 kWh self-used at the full import price 0.626
    assert t["savings"] == pytest.approx(2 * (JUL_WD_18 + ACC) + 2 * 0.626, abs=1e-5)
    assert t["net_cost"] == pytest.approx(0.901425 + 0.01746 + 0.020115 - 0.4642 - 0.032, abs=1e-4)

    today = lg.today(at(2026, 7, 15, 20))
    assert today["nbc"] == pytest.approx(0.01746, abs=1e-5)
    assert today["acc_plus"] == pytest.approx(0.032, abs=1e-5)
    assert today["net_cost"] == pytest.approx(0.4428, abs=1e-4)
    assert lg.cost_today(at(2026, 7, 15, 20)) == round(0.4428 + DAILY, 2)
    assert lg.interval["last_interval_net_kwh"] == -0.5


def test_metering_lag_uses_previous_hour(tariff, nbt_raw):
    lg = make(tariff, nbt_raw)
    lg.on_energy(at(2026, 7, 15, 18, 50), 100.0, 50.0, 0.0)
    lg.on_energy(at(2026, 7, 15, 19, 2), 100.0, 51.0, 0.0)  # metered at 18:59
    assert lg.totals["export_credit"] == pytest.approx(JUL_WD_18)


def test_holiday_uses_weekend_price(tariff, nbt_raw):
    lg = make(tariff, nbt_raw)
    lg.on_energy(at(2026, 11, 25, 13, 0, 10), 100.0, 50.0, 0.0)
    lg.on_energy(at(2026, 11, 25, 13, 30), 100.0, 51.0, 0.0)  # Wednesday
    lg.on_energy(at(2026, 11, 26, 13, 0, 10), 100.0, 51.0, 0.0)
    lg.on_energy(at(2026, 11, 26, 13, 30), 100.0, 52.0, 0.0)  # Thanksgiving
    assert lg.totals["export_credit"] == pytest.approx(NOV_WD_13 + NOV_WE_13)


def test_export_price_follows_calendar_year(tariff, nbt_raw):
    lg = make(tariff, nbt_raw)
    lg.on_energy(at(2026, 1, 14, 12, 0, 10), 100.0, 50.0, 0.0)
    lg.on_energy(at(2026, 1, 14, 12, 30), 100.0, 51.0, 0.0)
    lg.on_energy(at(2027, 1, 13, 12, 0, 10), 100.0, 51.0, 0.0)
    lg.on_energy(at(2027, 1, 13, 12, 30), 100.0, 52.0, 0.0)
    assert lg.totals["export_credit"] == pytest.approx(JAN_WD_12_2026 + JAN_WD_12_2027)
    assert (
        "No export prices" not in lg.bill_estimate(at(2027, 1, 13, 13))["attributes"]["beta_note"]
    )


def test_year_past_table_uses_last_year_and_says_so(tariff, nbt_raw):
    lg = make(tariff, nbt_raw)
    lg.on_energy(at(2036, 1, 15, 12, 0, 10), 100.0, 50.0, 0.0)
    lg.on_energy(at(2036, 1, 15, 12, 30), 100.0, 51.0, 0.0)
    assert lg.totals["export_credit"] == pytest.approx(JAN_WD_12_2035)
    note = lg.bill_estimate(at(2036, 1, 15, 13))["attributes"]["beta_note"]
    assert "No export prices for 2036 in the table: using 2035 prices." in note


def test_without_year_table_falls_back_to_engine(tariff, nbt_raw):
    lg = make(tariff, nbt_raw, table=False)
    lg.on_energy(at(2027, 1, 13, 12, 0, 10), 100.0, 50.0, 0.0)
    lg.on_energy(at(2027, 1, 13, 12, 30), 100.0, 51.0, 0.0)
    # the engine's own table knows each calendar year; no ACC Plus table is known
    jan_wd_12_2027 = nbt_raw["prices_by_year"][2027][1]["weekday"][12]
    assert jan_wd_12_2027 != JAN_WD_12_2026
    assert lg.totals["export_credit"] == pytest.approx(jan_wd_12_2027)
    assert lg.totals["acc_plus_credit"] == 0
    note = lg.bill_estimate(at(2027, 1, 13, 13))["attributes"]["beta_note"]
    assert "one table for every calendar year" not in note
    assert "No ACC Plus adder found" in note


def test_acc_plus_stops_at_end_of_lock_in(tariff, nbt_raw):
    lg = make(tariff, nbt_raw, pto_date=date(2026, 3, 10), acc_plus_class="residential_equity")
    assert lg.lock_in_end == date(2035, 3, 10)
    lg.on_energy(at(2035, 3, 9, 12, 0, 10), 100.0, 50.0, 0.0)
    lg.on_energy(at(2035, 3, 9, 12, 30), 100.0, 51.0, 0.0)
    lg.on_energy(at(2035, 3, 12, 12, 0, 10), 100.0, 51.0, 0.0)
    lg.on_energy(at(2035, 3, 12, 12, 30), 100.0, 52.0, 0.0)
    assert lg.totals["acc_plus_credit"] == pytest.approx(ACC_EQUITY)
    assert lg.acc_plus_rate_at(at(2035, 3, 12, 12)) == 0
    assert lg.acc_plus_rate_at(at(2035, 3, 9, 12)) == ACC_EQUITY


def test_acc_plus_override_and_none(tariff, nbt_raw):
    assert make(tariff, nbt_raw, acc_plus_per_kwh=0.024).acc_plus_rate_at(at(2026, 7, 1)) == 0.024
    assert make(tariff, nbt_raw, acc_plus_class="none").acc_plus_rate_at(at(2026, 7, 1)) == 0


# ---------------------------------------------------------------- bill


def _july(lg):
    lg.on_energy(at(2026, 7, 15, 12, 0, 10), 100.0, 50.0, 0.0)
    lg.on_energy(at(2026, 7, 15, 12, 30), 100.0, 60.0, 12.0)  # 10 kWh out at noon
    lg.on_energy(at(2026, 7, 15, 18, 30), 102.0, 60.0, 12.0)  # 2 kWh in on-peak


def test_bill_estimate_hand_computed(tariff, nbt_raw):
    lg = make(tariff, nbt_raw)
    _july(lg)
    bill = lg.bill_estimate(at(2026, 7, 15, 20))
    a = bill["attributes"]
    energy = 2 * ER_SUMMER_ON  # 1.2019
    eec = 10 * JUL_WD_12  # 0.5273
    base = 15 * DAILY  # 11.91
    nbc = 2 * NBC  # 0.02328
    adders = 2 * ADDERS  # 0.02682
    subtotal = energy - eec + nbc + adders + base  # 12.6347
    assert a["cycle_start"] == "2026-07-01"
    assert a["days_in_cycle"] == 15
    assert a["energy_charges"] == round(energy, 2)
    assert a["energy_credits"] == round(-eec, 2)
    assert a["export_credit_applied"] == round(eec, 2)
    assert a["energy_due"] == round(energy - eec, 2)
    assert a["nbc_charges"] == round(nbc, 2)
    assert a["adder_charges"] == round(adders, 2)
    assert a["adders"] == {"frc": round(2 * FRC, 2), "mcam": round(2 * MCAM, 2)}
    assert a["base_charges"] == round(base, 2)
    assert a["due_before_credits"] == round(subtotal, 2)
    assert a["acc_plus_this_cycle"] == 0.16
    assert a["acc_plus_applied"] == 0.16
    assert a["acc_plus_carried_forward"] == 0
    assert a["credit_carried_forward"] == 0
    assert a["due_monthly_minimum"] == round(base + nbc + adders, 2)
    assert bill["state"] == round(subtotal - 0.16, 2) == 12.47
    assert a["due_this_cycle"] == a["due_this_cycle_mbo"] == 12.47
    assert a["import_kwh"] == 2 and a["export_kwh"] == 10
    assert a["nem"] == "nem3"
    assert "beta" in a["beta_note"] and "No PTO date set" in a["beta_note"]
    assert a["true_up_date"] is None
    rows = {f"{r['season']}_{r['period']}": r for r in a["periods"]}
    on = rows["summer_on_peak"]
    assert on["energy_rate"] == ER_SUMMER_ON
    assert on["import_charge"] == round(energy, 4)
    assert rows["summer_off_peak"]["export_credit"] == round(eec, 4)
    assert rows["summer_off_peak"]["amount"] == round(-eec, 4)


def test_credits_carry_forward_between_cycles(tariff, nbt_raw):
    # No daily charge, so the ACC Plus credit outlasts the bill too.
    free = dataclasses.replace(tariff, daily_charge=0.0)
    lg = make(free, nbt_raw)
    lg.on_energy(at(2026, 8, 12, 12, 0, 10), 100.0, 50.0, 0.0)
    lg.on_energy(at(2026, 8, 12, 12, 30), 100.0, 60.0, 0.0)
    eec = 10 * nbt_raw["prices"][8]["weekday"][12]
    aug = lg.bill_estimate(at(2026, 8, 31, 23))
    assert aug["state"] == 0
    assert aug["attributes"]["credit_carried_forward"] == round(-eec, 2)
    assert aug["attributes"]["acc_plus_carried_forward"] == 0.16

    assert lg.maybe_reset_cycle(at(2026, 9, 1, 0, 0, 45))
    lg.on_energy(at(2026, 9, 9, 2, 0, 10), 100.0, 60.0, 0.0)
    lg.on_energy(at(2026, 9, 9, 2, 30), 101.0, 60.0, 0.0)  # 1 kWh summer off-peak
    a = lg.bill_estimate(at(2026, 9, 9, 3))["attributes"]
    assert a["export_credit_carried_in"] == round(eec, 2)
    assert a["export_credit_applied"] == round(ER_SUMMER_OFF, 2)
    assert a["energy_due"] == 0
    assert a["credit_carried_forward"] == round(-(eec - ER_SUMMER_OFF), 2)
    # export credit never touches NBC or adders; ACC Plus does
    assert a["due_before_credits"] == round(NBC + ADDERS, 2)
    assert a["acc_plus_carried_in"] == 0.16
    assert a["acc_plus_applied"] == round(NBC + ADDERS, 2)
    assert a["acc_plus_carried_forward"] == round(0.16 - NBC - ADDERS, 2)
    assert lg.bill_estimate(at(2026, 9, 9, 3))["state"] == 0


def test_true_up_refunds_then_forfeits(tariff, nbt_raw):
    lg = make(
        tariff,
        nbt_raw,
        cycle_day=5,
        pto_date="2026-03-10",
        arecr=0.02,
        nsc_rate=0.03,
        nsc_opt_in=True,
    )
    lg.on_energy(at(2026, 4, 10, 2, 0, 10), 100.0, 50.0, 0.0)
    lg.on_energy(at(2026, 4, 10, 2, 30), 110.0, 50.0, 0.0)  # 10 kWh winter off-peak
    a = lg.bill_estimate(at(2026, 4, 10, 3))["attributes"]
    # first cycle start on or after PTO
    assert a["relevant_period_start"] == "2026-04-05"
    assert a["true_up_date"] == "2027-04-05"
    assert "Average Retail Export" not in a["beta_note"]

    lg.on_energy(at(2026, 7, 15, 12, 0, 10), 110.0, 50.0, 0.0)
    lg.on_energy(at(2026, 7, 15, 12, 30), 110.0, 140.0, 0.0)  # 90 kWh out
    lg.on_energy(at(2027, 4, 5, 0, 1), 110.0, 140.0, 0.0)

    energy_paid = 10 * ER_WINTER_OFF  # 2.9188, nothing to offset it in April
    eec = 90 * JUL_WD_12  # 4.7457
    surplus = 90 - 10
    adjustment = surplus * 0.02  # 1.6
    left = eec - adjustment  # 3.1457
    refund = min(left, energy_paid)  # 2.9188
    nsc = surplus * 0.03  # 2.4
    assert lg.to_dict()["nbt"]["last_true_up"] == {
        "relevant_period_start": "2026-04-05",
        "relevant_period_end": "2027-04-05",
        "import_kwh": 10.0,
        "export_kwh": 90.0,
        "surplus_kwh": 80.0,
        "export_credit_left": round(eec, 2),
        "export_credit_adjustment": round(adjustment, 2),
        "energy_charges_refunded": round(refund, 2),
        "export_credit_forfeited": round(left - refund, 2),
        "net_surplus_compensation": round(nsc, 2),
    }
    bill = lg.bill_estimate(at(2027, 4, 5, 12))
    a = bill["attributes"]
    assert a["relevant_period_start"] == "2027-04-05"
    assert a["export_credit_carried_in"] == 0
    assert a["due_before_credits"] == round(DAILY, 2)
    assert a["account_credit_applied"] == round(DAILY, 2)
    assert a["account_credit_carried_forward"] == round(refund + nsc - DAILY, 2)
    assert bill["state"] == 0


def test_no_pto_means_no_true_up(tariff, nbt_raw):
    lg = make(tariff, nbt_raw, cycle_day=5)
    lg.on_energy(at(2026, 7, 15, 12, 0, 10), 100.0, 50.0, 0.0)
    lg.on_energy(at(2026, 7, 15, 12, 30), 100.0, 140.0, 0.0)
    lg.on_energy(at(2028, 7, 5, 0, 1), 100.0, 140.0, 0.0)
    a = lg.bill_estimate(at(2028, 7, 5, 12))["attributes"]
    assert a["export_credit_carried_in"] == round(90 * JUL_WD_12, 2)
    assert a["last_true_up"] is None


def test_close_interval_charges_nothing(tariff, nbt_raw):
    lg = make(tariff, nbt_raw)
    lg.on_energy(at(2026, 12, 3, 2, 0, 10), 100.0, 50.0, 0.0)
    lg.close_interval(at(2026, 12, 3, 2, 0, 30))
    lg.on_energy(at(2026, 12, 3, 2, 59), 105.0, 50.0, 0.0)
    before = lg.totals
    lg.close_interval(at(2026, 12, 3, 3, 0, 30))
    assert lg.totals == before
    assert before["nbc"] == pytest.approx(5 * NBC)
    assert lg.interval["last_interval_net_kwh"] == 5.0


def test_restart_round_trip(tariff, nbt_raw):
    settings = {"pto_date": "2026-03-10", "arecr": 0.02}
    steps = []
    imp, exp, prod = 100.0, 50.0, 0.0
    when = at(2026, 7, 28, 0, 5)
    for _ in range(24 * 4 * 8):  # eight days of 15 minute steps across Aug 1
        when += timedelta(minutes=15)
        imp += 0.4 if when.hour < 9 or when.hour >= 17 else 0.02
        exp += 0.6 if 10 <= when.hour < 16 else 0.0
        prod += 0.9 if 9 <= when.hour < 17 else 0.0
        steps.append((when, round(imp, 3), round(exp, 3), round(prod, 3)))

    def run(lg, part):
        for w, *vals in part:
            lg.on_energy(w, *vals)
            if w.minute == 0:
                lg.close_interval(w + timedelta(seconds=30))
                lg.maybe_reset_cycle(w + timedelta(seconds=45))

    straight = make(tariff, nbt_raw, **settings)
    run(straight, steps)
    half = len(steps) // 2
    first = make(tariff, nbt_raw, **settings)
    run(first, steps[:half])
    saved = json.loads(json.dumps(first.to_dict()))
    second = make(tariff, nbt_raw, state=saved, **settings)
    run(second, steps[half:])

    end = steps[-1][0]
    assert second.to_dict() == straight.to_dict()
    assert second.bill_estimate(end) == straight.bill_estimate(end)
    a = straight.bill_estimate(end)["attributes"]
    assert a["cycle_start"] == "2026-08-01"
    assert a["relevant_period_import_kwh"] > a["import_kwh"] > 0


# ---------------------------------------------------------------- vintages and true-up


def test_acc_plus_follows_pto_year(tariff, nbt_raw):
    when = at(2026, 7, 1)
    assert make(tariff, nbt_raw, pto_date="2024-05-01").acc_plus_rate_at(when) == 0.032
    equity = make(tariff, nbt_raw, pto_date="2024-05-01", acc_plus_class="residential_equity")
    assert equity.acc_plus_rate_at(when) == 0.074
    assert make(tariff, nbt_raw, pto_date="2025-05-01").acc_plus_rate_at(when) == 0.024
    assert make(tariff, nbt_raw, pto_date="2026-05-01").acc_plus_rate_at(when) == ACC
    # 2028 and later get no ACC Plus
    assert make(tariff, nbt_raw, pto_date="2029-05-01").acc_plus_rate_at(at(2030, 7, 1)) == 0


def test_price_vintage_note(tariff, nbt_raw):
    def note(pto):
        lg = make(tariff, nbt_raw, pto_date=pto)
        return lg.bill_estimate(at(2026, 7, 1))["attributes"]["beta_note"]

    assert "has its own schedule" in note("2024-05-01")
    assert "NBT26" in note("2024-05-01")
    # NBT25 prices match NBT26 for every year in the file
    assert "has its own schedule" not in note("2025-05-01")
    assert "has its own schedule" not in note("2026-05-01")
    assert "No ACC Plus adder found" not in note("2024-05-01")


def test_old_pto_does_not_run_a_stale_true_up(tariff, nbt_raw):
    lg = make(tariff, nbt_raw, pto_date="2023-03-15")
    lg.on_energy(at(2026, 9, 10, 18, 0, 10), 100.0, 50.0, 0.0)
    lg.on_energy(at(2026, 9, 10, 18, 50), 100.0, 90.0, 0.0)  # 40 kWh out
    a = lg.bill_estimate(at(2026, 9, 20))["attributes"]
    assert a["relevant_period_start"] == "2026-04-01"
    assert a["true_up_date"] == "2027-04-01"

    assert lg.maybe_reset_cycle(at(2026, 10, 1, 0, 0, 45))
    state = lg.to_dict()["nbt"]
    assert state["last_true_up"] is None
    assert state["export_credit_carry"] == lg.totals["export_credit"] > 10
    assert lg.bill_estimate(at(2026, 10, 2))["attributes"]["true_up_date"] == "2027-04-01"


def test_cycles_before_relevant_period_are_left_out(tariff, nbt_raw):
    lg = make(tariff, nbt_raw, cycle_day=5, pto_date="2026-03-10")
    lg.on_energy(at(2026, 3, 11, 2, 0, 10), 100.0, 50.0, 0.0)
    lg.on_energy(at(2026, 3, 11, 2, 30), 104.0, 50.0, 0.0)  # cycle Mar 5 - Apr 5
    lg.on_energy(at(2026, 4, 10, 2, 0, 10), 104.0, 50.0, 0.0)
    lg.on_energy(at(2026, 4, 10, 2, 30), 105.0, 50.0, 0.0)
    a = lg.bill_estimate(at(2026, 4, 10, 3))["attributes"]
    assert a["relevant_period_start"] == "2026-04-05"
    assert a["import_kwh"] == 1
    assert a["relevant_period_import_kwh"] == 1


def test_cycle_day_change_moves_relevant_period(tariff, nbt_raw):
    lg = make(tariff, nbt_raw, cycle_day=5, pto_date="2026-03-10")
    lg.on_energy(at(2026, 6, 20), 100.0, 50.0, 0.0)
    assert lg.bill_estimate(at(2026, 6, 20))["attributes"]["relevant_period_start"] == "2026-04-05"
    lg.set_cycle_day(12, at(2026, 6, 20))
    a = lg.bill_estimate(at(2026, 6, 20))["attributes"]
    assert a["relevant_period_start"] == "2026-03-12"
    assert a["true_up_date"] == "2027-03-12"


def test_energy_paid_leaves_out_what_acc_plus_covered(tariff, nbt_raw):
    lg = make(tariff, nbt_raw, pto_date="2026-03-10")
    lg.on_energy(at(2026, 8, 12, 2, 0, 10), 100.0, 50.0, 0.0)
    lg.on_energy(at(2026, 8, 12, 2, 30), 120.0, 50.0, 0.0)  # 20 kWh in, off-peak
    lg.on_energy(at(2026, 8, 12, 12, 0, 10), 120.0, 50.0, 0.0)
    lg.on_energy(at(2026, 8, 12, 12, 30), 120.0, 60.0, 0.0)  # 10 kWh out at noon
    energy_due = 20 * ER_SUMMER_OFF - 10 * nbt_raw["prices"][8]["weekday"][12]
    subtotal = energy_due + 20 * (NBC + ADDERS) + 31 * DAILY
    acc = 10 * ACC
    assert lg.maybe_reset_cycle(at(2026, 9, 1, 0, 0, 45))
    paid = lg.to_dict()["nbt"]["rp_energy_paid"]
    assert paid == pytest.approx(energy_due * (subtotal - acc) / subtotal, abs=1e-4)
    assert paid < energy_due


def test_metering_lag_is_real_time_at_fall_back(tariff, nbt_raw):
    lg = make(tariff, nbt_raw)
    # Nov 1 2026 is a Sunday; 09:01 UTC is 01:01 PST, the second 1 a.m.
    lg.on_energy(datetime(2026, 11, 1, 8, 59, tzinfo=UTC), 100.0, 50.0, 0.0)
    lg.on_energy(datetime(2026, 11, 1, 9, 1, tzinfo=UTC), 100.0, 51.0, 0.0)
    # metered at 08:58 UTC = 01:58 PDT, so hour 1, not hour 0
    assert lg.totals["export_credit"] == pytest.approx(nbt_raw["prices"][11]["weekend"][1])
