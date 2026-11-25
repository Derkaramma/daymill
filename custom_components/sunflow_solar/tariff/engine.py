"""Time-of-use lookups and prices for a Tariff."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from .holidays import holidays_for_year
from .loader import export_table_for
from .model import NEM_MODES, ExportTable, Season, Tariff, TariffError

# How far ahead next_change looks. A flat tariff may only change at a season start.
_MAX_LOOKAHEAD_DAYS = 370


@dataclass(frozen=True)
class PeriodInfo:
    season: str
    period: str
    label: str
    day_type: str  # weekday, weekend or holiday
    holiday: str | None
    key: str  # f"{season}_{period}"


def _r5(x: float) -> float:
    return round(x, 5)


class TariffEngine:
    def __init__(
        self,
        tariff: Tariff,
        nem: str = "nem2",
        metering_lag: timedelta = timedelta(minutes=3),
        export_table: ExportTable | None = None,
    ) -> None:
        if nem not in NEM_MODES:
            raise TariffError(f"unknown NEM mode {nem!r}")
        self.tariff = tariff
        self.nem = nem
        self.metering_lag = metering_lag
        self.tz = ZoneInfo(tariff.timezone)
        self._holiday_cache: dict[int, dict[date, str]] = {}
        # seasons sorted by start for lookup; tariff order kept for tables
        self._seasons = sorted(tariff.seasons, key=lambda s: s.start)
        # every wall-clock time a period can start or end, plus midnight
        times = {time(0)}
        for s in tariff.seasons:
            for r in s.rules:
                for w in r.windows:
                    times.update((w.start, w.end))
        self._boundaries = sorted(times)
        self.export_table: ExportTable | None = None
        if nem == "nem3":
            # may read a file: build the engine in an executor
            self.export_table = export_table or export_table_for(tariff)

    # ---- time helpers ----

    def _local(self, when: datetime) -> datetime:
        if when.tzinfo is None:
            return when.replace(tzinfo=self.tz)
        return when.astimezone(self.tz)

    def _wall(self, d: date, t: time) -> datetime:
        # normalize through UTC so times in a DST gap land on a real instant
        return datetime.combine(d, t, tzinfo=self.tz).astimezone(UTC).astimezone(self.tz)

    def season_for(self, d: date) -> Season:
        md = (d.month, d.day)
        current = self._seasons[-1]  # wraps from the previous year
        for s in self._seasons:
            if s.start <= md:
                current = s
        return current

    def holidays(self, year: int) -> dict[date, str]:
        if year not in self._holiday_cache:
            self._holiday_cache[year] = holidays_for_year(
                self.tariff.holidays, year, self.tariff.holiday_sunday_shift
            )
        return self._holiday_cache[year]

    def holiday_dates(self, when: datetime) -> dict[str, str]:
        """{iso date: name} for this year and next."""
        y = self._local(when).year
        out = {d.isoformat(): n for yr in (y, y + 1) for d, n in self.holidays(yr).items()}
        return dict(sorted(out.items()))

    def day_type(self, d: date) -> tuple[str, str | None]:
        name = self.holidays(d.year).get(d)
        if name is not None:
            return "holiday", name
        return ("weekend" if d.weekday() >= 5 else "weekday"), None

    # ---- periods ----

    def _info(self, local: datetime) -> PeriodInfo:
        d = local.date()
        season = self.season_for(d)
        day_type, holiday = self.day_type(d)
        period = season.period_for(local.time().replace(tzinfo=None), day_type)
        return PeriodInfo(
            season=season.key,
            period=period,
            label=self.tariff.label(period),
            day_type=day_type,
            holiday=holiday,
            key=f"{season.key}_{period}",
        )

    def period_at(self, when: datetime) -> PeriodInfo:
        return self._info(self._local(when))

    def metering_period_at(self, when: datetime) -> PeriodInfo:
        """Period of the reading that arrives at `when` (it covers the minutes before)."""
        # subtract in UTC so the repeated hour at DST fall-back stays in order
        return self.period_at(self._local(when).astimezone(UTC) - self.metering_lag)

    def next_change(self, when: datetime) -> tuple[datetime, PeriodInfo] | None:
        """First moment after `when` where season or period changes."""
        local = self._local(when)
        current = self._info(local).key
        start = local.date()
        for i in range(_MAX_LOOKAHEAD_DAYS):
            d = start + timedelta(days=i)
            for t in self._boundaries:
                b = self._wall(d, t)
                if b <= local:
                    continue
                info = self._info(b)
                if info.key != current:
                    return b, info
                current = info.key
        return None

    # ---- prices ----

    def _season_periods(self) -> list[tuple[str, list[str]]]:
        # table rows follow the first component's order
        first = self.tariff.components[0].per_kwh
        return [(s.key, list(first.get(s.key, {}))) for s in self.tariff.seasons]

    def period_total(self, info: PeriodInfo) -> float:
        return _r5(sum(c.per_kwh[info.season][info.period] for c in self.tariff.components))

    def _netted(self) -> float:
        return sum(a.per_kwh for a in self.tariff.adders if a.basis == "netted")

    @property
    def interval_adders_per_kwh(self) -> float:
        """Adders billed on each interval's net import (never credited)."""
        return _r5(sum(a.per_kwh for a in self.tariff.adders if a.basis == "net_interval"))

    @property
    def import_adders_per_kwh(self) -> float:
        """Adders billed on gross import."""
        return _r5(sum(a.per_kwh for a in self.tariff.adders if a.basis == "import"))

    @property
    def nbc_per_kwh(self) -> float:
        return self.tariff.nbc.per_kwh if self.tariff.nbc else 0.0

    def import_price_for(self, info: PeriodInfo) -> float:
        adders = sum(a.per_kwh for a in self.tariff.adders)
        return _r5(
            sum(c.per_kwh[info.season][info.period] for c in self.tariff.components) + adders
        )

    def energy_rate(self, info: PeriodInfo) -> float:
        """Rate per netted kWh.

        NEM 2.0 and 3.0 take the NBCs out (they are billed per interval on net
        import). NEM 1.0 and no-NEM keep the full period total.
        """
        base = sum(c.per_kwh[info.season][info.period] for c in self.tariff.components)
        base += self._netted()
        if self.nem in ("nem2", "nem3"):
            base -= self.nbc_per_kwh
        return _r5(base)

    def import_price(self, when: datetime) -> float:
        return self.import_price_for(self.period_at(when))

    def export_price(self, when: datetime) -> float:
        if self.nem == "none":
            return 0.0
        if self.nem == "nem3":
            local = self._local(when)
            day_type, _ = self.day_type(local.date())
            return self.export_table.price(local.month, day_type, local.hour, local.year)
        return self.energy_rate(self.period_at(when))

    def tables(self) -> dict[str, dict[str, dict[str, float]]]:
        """{season: {period: $/kWh}} tables: one per component, then the derived ones."""
        out: dict[str, dict[str, dict[str, float]]] = {}
        rows = self._season_periods()
        for c in self.tariff.components:
            out[f"{c.key}_table"] = {s: {p: c.per_kwh[s][p] for p in ps} for s, ps in rows}
        all_adders = sum(a.per_kwh for a in self.tariff.adders)
        # same NEM rule as energy_rate(): NBCs come out only under NEM 2.0 and 3.0
        nbc = self.nbc_per_kwh if self.nem in ("nem2", "nem3") else 0.0
        netted = self._netted()
        total: dict[str, dict[str, float]] = {}
        rate: dict[str, dict[str, float]] = {}
        energy: dict[str, dict[str, float]] = {}
        for s, ps in rows:
            total[s], rate[s], energy[s] = {}, {}, {}
            for p in ps:
                base = sum(c.per_kwh[s][p] for c in self.tariff.components)
                total[s][p] = _r5(base)
                rate[s][p] = _r5(base + all_adders)
                energy[s][p] = _r5(base + netted - nbc)
        out["period_total_table"] = total
        out["rate_table"] = rate
        out["energy_rate_table"] = energy
        return out

    # ---- attribute helpers for the sensors ----

    def period_attributes(self, when: datetime) -> dict[str, Any]:
        """Current and metering period, next change and plan, for the TOU sensor."""
        info = self.period_at(when)
        meter = self.metering_period_at(when)
        nxt = self.next_change(when)
        t = self.tariff
        return {
            "season": info.season,
            "day_type": info.day_type,
            "holiday": info.holiday,
            "label": info.label,
            "tariff": info.key,
            "next_change": nxt[0].isoformat() if nxt else None,
            "next_period": nxt[1].period if nxt else None,
            "next_period_label": nxt[1].label if nxt else None,
            "next_season": nxt[1].season if nxt else None,
            "metering_season": meter.season,
            "metering_period": meter.period,
            "metering_tariff": meter.key,
            "plan": f"{t.utility} {t.plan}".strip(),
            "source": t.extras.get("period_source"),
        }

    def rate_attributes(self, when: datetime) -> dict[str, Any]:
        """Current price breakdown plus the season tables."""
        info = self.period_at(when)
        t = self.tariff
        attrs: dict[str, Any] = {
            "period": info.period,
            "label": info.label,
            "season": info.season,
        }
        for c in t.components:
            attrs[c.key] = c.per_kwh[info.season][info.period]
        attrs["period_total"] = self.period_total(info)
        for a in t.adders:
            attrs[a.key] = a.per_kwh
        attrs["interval_adders_per_kwh"] = self.interval_adders_per_kwh
        attrs["nbc_per_kwh"] = self.nbc_per_kwh
        attrs["nbc_components"] = dict(t.nbc.parts) if t.nbc else {}
        attrs.update(self.tables())
        attrs["daily_charge"] = t.daily_charge
        attrs["net_surplus_compensation_rate"] = t.nem.get("nem2", {}).get("nscr")
        attrs["effective_date"] = t.effective_date.isoformat()
        for key in (
            "climate_credit",
            "advice_letter",
            "decision",
            "plan_detail",
            "definitions",
            "citations",
            "unverified_items",
        ):
            if key in t.extras:
                attrs[key] = t.extras[key]
        return attrs
