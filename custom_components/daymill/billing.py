"""Billing ledger: turns lifetime meter readings into money.

Pure accounting, no Home Assistant imports. The coordinator feeds it lifetime
kWh totals (already clamped so they never go down) and calls the timed hooks:

* on_energy() on every meter update,
* close_interval() every hour at HH:00:30, after the meter's HH:00 reading,
* maybe_reset_cycle() at 00:00:45, after the 00:00:30 close, so the ending
  cycle keeps its last kWh and its last hour of interval charges.

on_energy() and close_interval() also check for a due cycle reset first, so a
reset missed while Home Assistant was down still happens.

Money model for NEM 2.0 (NEM-ST):
    energy   = sum over TOU periods of (import - export) kWh x energy rate
               (energy rate = period total - NBC)
    NBC      = nbc x max(0, import - export) per 1-hour interval
    adders   = "net_interval" adders on the same hourly net import, never
               credited; "import" adders on gross import
    base     = daily charge x days

NEM 1.0 is the same without NBC (energy rate = period total). With no NEM,
exports earn nothing and imports pay the full import price.

Money model for NEM 3.0 (SCE Net Billing Tariff). Import and export are
separate meter channels and are never netted against each other:
    energy   = gross import x (period total - NBC), per TOU period
    NBC      = gross import x NBC, on every step (no hourly close-out)
    adders   = every adder on gross import
    export   = gross export x hourly export price (calendar year, month,
               weekday/weekend, hour), kept as dollars
    ACC Plus = gross export x the vintage's adder, while locked in
    base     = daily charge x days
Each month export credit offsets energy charges only (any period) and the
rest carries forward. ACC Plus then offsets whatever is left on the bill and
carries forward with no end date. At the end of each 12-month relevant period
(needs the PTO date) leftover export credit pays back energy charges paid
earlier in that period, and the rest is forfeited.

Every accumulator is rounded to 5 decimals after each update. The adder
total is kept as one number (rounded once per update) next to the per-adder
split, so the total does not pick up rounding from each adder.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

STATE_VERSION = 1

NEM1 = "nem1"
NEM2 = "nem2"
NEM3 = "nem3"
NEM_NONE = "none"
NEM_MODES = (NEM1, NEM2, NEM3, NEM_NONE)

# A meter step this big (or negative) is a glitch, not real energy. It is
# left out of the money and the cycle kWh alike, so a meter spike never
# shows up on the bill estimate.
STEP_GLITCH_KWH = 100.0
# Same idea for an interval close, which can span hours of downtime.
INTERVAL_GLITCH_KWH = 1000.0
# The cycle rolls over this long after midnight on the cycle day.
CYCLE_RESET_DELAY = timedelta(seconds=45)

BASIS_NET_INTERVAL = "net_interval"
BASIS_IMPORT = "import"
BASIS_NETTED = "netted"

ROUND = 5

# NEM 3.0 export prices and the ACC Plus adder are locked this long from PTO.
NBT_LOCK_IN_YEARS = 9
ACC_PLUS_RESIDENTIAL = "residential"
ACC_PLUS_EQUITY = "residential_equity"
ACC_PLUS_NONE = "none"
ACC_PLUS_CLASSES = (ACC_PLUS_RESIDENTIAL, ACC_PLUS_EQUITY, ACC_PLUS_NONE)


def normalize_nem(value: Any) -> str:
    """Map config values like "NEM 2.0", "nem2" or None to a mode key."""
    if value is None:
        return NEM_NONE
    text = str(value).strip().lower().replace(" ", "").replace(".0", "").replace("_", "")
    if text in ("nem1", "1"):
        return NEM1
    if text in ("nem2", "2", "nemst"):
        return NEM2
    if text in ("nem3", "3", "nbt"):
        return NEM3
    if text in ("none", "nonem", "off", ""):
        return NEM_NONE
    raise ValueError(f"unknown NEM mode: {value!r}")


def clamp_cycle_day(day: Any) -> int:
    """Cycle day as an int in 1..28 (so every month has it)."""
    try:
        value = int(day)
    except (TypeError, ValueError):
        value = 1
    return min(max(value, 1), 28)


def cycle_start_for(today: date, cycle_day: int) -> date:
    """First day of the billing cycle that contains `today`."""
    day = clamp_cycle_day(cycle_day)
    if today.day >= day:
        return today.replace(day=day)
    return (today.replace(day=1) - timedelta(days=1)).replace(day=day)


def _num(value: Any) -> float | None:
    """Finite float or None (None, "unavailable", NaN and the like)."""
    if value is None or isinstance(value, bool):
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) else None


def _step(new: float | None, last: float | None, limit: float) -> float:
    """Delta between two readings, or 0 for a missing reading or a glitch."""
    if new is None or last is None:
        return 0.0
    delta = new - last
    return delta if 0 <= delta < limit else 0.0


def _r(value: float) -> float:
    return round(value, ROUND)


def _date(value: Any) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _add_years(day: date, years: int) -> date:
    try:
        return day.replace(year=day.year + years)
    except ValueError:  # Feb 29
        return day.replace(year=day.year + years, day=28)


def _next_month(day: date) -> date:
    """Same day next month. Only used with cycle days (1..28)."""
    if day.month == 12:
        return day.replace(year=day.year + 1, month=1)
    return day.replace(month=day.month + 1)


def _year_table(raw: Any) -> dict[int, dict[int, dict[str, tuple[float, ...]]]]:
    """{year: {month: {"weekday"|"weekend": 24 prices}}} with int keys."""
    out: dict[int, dict[int, dict[str, tuple[float, ...]]]] = {}
    if not isinstance(raw, dict):
        return out
    for year, months in raw.items():
        if not isinstance(months, dict):
            continue
        table: dict[int, dict[str, tuple[float, ...]]] = {}
        for month, kinds in months.items():
            if not isinstance(kinds, dict):
                continue
            table[int(month)] = {
                kind: tuple(float(v) for v in hours)
                for kind, hours in kinds.items()
                if kind in ("weekday", "weekend") and len(hours) == 24
            }
        if table:
            out[int(year)] = table
    return out


def nbt_options(table: dict | None = None, **settings: Any) -> dict[str, Any]:
    """Ledger NEM 3.0 options from a raw export table file plus user settings.

    `table` is the parsed yaml of a tariff/nbt/*.yaml file. Its "prices" (for
    "price_year") and "prices_by_year" are merged into one per-year table.
    Settings: pto_date, acc_plus_class, acc_plus_per_kwh, arecr, nsc_rate,
    nsc_opt_in, lock_in_years. None values are dropped.

    Also carried over from the table: acc_plus_adder (this vintage),
    acc_plus_by_vintage ({PTO year: {class: $/kWh}}), vintage, vintage_year and
    price_vintages (PTO years whose export prices match this table).
    """
    out: dict[str, Any] = {}
    if table:
        years: dict[Any, Any] = dict(table.get("prices_by_year") or {})
        year = table.get("price_year")
        if year is None:
            eff = _date(table.get("effective_date"))
            year = eff.year if eff else None
        if table.get("prices") and year is not None:
            years[int(year)] = table["prices"]
        out["prices_by_year"] = _year_table(years)
        if table.get("acc_plus_adder") is not None:
            out["acc_plus_adder"] = dict(table["acc_plus_adder"])
        if table.get("lock_in_years") is not None:
            out["lock_in_years"] = int(table["lock_in_years"])
        by_vintage = table.get("acc_plus_by_vintage")
        if isinstance(by_vintage, dict):
            out["acc_plus_by_vintage"] = {
                int(y): dict(v) for y, v in by_vintage.items() if isinstance(v, dict)
            }
        if table.get("vintage"):
            out["vintage"] = str(table["vintage"])
        vintage_year = table.get("vintage_year", year)
        if vintage_year is not None:
            out["vintage_year"] = int(vintage_year)
        if table.get("price_vintages"):
            out["price_vintages"] = [int(y) for y in table["price_vintages"]]
    out.update({k: v for k, v in settings.items() if v is not None})
    return out


@dataclass(frozen=True)
class Rates:
    """Prices for one (season, period) under the ledger's NEM mode, $/kWh."""

    season: str
    period: str
    period_total: float
    energy_rate: float  # what an imported kWh costs before interval charges
    export_rate: float | None  # None: priced per hour (NEM 3.0)
    nbc: float  # NEM 2.0: on hourly net import. NEM 3.0: on gross import
    interval_adders: dict[str, float]  # charged on hourly net import
    import_adders: dict[str, float]  # charged on gross import

    @property
    def key(self) -> str:
        return f"{self.season}_{self.period}"

    @property
    def adders_total(self) -> float:
        return _r(sum(self.interval_adders.values()) + sum(self.import_adders.values()))

    @property
    def import_price(self) -> float:
        """A kWh bought with no export in the same interval."""
        return _r(self.energy_rate + self.nbc + self.adders_total)


def _empty_bucket(season: str, period: str) -> dict[str, Any]:
    return {
        "season": season,
        "period": period,
        "import_kwh": 0.0,
        "export_kwh": 0.0,
        "import_charge": 0.0,
        "export_credit": 0.0,
    }


def _empty_today(day: date | None) -> dict[str, Any]:
    return {
        "date": day.isoformat() if day else None,
        "import_energy_charge": 0.0,
        "export_credit": 0.0,
        "acc_plus": 0.0,
        "nbc": 0.0,
        "adders": 0.0,
        "savings": 0.0,
        "net_cost": 0.0,
    }


_NBT_FIELDS = (
    "export_credit_carry",
    "acc_plus_carry",
    "account_credit",
    "rp_import_kwh",
    "rp_export_kwh",
    "rp_energy_charges",
    "rp_energy_paid",
)


class Ledger:
    """Lifetime, billing-cycle and daily money for one site.

    `engine` is a TariffEngine (see tariff/engine.py). The ledger uses
    engine.tariff, engine.nem, engine.metering_period_at() and, for NEM 3.0,
    engine.export_price(), engine.day_type() and engine.metering_lag.

    `nbt` holds the NEM 3.0 options (see nbt_options()). Without a per-year
    price table the ledger falls back to engine.export_price().
    """

    def __init__(
        self,
        engine: Any,
        cycle_day: int,
        state: dict | None = None,
        *,
        nbt: dict | None = None,
    ) -> None:
        self._engine = engine
        self._tariff = engine.tariff
        self._tz = ZoneInfo(self._tariff.timezone)
        self.mode = normalize_nem(getattr(engine, "nem", NEM2))
        self._cycle_day = clamp_cycle_day(cycle_day)
        self._setup_nbt(nbt or {})
        self._load(state or {})

    # ------------------------------------------------------------------ state

    def _load(self, state: dict) -> None:
        g = state.get
        self._last_import = _num(g("last_import"))
        self._last_export = _num(g("last_export"))
        self._last_production = _num(g("last_production"))
        self._latest_import = _num(g("latest_import"))
        self._latest_export = _num(g("latest_export"))
        self._interval_import = _num(g("interval_import"))
        self._interval_export = _num(g("interval_export"))
        self._last_interval_net_kwh = _num(g("last_interval_net_kwh"))
        self._last_interval_end = g("last_interval_end")
        # First day with a meter reading. Ledgers saved before this was kept
        # never learn it: their first reading here is not their first ever.
        self._tracking_start = _date(g("tracking_start"))
        self._learn_tracking_start = not state or "tracking_start" in state

        totals = g("totals") or {}
        self._import_energy_charge = _num(totals.get("import_energy_charge")) or 0.0
        self._export_credit = _num(totals.get("export_credit")) or 0.0
        self._acc_plus = _num(totals.get("acc_plus")) or 0.0
        self._nbc = _num(totals.get("nbc")) or 0.0
        self._savings = _num(totals.get("savings")) or 0.0
        self._adders = {k: _num(v) or 0.0 for k, v in (totals.get("adders") or {}).items()}
        self._adder_total = _num(totals.get("adders_total"))
        if self._adder_total is None:
            self._adder_total = _r(sum(self._adders.values()))

        cycle = g("cycle") or {}
        start = cycle.get("start")
        self._cycle_start = date.fromisoformat(start) if start else None
        self._cycle_nbc = _num(cycle.get("nbc")) or 0.0
        self._cycle_acc_plus = _num(cycle.get("acc_plus")) or 0.0
        self._cycle_adders = {k: _num(v) or 0.0 for k, v in (cycle.get("adders") or {}).items()}
        self._cycle_adder_total = _num(cycle.get("adders_total"))
        if self._cycle_adder_total is None:
            self._cycle_adder_total = _r(sum(self._cycle_adders.values()))
        self._buckets: dict[str, dict[str, Any]] = {}
        for key, b in (cycle.get("periods") or {}).items():
            bucket = _empty_bucket(str(b.get("season", "")), str(b.get("period", "")))
            for field in ("import_kwh", "export_kwh", "import_charge", "export_credit"):
                bucket[field] = _num(b.get(field)) or 0.0
            self._buckets[key] = bucket

        today = g("today") or {}
        self._today = _empty_today(None)
        self._today["date"] = today.get("date")
        for field in (
            "import_energy_charge",
            "export_credit",
            "acc_plus",
            "nbc",
            "adders",
            "savings",
            "net_cost",
        ):
            self._today[field] = _num(today.get(field)) or 0.0

        nbt = g("nbt") or {}
        self._nbt = {f: _num(nbt.get(f)) or 0.0 for f in _NBT_FIELDS}
        self._rp_start = _date(nbt.get("rp_start"))
        last = nbt.get("last_true_up")
        self._last_true_up = dict(last) if isinstance(last, dict) else None

    def to_dict(self) -> dict:
        """JSON-safe state for helpers.storage.Store."""
        return {
            "version": STATE_VERSION,
            "nem": self.mode,
            "last_import": self._last_import,
            "last_export": self._last_export,
            "last_production": self._last_production,
            "latest_import": self._latest_import,
            "latest_export": self._latest_export,
            "interval_import": self._interval_import,
            "interval_export": self._interval_export,
            "last_interval_net_kwh": self._last_interval_net_kwh,
            "last_interval_end": self._last_interval_end,
            "tracking_start": self._tracking_start.isoformat() if self._tracking_start else None,
            "totals": {
                "import_energy_charge": self._import_energy_charge,
                "export_credit": self._export_credit,
                "acc_plus": self._acc_plus,
                "nbc": self._nbc,
                "adders": dict(self._adders),
                "adders_total": self._adder_total,
                "savings": self._savings,
            },
            "cycle": {
                "start": self._cycle_start.isoformat() if self._cycle_start else None,
                "nbc": self._cycle_nbc,
                "acc_plus": self._cycle_acc_plus,
                "adders": dict(self._cycle_adders),
                "adders_total": self._cycle_adder_total,
                "periods": {k: dict(v) for k, v in self._buckets.items()},
            },
            "today": dict(self._today),
            "nbt": {
                **self._nbt,
                "rp_start": self._rp_start.isoformat() if self._rp_start else None,
                "last_true_up": dict(self._last_true_up) if self._last_true_up else None,
            },
        }

    @classmethod
    def from_dict(
        cls, engine: Any, cycle_day: int, state: dict | None, *, nbt: dict | None = None
    ) -> Ledger:
        return cls(engine, cycle_day, state, nbt=nbt)

    # ------------------------------------------------------------------ rates

    def _local(self, when: datetime) -> datetime:
        if when.tzinfo is None:
            raise ValueError("ledger needs timezone-aware datetimes")
        return when.astimezone(self._tz)

    def rates_for(self, season: str, period: str) -> Rates | None:
        """Prices of one TOU period, or None if the tariff has no price for it."""
        total = 0.0
        for comp in self._tariff.components:
            value = _num((comp.per_kwh.get(season) or {}).get(period))
            if value is None:
                return None
            total += value

        nbc_obj = getattr(self._tariff, "nbc", None)
        nbc_full = _num(getattr(nbc_obj, "per_kwh", None)) or 0.0
        interval: dict[str, float] = {}
        gross: dict[str, float] = {}
        netted = 0.0
        for adder in self._tariff.adders:
            price = _num(adder.per_kwh) or 0.0
            if adder.basis == BASIS_NETTED:
                netted += price
            elif adder.basis == BASIS_IMPORT:
                gross[adder.key] = price
            else:
                interval[adder.key] = price

        if self.mode in (NEM_NONE, NEM3):
            # Nothing is netted: every adder rides on gross import.
            gross = {**interval, **gross}
            interval = {}

        nbc = nbc_full if self.mode in (NEM2, NEM3) else 0.0
        energy_rate = _r(total + netted - nbc)
        if self.mode in (NEM1, NEM2):
            export_rate: float | None = energy_rate
        elif self.mode == NEM_NONE:
            export_rate = 0.0
        else:
            export_rate = None
        return Rates(
            season=season,
            period=period,
            period_total=_r(total),
            energy_rate=energy_rate,
            export_rate=export_rate,
            nbc=nbc,
            interval_adders=interval,
            import_adders=gross,
        )

    def _rates_at(self, when: datetime) -> Rates | None:
        try:
            info = self._engine.metering_period_at(when)
        except (LookupError, ValueError, TypeError):
            return None
        if info is None:
            return None
        return self.rates_for(info.season, info.period)

    def _export_rate(self, when: datetime, rates: Rates) -> float | None:
        if rates.export_rate is not None:
            return rates.export_rate
        return self._nem3_export_price(when)

    # ------------------------------------------------------------------ nem3

    def _setup_nbt(self, options: dict) -> None:
        o = dict(options)
        table = getattr(self._engine, "export_table", None)
        for key in ("prices_by_year", "acc_plus_adder"):
            if o.get(key) is None and table is not None:
                o[key] = getattr(table, key, None)
        self._pto = _date(o.get("pto_date"))
        self._lock_in_years = int(o.get("lock_in_years") or NBT_LOCK_IN_YEARS)
        self._year_prices = _year_table(o.get("prices_by_year"))
        self._acc_plus_class = str(o.get("acc_plus_class") or ACC_PLUS_RESIDENTIAL).lower()
        self._vintage = o.get("vintage")
        self._vintage_year = _num(o.get("vintage_year"))
        if self._vintage_year is not None:
            self._vintage_year = int(self._vintage_year)
        self._price_vintages = {int(y) for y in o.get("price_vintages") or ()}
        if self._vintage_year is not None:
            self._price_vintages.add(self._vintage_year)
        rate = _num(o.get("acc_plus_per_kwh"))
        self._acc_plus_known = True
        if rate is None:
            if self._acc_plus_class == ACC_PLUS_NONE:
                rate = 0.0
            else:
                rate = self._acc_plus_lookup(o)
                if rate is None:
                    rate, self._acc_plus_known = 0.0, False
        self._acc_plus_rate = rate
        self._arecr = _num(o.get("arecr"))
        self._nsc_rate = _num(o.get("nsc_rate"))
        self._nsc_opt_in = bool(o.get("nsc_opt_in", False))

    def _acc_plus_lookup(self, o: dict) -> float | None:
        """ACC Plus rate for the PTO year, else this table's own vintage rate."""
        cls = self._acc_plus_class
        by_vintage = o.get("acc_plus_by_vintage") or {}
        if self._pto is not None and by_vintage:
            years = sorted(int(y) for y in by_vintage)
            year = self._pto.year
            year = min(year, years[-1])  # the last entry holds for every later year
            row = by_vintage.get(year) or by_vintage.get(str(year))
            if row is not None:
                return _num(row.get(cls))
        if self._pto is None or self._vintage_year in (None, self._pto.year):
            return _num((o.get("acc_plus_adder") or {}).get(cls))
        return None

    @property
    def lock_in_end(self) -> date | None:
        """First day after the NEM 3.0 lock-in, if the PTO date is known."""
        return _add_years(self._pto, self._lock_in_years) if self._pto else None

    def _metering_local(self, when: datetime) -> datetime:
        lag = getattr(self._engine, "metering_lag", None) or timedelta(0)
        # subtract in UTC so the repeated hour at DST fall-back stays in order
        return (self._local(when).astimezone(UTC) - lag).astimezone(self._tz)

    def acc_plus_rate_at(self, when: datetime) -> float:
        """ACC Plus $/kWh for an export metered at `when` (0 after lock-in)."""
        if self.mode != NEM3:
            return 0.0
        end = self.lock_in_end
        if end is not None and self._metering_local(when).date() >= end:
            return 0.0
        return self._acc_plus_rate

    def _price_year(self, year: int) -> int:
        years = sorted(self._year_prices)
        if year in self._year_prices:
            return year
        return years[0] if year < years[0] else years[-1]

    def _nem3_export_price(self, when: datetime) -> float | None:
        local = self._metering_local(when)
        if not self._year_prices:
            try:
                return _num(self._engine.export_price(local))
            except (LookupError, ValueError, TypeError):
                return None
        try:
            if hasattr(self._engine, "day_type"):
                day_type = self._engine.day_type(local.date())[0]
            else:
                day_type = self._engine.period_at(local).day_type
        except (LookupError, ValueError, TypeError, AttributeError):
            return None
        kind = "weekday" if day_type == "weekday" else "weekend"
        try:
            prices = self._year_prices[self._price_year(local.year)]
            return _num(prices[local.month][kind][local.hour])
        except (KeyError, IndexError):
            return None

    def _relevant_start(self) -> date | None:
        """Start of the current 12-month relevant period.

        The first one starts at the first cycle start on or after PTO. When the
        ledger starts years later, it moves forward to the latest anniversary
        on or before the current cycle start.
        """
        if self._rp_start is None and self._pto is not None:
            start = cycle_start_for(self._pto, self._cycle_day)
            if start < self._pto:
                start = _next_month(start)
            if self._cycle_start is not None:
                while _add_years(start, 1) <= self._cycle_start:
                    start = _add_years(start, 1)
            self._rp_start = start
        return self._rp_start

    def _nem3_settle(self, days: int) -> dict[str, float]:
        """Apply carried credits to the cycle. Pure: nothing is stored."""
        energy = sum(b["import_charge"] for b in self._buckets.values())
        eec = sum(b["export_credit"] for b in self._buckets.values())
        eec_in = self._nbt["export_credit_carry"]
        eec_avail = eec + eec_in
        eec_used = min(energy, eec_avail)
        energy_due = energy - eec_used

        base = days * (_num(self._tariff.daily_charge) or 0.0)
        adders = self._cycle_adder_total
        subtotal = energy_due + self._cycle_nbc + adders + base

        acc_in = self._nbt["acc_plus_carry"]
        acc_avail = self._cycle_acc_plus + acc_in
        acc_used = min(max(subtotal, 0.0), acc_avail)
        after_acc = subtotal - acc_used

        acct_in = self._nbt["account_credit"]
        acct_used = min(max(after_acc, 0.0), acct_in)
        due = after_acc - acct_used
        # Energy charges count as paid for the true-up only in the share of the
        # bill that ACC Plus and account credit did not cover.
        energy_paid = energy_due * due / subtotal if subtotal > 0 else 0.0
        return {
            "days": days,
            "import_kwh": sum(b["import_kwh"] for b in self._buckets.values()),
            "export_kwh": sum(b["export_kwh"] for b in self._buckets.values()),
            "energy_charges": energy,
            "export_credit": eec,
            "export_credit_carried_in": eec_in,
            "export_credit_applied": eec_used,
            "export_credit_carried_forward": eec_avail - eec_used,
            "energy_due": energy_due,
            "base": base,
            "nbc": self._cycle_nbc,
            "adders": adders,
            "subtotal": subtotal,
            "acc_plus": self._cycle_acc_plus,
            "acc_plus_carried_in": acc_in,
            "acc_plus_applied": acc_used,
            "acc_plus_carried_forward": acc_avail - acc_used,
            "account_credit_carried_in": acct_in,
            "account_credit_applied": acct_used,
            "account_credit_carried_forward": acct_in - acct_used,
            "due": due,
            "energy_paid": energy_paid,
        }

    def _nem3_close_cycle(self, start: date, end: date) -> None:
        """Book the ending cycle [start, end) and carry its credits forward."""
        s = self._nem3_settle((end - start).days)
        n = self._nbt
        n["export_credit_carry"] = _r(s["export_credit_carried_forward"])
        n["acc_plus_carry"] = _r(s["acc_plus_carried_forward"])
        n["account_credit"] = _r(s["account_credit_carried_forward"])
        rp_start = self._relevant_start()
        if rp_start is None or end > rp_start:
            # a cycle that ends before the first relevant period is not part of it
            n["rp_import_kwh"] = _r(n["rp_import_kwh"] + s["import_kwh"])
            n["rp_export_kwh"] = _r(n["rp_export_kwh"] + s["export_kwh"])
            n["rp_energy_charges"] = _r(n["rp_energy_charges"] + s["energy_charges"])
            n["rp_energy_paid"] = _r(n["rp_energy_paid"] + s["energy_paid"])
        self._maybe_true_up(end)

    def _maybe_true_up(self, new_cycle_start: date) -> None:
        """Annual settlement once the new cycle starts on or after the anniversary."""
        start = self._relevant_start()
        if start is None:
            return
        anniversary = _add_years(start, 1)
        if new_cycle_start < anniversary:
            return
        n = self._nbt
        surplus = max(n["rp_export_kwh"] - n["rp_import_kwh"], 0.0)
        adjustment = surplus * (self._arecr or 0.0)
        left = max(n["export_credit_carry"] - adjustment, 0.0)
        refund = min(left, n["rp_energy_paid"])
        forfeited = left - refund
        nsc = surplus * (self._nsc_rate or 0.0) if self._nsc_opt_in else 0.0
        self._last_true_up = {
            "relevant_period_start": start.isoformat(),
            "relevant_period_end": anniversary.isoformat(),
            "import_kwh": round(n["rp_import_kwh"], 3),
            "export_kwh": round(n["rp_export_kwh"], 3),
            "surplus_kwh": round(surplus, 3),
            "export_credit_left": round(n["export_credit_carry"], 2),
            "export_credit_adjustment": round(adjustment, 2),
            "energy_charges_refunded": round(refund, 2),
            "export_credit_forfeited": round(forfeited, 2),
            "net_surplus_compensation": round(nsc, 2),
        }
        n["account_credit"] = _r(n["account_credit"] + refund + nsc)
        for field in (
            "export_credit_carry",
            "rp_import_kwh",
            "rp_export_kwh",
            "rp_energy_charges",
            "rp_energy_paid",
        ):
            n[field] = 0.0
        # Skip whole years missed while nothing was running.
        while _add_years(anniversary, 1) <= new_cycle_start:
            anniversary = _add_years(anniversary, 1)
        self._rp_start = anniversary

    def _nem3_beta_note(self, when: datetime) -> str:
        notes = [
            "NEM 3.0 billing is beta and has not been checked against a real bill.",
            (
                "Import and export are priced separately with no netting; NBCs and every "
                "per-kWh adder are charged on all imported kWh."
            ),
            (
                "Assumes bundled service: a CCA or Direct Access customer gets only the "
                "delivery part of the export price from the utility."
            ),
        ]
        if self._pto is None:
            notes.append(
                "No PTO date set: ACC Plus is assumed to be within its lock-in, and export "
                "credit carries forward with no annual true-up or forfeit."
            )
        else:
            notes.append(
                "Annual true-up assumes the relevant period starts at the first cycle start "
                "on or after the PTO date. Energy charges count as paid back only for the "
                "share of each bill not covered by ACC Plus or account credit."
            )
            if self._vintage_year is not None and self._pto.year not in self._price_vintages:
                label = self._vintage or str(self._vintage_year)
                notes.append(
                    f"Export prices come from the {label} schedule, but a {self._pto.year} PTO "
                    "has its own schedule: export credit may be off."
                )
            if self._arecr is None:
                notes.append(
                    "Average Retail Export Compensation Rate not set: the true-up takes no "
                    "adjustment for net surplus kWh."
                )
            if self._nsc_opt_in and self._nsc_rate is None:
                notes.append("Net surplus compensation rate not set: counted as $0.")
        if self.mode == NEM3 and not self._acc_plus_known:
            notes.append("No ACC Plus adder found for this vintage: counted as $0.")
        if self._year_prices:
            year = self._metering_local(when).year
            used = self._price_year(year)
            if used != year:
                notes.append(f"No export prices for {year} in the table: using {used} prices.")
        elif not getattr(getattr(self._engine, "export_table", None), "by_year", None):
            notes.append("Export prices use one table for every calendar year.")
        return " ".join(notes)

    # ------------------------------------------------------------------ hooks

    def on_energy(
        self,
        when: datetime,
        imported_total: float | None,
        exported_total: float | None,
        produced_total: float | None,
    ) -> None:
        """Price one meter update. Pass None for a reading that is unavailable."""
        self.maybe_reset_cycle(when)
        imp = _num(imported_total)
        exp = _num(exported_total)
        prod = _num(produced_total)

        self._latest_import = imp
        self._latest_export = exp
        known = imp is not None or exp is not None
        if self._tracking_start is None and self._learn_tracking_start and known:
            self._tracking_start = self._local(when).date()
        if imp is not None and exp is not None:
            if self._interval_import is None:
                self._interval_import = imp
            if self._interval_export is None:
                self._interval_export = exp

        rates = self._rates_at(when)
        export_rate = self._export_rate(when, rates) if rates else None
        if rates is None or export_rate is None:
            # No price: keep the old readings so the step is priced later.
            return

        di = _step(imp, self._last_import, STEP_GLITCH_KWH)
        de = _step(exp, self._last_export, STEP_GLITCH_KWH)
        dp = _step(prod, self._last_production, STEP_GLITCH_KWH)
        if imp is not None:
            self._last_import = imp
        if exp is not None:
            self._last_export = exp
        if prod is not None and prod > 0:
            self._last_production = prod

        nem3 = self.mode == NEM3
        acc_rate = self.acc_plus_rate_at(when) if nem3 else 0.0
        import_charge = di * rates.energy_rate
        nbc = di * rates.nbc if nem3 else 0.0
        export_credit = de * export_rate
        acc_plus = de * acc_rate
        import_adders = {k: di * v for k, v in rates.import_adders.items()}
        # Produced kWh at the export value, plus self-used kWh topped up to the
        # full import price. For NEM 2.0 this is
        # dProd x energy rate + (dProd - dExp) x (NBC + adders).
        export_value = export_rate + acc_rate
        extra = (rates.energy_rate - export_value) + rates.nbc + rates.adders_total
        savings = dp * export_value + (dp - de) * extra

        self._import_energy_charge = _r(self._import_energy_charge + import_charge)
        self._export_credit = _r(self._export_credit + export_credit)
        self._savings = _r(self._savings + savings)
        adders_sum = sum(import_adders.values())
        for key, amount in import_adders.items():
            self._adders[key] = _r(self._adders.get(key, 0.0) + amount)
            self._cycle_adders[key] = _r(self._cycle_adders.get(key, 0.0) + amount)
        if import_adders:
            self._adder_total = _r(self._adder_total + adders_sum)
            self._cycle_adder_total = _r(self._cycle_adder_total + adders_sum)
        if nem3:
            self._nbc = _r(self._nbc + nbc)
            self._cycle_nbc = _r(self._cycle_nbc + nbc)
            self._acc_plus = _r(self._acc_plus + acc_plus)
            self._cycle_acc_plus = _r(self._cycle_acc_plus + acc_plus)

        bucket = self._buckets.setdefault(rates.key, _empty_bucket(rates.season, rates.period))
        bucket["import_kwh"] += di
        bucket["export_kwh"] += de
        bucket["import_charge"] = _r(bucket["import_charge"] + import_charge)
        bucket["export_credit"] = _r(bucket["export_credit"] + export_credit)

        today = self._today_bucket(when)
        today["import_energy_charge"] = _r(today["import_energy_charge"] + import_charge)
        today["export_credit"] = _r(today["export_credit"] + export_credit)
        today["adders"] = _r(today["adders"] + adders_sum)
        today["savings"] = _r(today["savings"] + savings)
        if nem3:
            today["nbc"] = _r(today["nbc"] + nbc)
            today["acc_plus"] = _r(today["acc_plus"] + acc_plus)
        today["net_cost"] = _r(
            today["net_cost"] + import_charge - export_credit + adders_sum + nbc - acc_plus
        )

    def close_interval(self, when: datetime) -> None:
        """Close the metering interval since the last close (hourly, HH:00:30).

        Charges NBC and net_interval adders on max(0, import - export) of the
        span. A reading that is unavailable leaves the interval open, so the
        next close nets the longer span as one interval. Under NEM 3.0 nothing
        is netted, so this only keeps the interval bookkeeping.
        """
        self.maybe_reset_cycle(when)
        imp, exp = self._latest_import, self._latest_export
        if imp is None or exp is None:
            return
        if self._interval_import is None or self._interval_export is None:
            self._interval_import, self._interval_export = imp, exp
            return

        di = imp - self._interval_import
        de = exp - self._interval_export
        self._interval_import, self._interval_export = imp, exp
        self._last_interval_net_kwh = round(di - de, 3)
        self._last_interval_end = when.isoformat()
        if self.mode == NEM3:
            return
        if not (0 <= di < INTERVAL_GLITCH_KWH and 0 <= de < INTERVAL_GLITCH_KWH):
            return

        net = max(di - de, 0.0)
        rates = self._any_rates()
        if rates is None:
            return
        nbc = net * rates.nbc
        self._nbc = _r(self._nbc + nbc)
        self._cycle_nbc = _r(self._cycle_nbc + nbc)
        for key, price in rates.interval_adders.items():
            amount = net * price
            self._adders[key] = _r(self._adders.get(key, 0.0) + amount)
            self._cycle_adders[key] = _r(self._cycle_adders.get(key, 0.0) + amount)
        adders_sum = net * _r(sum(rates.interval_adders.values()))
        if rates.interval_adders:
            self._adder_total = _r(self._adder_total + adders_sum)
            self._cycle_adder_total = _r(self._cycle_adder_total + adders_sum)

        today = self._today_bucket(when)
        today["nbc"] = _r(today["nbc"] + nbc)
        today["adders"] = _r(today["adders"] + adders_sum)
        today["net_cost"] = _r(today["net_cost"] + nbc + adders_sum)

    def _any_rates(self) -> Rates | None:
        """NBC and adders do not depend on the TOU period: take the first one."""
        for season, period in self.period_keys():
            rates = self.rates_for(season, period)
            if rates is not None:
                return rates
        return None

    # ------------------------------------------------------------------ cycle

    @property
    def cycle_day(self) -> int:
        return self._cycle_day

    @property
    def cycle_start(self) -> date | None:
        return self._cycle_start

    def set_cycle_day(self, cycle_day: int, when: datetime) -> None:
        """Change the cycle day. The current cycle is relabeled, not wiped."""
        self._cycle_day = clamp_cycle_day(cycle_day)
        self._cycle_start = self._due_cycle_start(when)
        # the relevant period follows the cycle starts: derive it again
        self._rp_start = None
        self._relevant_start()

    def _due_cycle_start(self, when: datetime) -> date:
        return cycle_start_for((self._local(when) - CYCLE_RESET_DELAY).date(), self._cycle_day)

    def maybe_reset_cycle(self, when: datetime) -> bool:
        """Start a new cycle once 00:00:45 on the cycle day has passed."""
        due = self._due_cycle_start(when)
        if self._cycle_start is None:
            self._cycle_start = due
            self._relevant_start()
            return False
        if due <= self._cycle_start:
            return False
        if self.mode == NEM3:
            self._nem3_close_cycle(self._cycle_start, due)
        self._cycle_start = due
        self._buckets = {}
        self._cycle_nbc = 0.0
        self._cycle_acc_plus = 0.0
        self._cycle_adders = {}
        self._cycle_adder_total = 0.0
        return True

    def period_keys(self) -> list[tuple[str, str]]:
        """(season, period) pairs in tariff order, then any extra bucket keys."""
        keys: list[tuple[str, str]] = []
        components = self._tariff.components
        for season in self._tariff.seasons:
            prices = components[0].per_kwh.get(season.key, {}) if components else {}
            keys.extend((season.key, period) for period in prices)
        for bucket in self._buckets.values():
            pair = (bucket["season"], bucket["period"])
            if pair not in keys:
                keys.append(pair)
        return keys

    @property
    def tracking_start(self) -> date | None:
        return self._tracking_start

    def _tracking_attrs(self, start: date) -> dict[str, Any]:
        """When tracking began, and how many days of this cycle came before it.

        The daily charge counts every day of the cycle, like the real bill,
        but energy before tracking began is not known.
        """
        ts = self._tracking_start
        return {
            "tracking_start": ts.isoformat() if ts else None,
            "days_before_tracking": max((ts - start).days, 0) if ts else 0,
        }

    def bill_estimate(self, when: datetime) -> dict:
        """Bill so far for the current cycle: {"state": float, "attributes": {...}}."""
        today = self._local(when).date()
        start = self._cycle_start or cycle_start_for(today, self._cycle_day)
        days = (today - start).days + 1
        daily = _num(self._tariff.daily_charge) or 0.0

        rows = []
        for season, period in self.period_keys():
            b = self._buckets.get(f"{season}_{period}") or _empty_bucket(season, period)
            i, e = b["import_kwh"], b["export_kwh"]
            rates = self.rates_for(season, period)
            rate = rates.energy_rate if rates else None
            if self.mode in (NEM1, NEM2):
                amount = round((i - e) * rate, 4) if rate is not None else 0.0
            else:
                amount = round(b["import_charge"] - b["export_credit"], 4)
            row = {
                "season": season,
                "period": period,
                "import_kwh": round(i, 3),
                "export_kwh": round(e, 3),
                "net_kwh": round(i - e, 3),
                "energy_rate": rate,
                "amount": amount,
            }
            if self.mode == NEM3:
                row["import_charge"] = round(b["import_charge"], 4)
                row["export_credit"] = round(b["export_credit"], 4)
            rows.append(row)

        if self.mode == NEM3:
            return self._nem3_bill(when, start, days, rows)

        energy = sum(r["amount"] for r in rows)
        nbcs = self._cycle_nbc
        adders = self._cycle_adder_total
        base = days * daily
        attributes = {
            "cycle_start": start.isoformat(),
            "days_in_cycle": days,
            "base_charges": round(base, 2),
            "nbc_charges": round(nbcs, 2),
            "adder_charges": round(adders, 2),
            "adders": {k: round(v, 2) for k, v in self._cycle_adders.items()},
            "nem_energy_balance": round(energy, 2),
            "energy_charges": round(sum(r["amount"] for r in rows if r["amount"] > 0), 2),
            "energy_credits": round(sum(r["amount"] for r in rows if r["amount"] < 0), 2),
            # Monthly Billing Option: base, NBC and adders are due every month,
            # plus the energy balance if it is a charge. A credit carries forward.
            "due_this_cycle_mbo": round(base + nbcs + adders + max(energy, 0), 2),
            "credit_carried_forward": round(min(energy, 0), 2),
            "due_monthly_minimum": round(base + nbcs + adders, 2),
            "import_kwh": round(sum(r["import_kwh"] for r in rows), 2),
            "export_kwh": round(sum(r["export_kwh"] for r in rows), 2),
            "periods": rows,
            "nem": self.mode,
            "note": _NOTES[self.mode],
            **self._tracking_attrs(start),
        }
        return {
            "state": round(energy + nbcs + adders + base, 2),
            "attributes": attributes,
        }

    def _nem3_bill(self, when: datetime, start: date, days: int, rows: list) -> dict:
        s = self._nem3_settle(days)
        rp_start = self._relevant_start()
        attributes = {
            "cycle_start": start.isoformat(),
            "days_in_cycle": days,
            "base_charges": round(s["base"], 2),
            "nbc_charges": round(s["nbc"], 2),
            "adder_charges": round(s["adders"], 2),
            "adders": {k: round(v, 2) for k, v in self._cycle_adders.items()},
            "nem_energy_balance": round(s["energy_charges"] - s["export_credit"], 2),
            "energy_charges": round(s["energy_charges"], 2),
            "energy_credits": round(-s["export_credit"], 2),
            "export_credit_this_cycle": round(s["export_credit"], 2),
            "export_credit_carried_in": round(s["export_credit_carried_in"], 2),
            "export_credit_applied": round(s["export_credit_applied"], 2),
            "energy_due": round(s["energy_due"], 2),
            "acc_plus_per_kwh": self.acc_plus_rate_at(when),
            "acc_plus_this_cycle": round(s["acc_plus"], 2),
            "acc_plus_carried_in": round(s["acc_plus_carried_in"], 2),
            "acc_plus_applied": round(s["acc_plus_applied"], 2),
            "acc_plus_carried_forward": round(s["acc_plus_carried_forward"], 2),
            "account_credit_applied": round(s["account_credit_applied"], 2),
            "account_credit_carried_forward": round(s["account_credit_carried_forward"], 2),
            "due_before_credits": round(s["subtotal"], 2),
            "due_this_cycle": round(s["due"], 2),
            # Same keys as NEM 2.0 so cards can share one layout.
            "due_this_cycle_mbo": round(s["due"], 2),
            "credit_carried_forward": round(-s["export_credit_carried_forward"], 2),
            "due_monthly_minimum": round(s["base"] + s["nbc"] + s["adders"], 2),
            "import_kwh": round(sum(r["import_kwh"] for r in rows), 2),
            "export_kwh": round(sum(r["export_kwh"] for r in rows), 2),
            "pto_date": self._pto.isoformat() if self._pto else None,
            "lock_in_end": self.lock_in_end.isoformat() if self.lock_in_end else None,
            "relevant_period_start": rp_start.isoformat() if rp_start else None,
            "true_up_date": _add_years(rp_start, 1).isoformat() if rp_start else None,
            "relevant_period_import_kwh": round(self._nbt["rp_import_kwh"] + s["import_kwh"], 2),
            "relevant_period_export_kwh": round(self._nbt["rp_export_kwh"] + s["export_kwh"], 2),
            "last_true_up": dict(self._last_true_up) if self._last_true_up else None,
            "periods": rows,
            "nem": self.mode,
            "note": _NOTES[self.mode],
            "beta_note": self._nem3_beta_note(when),
            **self._tracking_attrs(start),
        }
        return {"state": round(s["due"], 2), "attributes": attributes}

    # ------------------------------------------------------------------ daily

    def _today_bucket(self, when: datetime) -> dict[str, Any]:
        day = self._local(when).date().isoformat()
        if self._today.get("date") != day:
            self._today = _empty_today(self._local(when).date())
        return self._today

    def today(self, when: datetime) -> dict[str, float]:
        """Money since local midnight (no daily charge)."""
        day = self._local(when).date().isoformat()
        src = self._today if self._today.get("date") == day else _empty_today(None)
        return {k: v for k, v in src.items() if k != "date"}

    def cost_today(self, when: datetime) -> float:
        """Net cost since midnight plus the whole day's daily charge."""
        daily = _num(self._tariff.daily_charge) or 0.0
        return round(self.today(when)["net_cost"] + daily, 2)

    # ------------------------------------------------------------------ totals

    @property
    def totals(self) -> dict[str, float]:
        """Lifetime money. Daily charge not included.

        NEM 3.0 adds acc_plus_credit. Its net_cost counts every export credit
        earned, including any later forfeited at true-up.
        """
        adders = self._adder_total
        imp = self._import_energy_charge
        out = {
            "import_energy_charge": imp,
            "export_credit": self._export_credit,
            "nbc": self._nbc,
            "adders": adders,
            "savings": self._savings,
            "import_cost": _r(imp + self._nbc + adders),
            "net_cost": _r(imp - self._export_credit + self._nbc + adders - self._acc_plus),
        }
        if self.mode == NEM3:
            out["acc_plus_credit"] = self._acc_plus
        return out

    @property
    def adder_totals(self) -> dict[str, float]:
        return dict(self._adders)

    @property
    def interval(self) -> dict[str, Any]:
        """Bookkeeping of the hourly close, for sensor attributes."""
        return {
            "last_import": self._interval_import,
            "last_export": self._interval_export,
            "last_interval_net_kwh": self._last_interval_net_kwh,
            "last_interval_end": self._last_interval_end,
        }


_NOTES = {
    NEM2: (
        "Estimate for this cycle. The daily charge, NBCs and import-only adders are billed every "
        "month and cannot be offset by solar credits. A negative NEM energy balance is a credit "
        "that offsets energy charges in later months of the 12-month relevant period; earlier "
        "months' credit is not known here. Unused credit is zeroed at true-up; a net kWh surplus "
        "for the year is paid at the net surplus compensation rate."
    ),
    NEM1: (
        "Estimate for this cycle. Exports are credited at the full energy rate of their period. "
        "The daily charge and import-only adders are billed every month. A negative energy "
        "balance carries forward to later months until true-up."
    ),
    NEM3: (
        "Estimate for this cycle. Every imported kWh pays the energy rate of its period plus "
        "NBCs and adders; every exported kWh earns the hourly export price. Export credit "
        "offsets energy charges only, in any period, and what is left carries forward. The ACC "
        "Plus adder then offsets anything left, including the daily charge and NBCs, and "
        "carries forward with no end date. At true-up leftover export credit pays back energy "
        "charges from earlier in the year and the rest is forfeited."
    ),
    NEM_NONE: (
        "Estimate for this cycle. No net metering: imports pay the full price and exports earn "
        "nothing."
    ),
}
