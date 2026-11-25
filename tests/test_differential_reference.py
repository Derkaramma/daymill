"""Differential check against a reference YAML package of template sensors.

These tests render the reference package's Jinja inside a real hass, at a few
hundred moments and over a synthetic meter series, and compare the results
with TariffEngine and Ledger.

The template text is not part of this repo. Set SUNFLOW_REFERENCE_TEMPLATES to
a YAML file holding it; without it every test here is skipped. Shape:

    entities:        role -> template entity config as written in the package
                     (holiday, period, import_rate, export_rate, energy_imported,
                     energy_exported, energy_produced, import_energy_charge,
                     export_credit, savings, nbc, frc_mcam, import_cost,
                     net_cost, bill)
    groups:          energy_money / interval_money / bill -> {variables: ...}
    entity_ids:      role -> entity id the templates read
    cycle_tariffs:   utility meter tariff names for the cycle meters
"""

from __future__ import annotations

import math
import os
import random
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pytest
import yaml
from homeassistant.core import HomeAssistant
from homeassistant.helpers.template import Template

from custom_components.sunflow_solar.billing import Ledger
from custom_components.sunflow_solar.sources import clamp_total
from custom_components.sunflow_solar.tariff import TariffEngine, load_preset

FIXTURE_ENV = "SUNFLOW_REFERENCE_TEMPLATES"
PRESET = "sce_tou_d_prime"
TZ = ZoneInfo("America/Los_Angeles")

# reference attribute name -> rate_attributes() name
RATE_KEYS = {
    "period": "period",
    "label": "label",
    "season": "season",
    "delivery": "delivery",
    "generation": "generation",
    "period_total": "period_total",
    "frc": "frc",
    "mcam": "mcam",
    "frc_mcam_per_kwh": "interval_adders_per_kwh",
    "nbc_per_kwh": "nbc_per_kwh",
    "nbc_components": "nbc_components",
    "delivery_table": "delivery_table",
    "generation_table": "generation_table",
    "period_total_table": "period_total_table",
    "rate_table": "rate_table",
    "energy_rate_table": "energy_rate_table",
    "base_services_charge_per_day": "daily_charge",
    "net_surplus_compensation_rate": "net_surplus_compensation_rate",
    "california_climate_credit": "climate_credit",
    "effective_date": "effective_date",
    "advice_letter": "advice_letter",
    "decision": "decision",
}
# free text that is worded differently on purpose; not part of the math
RATE_TEXT_ONLY = {"plan", "definitions", "tariff_sheets", "unverified_items"}

# reference bill attribute -> Ledger.bill_estimate() attribute
BILL_KEYS = {
    "cycle_start": "cycle_start",
    "days_in_cycle": "days_in_cycle",
    "base_charges": "base_charges",
    "nbc_charges": "nbc_charges",
    "frc_mcam_charges": "adder_charges",
    "nem_energy_balance": "nem_energy_balance",
    "energy_charges": "energy_charges",
    "energy_credits": "energy_credits",
    "due_this_cycle_mbo": "due_this_cycle_mbo",
    "credit_carried_forward": "credit_carried_forward",
    "due_monthly_minimum": "due_monthly_minimum",
    "import_kwh": "import_kwh",
    "export_kwh": "export_kwh",
}
ROW_KEYS = ("season", "period", "import_kwh", "export_kwh", "net_kwh", "energy_rate", "amount")


# ---------------------------------------------------------------- fixtures


@pytest.fixture(scope="module")
def live_fx() -> dict:
    path = os.environ.get(FIXTURE_ENV)
    if not path or not Path(path).is_file():
        pytest.skip(f"set {FIXTURE_ENV} to the reference template fixture")
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


@pytest.fixture(scope="module")
def tariff():
    return load_preset(PRESET)


@pytest.fixture
async def live(hass: HomeAssistant, live_fx: dict) -> _Live:
    await hass.config.async_set_time_zone(str(TZ))
    return _Live(hass, live_fx)


# ---------------------------------------------------------------- renderer


class _This:
    """Stand-in for `this` in trigger templates: the entity's state before the update."""

    def __init__(self, state: str | None, attributes: dict) -> None:
        self.state = "unknown" if state is None else state
        self.attributes = attributes


class _Live:
    def __init__(self, hass: HomeAssistant, fx: dict) -> None:
        self.hass = hass
        self.fx = fx
        self.ent = fx["entities"]
        self.ids = fx["entity_ids"]
        self._tpl: dict[str, Template] = {}

    def render(self, value: Any, variables: dict | None = None, *, parse: bool = True) -> Any:
        if isinstance(value, dict):
            return {k: self.render(v, variables, parse=parse) for k, v in value.items()}
        if isinstance(value, list):
            return [self.render(v, variables, parse=parse) for v in value]
        if not isinstance(value, str):
            return value
        tpl = self._tpl.get(value)
        if tpl is None:
            tpl = self._tpl[value] = Template(value, self.hass)
        return tpl.async_render(variables or {}, parse_result=parse)

    def render_vars(self, raw: dict, base: dict | None = None) -> dict:
        out = dict(base or {})
        for key, value in raw.items():
            out[key] = self.render(value, out)
        return out

    def set(self, role: str, state: Any, attributes: dict | None = None) -> None:
        self.hass.states.async_set(self.ids[role], str(state), attributes or {})

    def attrs(self, ent: dict, variables: dict | None = None) -> dict:
        raw = ent.get("attributes") or {}
        if isinstance(raw, str):
            return self.render(raw, variables)
        return {k: self.render(v, variables) for k, v in raw.items()}

    # TOU chain: holiday -> period -> import rate -> export rate
    def tou(self) -> dict[str, Any]:
        hol, per = self.ent["holiday"], self.ent["period"]
        out: dict[str, Any] = {}
        out["holiday_state"] = self.render(hol["state"], parse=False).strip()
        out["holiday_attrs"] = self.attrs(hol)
        self.set("holiday", out["holiday_state"], out["holiday_attrs"])

        out["period_state"] = self.render(per["state"], parse=False).strip()
        out["period_attrs"] = self.attrs(per)
        self.set("period", out["period_state"], out["period_attrs"])

        imp = self.ent["import_rate"]
        variables = self.render_vars(imp.get("variables") or {})
        out["import_available"] = self.render(imp["availability"], variables)
        out["import_state"] = self.render(imp["state"], variables)
        out["import_attrs"] = self.attrs(imp, variables)
        self.set("import_rate", out["import_state"], out["import_attrs"])

        exp = self.ent["export_rate"]
        out["export_available"] = self.render(exp["availability"])
        out["export_state"] = self.render(exp["state"])
        out["export_attrs"] = self.attrs(exp)
        self.set("export_rate", out["export_state"], out["export_attrs"])
        return out


# ---------------------------------------------------------------- moments


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    first = date(year, month, 1)
    return first + timedelta(days=(weekday - first.weekday()) % 7 + 7 * (n - 1))


def _dst_days(year: int) -> tuple[date, date]:
    return _nth_weekday(year, 3, 6, 2), _nth_weekday(year, 11, 6, 1)


def _tou_moments(engine: TariffEngine) -> list[datetime]:
    """Every boundary, the metering lag edges, DST, holidays and random hours."""
    edges = [
        (0, 0), (0, 1), (0, 2), (0, 3), (0, 4),
        (7, 59), (8, 0), (8, 2), (8, 3),
        (15, 59), (16, 0), (16, 2), (16, 3),
        (20, 59), (21, 0), (21, 2), (21, 3),
        (23, 59),
    ]  # fmt: skip
    days: set[date] = set()
    for year in (2026, 2027, 2028):
        for m, d in ((1, 1), (5, 31), (6, 1), (6, 2), (9, 30), (10, 1), (12, 31)):
            days.add(date(year, m, d))
        for hol in engine.holidays(year):
            days.update({hol, hol - timedelta(days=1), hol + timedelta(days=1)})
        days.update(_dst_days(year))
        # the fixed-date holidays in every weekday position
        for m, d in ((7, 4), (11, 11), (12, 25)):
            days.update({date(year, m, d), date(year, m, d) + timedelta(days=1)})

    out: set[datetime] = set()
    for day in days:
        for h, m in edges:
            out.add(datetime(day.year, day.month, day.day, h, m, 30, tzinfo=TZ))

    # DST: walk the changeover nights in UTC so both 1 am hours show up
    for year in (2026, 2027, 2028):
        for day in _dst_days(year):
            start = datetime(day.year, day.month, day.day, tzinfo=TZ).astimezone(UTC)
            for k in range(0, 5 * 60, 10):
                out.add((start + timedelta(minutes=k, seconds=5)).astimezone(TZ))

    rng = random.Random(20260)
    lo = datetime(2026, 1, 1, tzinfo=UTC).timestamp()
    hi = datetime(2029, 1, 1, tzinfo=UTC).timestamp()
    for _ in range(200):
        out.add(datetime.fromtimestamp(rng.uniform(lo, hi), tz=UTC).astimezone(TZ))
    return sorted(out)


# ---------------------------------------------------------------- TOU diff


def _diff(found: list[str], where: str, name: str, live_val: Any, ours: Any) -> None:
    if not _same(live_val, ours):
        found.append(f"{where} {name}: live={live_val!r} ours={ours!r}")


def _same(a: Any, b: Any) -> bool:
    """Equal values of the same kind. A number never equals a string or a bool."""
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    num = (int, float)
    if isinstance(a, num) and isinstance(b, num):
        return a == b
    if isinstance(a, Mapping) and isinstance(b, Mapping):
        return a.keys() == b.keys() and all(_same(a[k], b[k]) for k in a)
    if isinstance(a, list | tuple) and isinstance(b, list | tuple):
        return len(a) == len(b) and all(_same(x, y) for x, y in zip(a, b, strict=True))
    if isinstance(a, str) and isinstance(b, str):
        return a == b
    return type(a) is type(b) and a == b


def _key_order(d: Any) -> Any:
    if isinstance(d, dict):
        return [(k, _key_order(v)) for k, v in d.items()]
    return None


async def test_tou_and_rates_match_reference(live: _Live, tariff, freezer) -> None:
    engine = TariffEngine(tariff, nem="nem2")
    moments = _tou_moments(engine)
    assert len(moments) >= 300

    found: list[str] = []
    for when in moments:
        freezer.move_to(when)
        got = live.tou()
        where = when.isoformat()

        info = engine.period_at(when)
        _diff(found, where, "holiday.state", got["holiday_state"], info.holiday or "none")
        _diff(
            found, where, "holiday.dates", got["holiday_attrs"]["dates"], engine.holiday_dates(when)
        )

        _diff(found, where, "period.state", got["period_state"], info.period)
        ours = engine.period_attributes(when)
        live_attrs = got["period_attrs"]
        _diff(found, where, "period.keys", list(live_attrs), list(ours))
        for key, val in live_attrs.items():
            _diff(found, where, f"period.{key}", val, ours.get(key))

        _diff(found, where, "import.available", got["import_available"], True)
        _diff(found, where, "import.state", float(got["import_state"]), engine.import_price(when))
        rate = engine.rate_attributes(when)
        for old, new in RATE_KEYS.items():
            _diff(found, where, f"import.{old}", got["import_attrs"].get(old), rate.get(new))
            if old.endswith("_table"):
                _diff(
                    found,
                    where,
                    f"import.{old}.order",
                    _key_order(got["import_attrs"].get(old)),
                    _key_order(rate.get(new)),
                )
        extra = set(got["import_attrs"]) - set(RATE_KEYS) - RATE_TEXT_ONLY
        _diff(found, where, "import.unmapped_keys", sorted(extra), [])

        _diff(found, where, "export.available", got["export_available"], True)
        _diff(found, where, "export.state", float(got["export_state"]), engine.export_price(when))
        _diff(
            found,
            where,
            "export.non_bypassable_charge",
            got["export_attrs"]["non_bypassable_charge"],
            engine.nbc_per_kwh,
        )

    assert not found, f"{len(found)} mismatches over {len(moments)} moments:\n" + "\n".join(
        found[:40]
    )


# ---------------------------------------------------------------- billing replay


@dataclass
class _Glitches:
    dip_import_at: int | None = None  # raw import reads 0 once
    unavailable_export_at: int | None = None  # raw export unavailable once
    spike_import_at: int | None = None  # raw import jumps 150 kWh and stays
    spike_kwh: float = 150.0


@dataclass
class _Scenario:
    name: str
    start: datetime  # local
    hours: int
    cycle_day: int
    seed: int
    glitches: _Glitches = field(default_factory=_Glitches)


def _readings(sc: _Scenario):
    """(when, raw import, raw export, raw production) every 5 minutes, 7 s past."""
    rng = random.Random(sc.seed)
    imp, exp, prod = 4321.0 + rng.random(), 1234.0 + rng.random(), 9876.0 + rng.random()
    t = sc.start.astimezone(UTC) + timedelta(seconds=7)
    end = t + timedelta(hours=sc.hours)
    g = sc.glitches
    spike = 0.0
    i = 0
    while t < end:
        local = t.astimezone(TZ)
        h = local.hour + local.minute / 60
        sun = math.sin(math.pi * (h - 6.5) / 12.5) if 6.5 < h < 19 else 0.0
        pv = round(0.42 * sun * rng.uniform(0.5, 1.0), 3)
        load = round(rng.uniform(0.02, 0.2) + (0.25 if 16 <= h < 22 else 0.0), 3)
        net = load - pv
        di, de = max(net, 0.0), max(-net, 0.0)
        if rng.random() < 0.2:  # import and export inside one 5-minute step
            extra = round(rng.uniform(0.001, 0.05), 3)
            di, de = di + extra, de + extra
        imp, exp, prod = imp + di, exp + de, prod + pv
        if g.spike_import_at == i:
            spike = g.spike_kwh
        r_imp: float | None = round(imp + spike, 3)
        r_exp: float | None = round(exp, 3)
        if g.dip_import_at == i:
            r_imp = 0.0
        if g.unavailable_export_at == i:
            r_exp = None
        yield t, r_imp, r_exp, round(prod, 3)
        t += timedelta(minutes=5)
        i += 1


class _LivePackage:
    """The reference package's money path, rendered from its own templates.

    Utility meters and the two automations are plain Python here; everything
    else is the package's Jinja.
    """

    def __init__(self, live: _Live, freezer, cycle_day: int) -> None:
        self.live = live
        self.freezer = freezer
        self.cycle_day = cycle_day
        self.ent = live.ent
        self.groups = live.fx["groups"]
        self.tariffs: list[str] = live.fx["cycle_tariffs"]
        # entity role -> (state string, attributes)
        self.st: dict[str, tuple[str | None, dict]] = {}
        self.cyc_imp = dict.fromkeys(self.tariffs, Decimal(0))
        self.cyc_exp = dict.fromkeys(self.tariffs, Decimal(0))
        self.cyc_nbc = Decimal(0)
        self.cyc_fm = Decimal(0)
        self.tariff: str | None = None
        self._tou_key: tuple | None = None
        self._last_src: dict[str, Decimal] = {}
        live.set("cycle_day", float(cycle_day))

    # --- helpers

    def _at(self, when: datetime) -> None:
        self.freezer.move_to(when)
        local = when.astimezone(TZ)
        lag = local - timedelta(minutes=3)
        key = (local.date(), local.hour, lag.date(), lag.hour)
        if key != self._tou_key:
            self._tou_key = key
            got = self.live.tou()
            mt = got["period_attrs"]["metering_tariff"]
            if mt in self.tariffs:  # the automation that drives the cycle meters
                self.tariff = mt

    def _state(self, role: str) -> str | None:
        return self.st.get(role, (None, {}))[0]

    def _write(self, role: str, state: Any, attrs: dict) -> bool:
        old = self._state(role)
        new = None if state is None else str(state)
        self.st[role] = (new, attrs)
        if new is not None:
            self.live.set(role, new, attrs)
        return new != old

    def _render_entity(self, role: str, variables: dict) -> tuple[Any, dict]:
        ent = self.ent[role]
        old_state, old_attrs = self.st.get(role, (None, {}))
        v = {**variables, "this": _This(old_state, old_attrs)}
        if "availability" in ent and not self.live.render(ent["availability"], v):
            return old_state, old_attrs  # stays as it was for our purposes
        state = self.live.render(ent["state"], v)
        attrs = self.live.attrs(ent, v)
        return state, attrs

    # --- triggers

    def raw(self, when: datetime, imp: float | None, exp: float | None, prod: float) -> list[str]:
        """Raw meters update. Returns the clamped energy sensors that changed."""
        self._at(when)
        changed: list[str] = []
        updates = (("raw_import", imp), ("raw_export", exp), ("raw_production", prod))
        for role, value in updates:
            old = self.live.hass.states.get(self.live.ids[role])
            new = "unavailable" if value is None else str(value)
            if old is not None and old.state == new:
                continue
            self.live.set(role, new)
            if value is None:
                continue  # not_to: unavailable
            group = (
                ("energy_produced",)
                if role == "raw_production"
                else (
                    "energy_imported",
                    "energy_exported",
                )
            )
            for target in group:
                state, attrs = self._render_entity(target, {})
                if state is not None and self._write(target, state, attrs):
                    changed.append(target)
                    self._energy_changed(target)
        return changed

    def _energy_changed(self, role: str) -> None:
        # utility meters follow the clamped totals
        new = Decimal(self._state(role))
        prev = self._last_src.get(role)
        self._last_src[role] = new
        if prev is not None and self.tariff is not None:
            if role == "energy_imported":
                self.cyc_imp[self.tariff] += new - prev
            elif role == "energy_exported":
                self.cyc_exp[self.tariff] += new - prev
        # money accumulators
        variables = self.live.render_vars(self.groups["energy_money"]["variables"])
        for target in ("import_energy_charge", "export_credit", "savings"):
            state, attrs = self._render_entity(target, variables)
            self._write(target, state, attrs)

    def start(self, when: datetime, imp: float, exp: float, prod: float) -> None:
        self._at(when)
        self.live.set("raw_import", imp)
        self.live.set("raw_export", exp)
        self.live.set("raw_production", prod)
        for target in ("energy_produced", "energy_imported", "energy_exported"):
            state, attrs = self._render_entity(target, {})
            self._write(target, state, attrs)
            self._energy_changed(target)
        self._interval(when, "start")

    def close(self, when: datetime) -> None:
        self._at(when)
        self._interval(when, "close")

    def _interval(self, when: datetime, trigger_id: str) -> None:
        variables = self.live.render_vars(
            self.groups["interval_money"]["variables"], {"trigger": {"id": trigger_id}}
        )
        for target, attr in (("nbc", "cyc_nbc"), ("frc_mcam", "cyc_fm")):
            prev = self._state(target)
            state, attrs = self._render_entity(target, variables)
            self._write(target, state, attrs)
            if prev is not None:
                delta = Decimal(self._state(target)) - Decimal(prev)
                setattr(self, attr, getattr(self, attr) + delta)

    def reset(self, when: datetime) -> None:
        """The 00:00:45 automation."""
        if when.astimezone(TZ).day == self.cycle_day:
            self.cyc_imp = dict.fromkeys(self.tariffs, Decimal(0))
            self.cyc_exp = dict.fromkeys(self.tariffs, Decimal(0))
            self.cyc_nbc = Decimal(0)
            self.cyc_fm = Decimal(0)

    def totals(self) -> dict[str, float]:
        out = {
            "import_energy_charge": float(self._state("import_energy_charge")),
            "export_credit": float(self._state("export_credit")),
            "savings": float(self._state("savings")),
            "nbc": float(self._state("nbc")),
            "adders": float(self._state("frc_mcam")),
        }
        for role in ("import_cost", "net_cost"):
            out[role] = float(self.live.render(self.ent[role]["state"]))
        return out

    def interval_net(self) -> float | None:
        return self.st["nbc"][1].get("last_interval_net_kwh")

    def bill(self, when: datetime) -> tuple[float, dict]:
        self._at(when)
        ids = self.live.ids
        hass = self.live.hass
        for t in self.tariffs:
            hass.states.async_set(ids["cycle_import_prefix"] + t, str(self.cyc_imp[t]))
            hass.states.async_set(ids["cycle_export_prefix"] + t, str(self.cyc_exp[t]))
        self.live.set("cycle_nbc", self.cyc_nbc)
        self.live.set("cycle_frc_mcam", self.cyc_fm)
        variables = self.live.render_vars(self.groups["bill"]["variables"])
        ent = self.ent["bill"]
        assert self.live.render(ent["availability"], variables)
        state = self.live.render(ent["state"], variables)
        return float(state), self.live.attrs(ent, variables)


def _events(sc: _Scenario) -> list[tuple[datetime, int, str, Any]]:
    """Readings, hourly closes at :00:30, the 00:00:45 reset and bill checks.

    "edge" is a bill check at 00:00:20 on the cycle day, between midnight and
    the reset.
    """
    ev: list[tuple[datetime, int, str, Any]] = []
    readings = list(_readings(sc))
    for r in readings[1:]:
        ev.append((r[0], 0, "reading", r[1:]))
    t0 = readings[0][0]
    end = readings[-1][0]
    hour = t0.replace(minute=0, second=30, microsecond=0) + timedelta(hours=1)
    while hour <= end:
        ev.append((hour, 1, "close", None))
        local = hour.astimezone(TZ)
        if local.hour == 0:
            ev.append((hour + timedelta(seconds=15), 2, "reset", None))
            if local.day == sc.cycle_day:
                ev.append((hour - timedelta(seconds=10), 3, "edge", None))
        if local.hour % 3 == 0:
            ev.append((hour + timedelta(seconds=30), 3, "bill", None))
        hour += timedelta(hours=1)
    ev.append((end + timedelta(seconds=20), 3, "bill", None))
    ev.sort(key=lambda e: (e[0], e[1]))
    return [(t0, -1, "start", readings[0][1:]), *ev]


def _compare_bill(found: list[str], where: str, live_bill, ours: dict) -> None:
    live_state, live_attrs = live_bill
    _diff(found, where, "bill.state", live_state, ours["state"])
    a = ours["attributes"]
    for old, new in BILL_KEYS.items():
        _diff(found, where, f"bill.{old}", live_attrs.get(old), a.get(new))
    live_rows, our_rows = live_attrs.get("periods") or [], a.get("periods") or []
    _diff(found, where, "bill.rows", len(live_rows), len(our_rows))
    for lr, orow in zip(live_rows, our_rows, strict=False):
        for key in ROW_KEYS:
            _diff(
                found, where, f"bill.row[{lr['season']}_{lr['period']}].{key}", lr[key], orow[key]
            )


def _replay(live: _Live, freezer, engine: TariffEngine, sc: _Scenario) -> dict[str, Any]:
    pkg = _LivePackage(live, freezer, sc.cycle_day)
    ledger = Ledger(engine, sc.cycle_day)
    found: list[str] = []
    edge: list[str] = []
    bills: list[tuple[str, tuple, dict]] = []
    clamp: dict[str, float | None] = {}
    roles = {"energy_imported": "imp", "energy_exported": "exp", "energy_produced": "prod"}
    day: date | None = None
    midnight_net: float | None = None

    def feed(when: datetime, changed: list[str]) -> None:
        for role in changed:
            clamp[roles[role]] = float(pkg._state(role))
            ledger.on_energy(when, clamp.get("imp"), clamp.get("exp"), clamp.get("prod"))

    for when, _, kind, data in _events(sc):
        local = when.astimezone(TZ)
        where = f"{sc.name} {local.isoformat()}"
        if day is not None and local.date() != day:
            # what the recorder's hourly row at midnight would hold
            midnight_net = pkg.totals()["net_cost"]
        day = local.date()
        if kind == "start":
            pkg.start(when, *data)
            feed(when, list(roles))
        elif kind == "reading":
            prev = {r: pkg._state(r) for r in roles}
            raw = dict(zip(("imp", "exp", "prod"), data, strict=True))
            changed = pkg.raw(when, *data)
            # the integration clamps the same way
            for role, key in roles.items():
                if raw[key] is None:
                    continue
                old = float(prev[role]) if prev[role] is not None else None
                ours = clamp_total(raw[key], old, 3)
                _diff(found, where, f"clamp.{role}", float(pkg._state(role)), ours)
            feed(when, changed)
        elif kind == "close":
            pkg.close(when)
            ledger.close_interval(when)
            _diff(
                found,
                where,
                "interval.last_net_kwh",
                pkg.interval_net(),
                ledger.interval["last_interval_net_kwh"],
            )
        elif kind == "reset":
            pkg.reset(when)
            ledger.maybe_reset_cycle(when)
        elif kind in ("bill", "edge"):
            live_bill = pkg.bill(when)
            ours = ledger.bill_estimate(when)
            bills.append((where, live_bill, ours))
            _compare_bill(edge if kind == "edge" else found, where, live_bill, ours)
            if kind == "bill" and midnight_net is not None:
                # reference cost today: today's net cost + the day's base charge
                rate = live.hass.states.get(live.ids["import_rate"])
                daily = float(rate.attributes["base_services_charge_per_day"])
                live_today = round(pkg.totals()["net_cost"] - midnight_net + daily, 2)
                _diff(found, where, "cost_today", live_today, ledger.cost_today(when))

    live_totals = pkg.totals()
    our_totals = ledger.totals
    for key, val in live_totals.items():
        _diff(found, f"{sc.name} end", f"totals.{key}", val, our_totals[key])
    return {
        "found": found,
        "edge": edge,
        "bills": bills,
        "live": live_totals,
        "ours": our_totals,
    }


SCENARIOS = [
    # season change and a cycle reset on the same night
    _Scenario("fall-season", datetime(2026, 9, 28, 22, 0, tzinfo=TZ), 80, 1, 11),
    # summer weekend into an observed holiday (Jul 4 2027 is a Sunday)
    _Scenario("summer-holiday", datetime(2027, 7, 2, 12, 0, tzinfo=TZ), 90, 5, 22),
    # DST ends on the cycle day; a dip to 0 and an unavailable reading
    _Scenario(
        "dst-cycle",
        datetime(2026, 10, 31, 6, 0, tzinfo=TZ),
        60,
        1,
        33,
        _Glitches(dip_import_at=40, unavailable_export_at=90),
    ),
]

# Between 00:00:00 and the 00:00:45 reset on the cycle day the reference sensor
# already shows the new cycle's start and day count over the old cycle's
# meters. The ledger keeps the old cycle until the reset.
EDGE_FIELDS = {
    "bill.state",
    "bill.cycle_start",
    "bill.days_in_cycle",
    "bill.base_charges",
    "bill.due_this_cycle_mbo",
    "bill.due_monthly_minimum",
}


@pytest.mark.parametrize("sc", SCENARIOS, ids=lambda s: s.name)
async def test_billing_matches_reference(live: _Live, tariff, freezer, sc: _Scenario) -> None:
    engine = TariffEngine(tariff, nem="nem2")
    result = _replay(live, freezer, engine, sc)
    assert len(result["bills"]) >= 10, "too few bill checks ran"
    found = result["found"]
    assert not found, f"{len(found)} mismatches:\n" + "\n".join(found[:40])
    for line in result["edge"]:
        assert line.split(" ")[2].rstrip(":") in EDGE_FIELDS, line


async def test_meter_spike(live: _Live, tariff, freezer) -> None:
    """A 150 kWh meter spike that never comes back down.

    Both sides skip it in the money totals. The reference cycle meters
    (utility_meter) count it, so the reference bill bills 150 kWh that the
    ledger leaves out on purpose.
    """
    sc = _Scenario(
        "spike",
        datetime(2026, 8, 10, 6, 0, tzinfo=TZ),
        30,
        20,
        44,
        _Glitches(spike_import_at=100),
    )
    engine = TariffEngine(tariff, nem="nem2")
    result = _replay(live, freezer, engine, sc)
    money = [f for f in result["found"] if " end totals." in f or "cost_today" in f]
    assert not money, "\n".join(money)

    where, (_, live_attrs), ours = result["bills"][-1]
    extra = live_attrs["import_kwh"] - ours["attributes"]["import_kwh"]
    assert extra == pytest.approx(sc.glitches.spike_kwh, abs=0.01), where
