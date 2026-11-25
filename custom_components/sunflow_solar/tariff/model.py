"""Tariff data model. Plain frozen dataclasses, no Home Assistant imports."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, time
from typing import Any

DAY_TYPES = frozenset({"weekday", "weekend", "holiday"})
ADDER_BASES = frozenset({"net_interval", "import", "netted"})
NEM_MODES = ("none", "nem1", "nem2", "nem3")


class TariffError(ValueError):
    """Bad tariff data or a missing tariff file."""


@dataclass(frozen=True)
class Window:
    """Time-of-day window. End is exclusive, 00:00 means midnight, start > end wraps."""

    start: time
    end: time

    def contains(self, t: time) -> bool:
        if self.start == self.end:
            # 00:00-00:00 (or any equal pair) covers the whole day
            return True
        if self.end == time(0) or self.start > self.end:
            return t >= self.start or (self.end != time(0) and t < self.end)
        return self.start <= t < self.end


@dataclass(frozen=True)
class PeriodRule:
    period: str
    windows: tuple[Window, ...]
    day_types: frozenset[str]

    def matches(self, t: time, day_type: str) -> bool:
        return day_type in self.day_types and any(w.contains(t) for w in self.windows)


@dataclass(frozen=True)
class Season:
    """A season starts on (month, day) and runs until the next season's start."""

    key: str
    start: tuple[int, int]
    rules: tuple[PeriodRule, ...]
    default_period: str

    def period_for(self, t: time, day_type: str) -> str:
        for rule in self.rules:
            if rule.matches(t, day_type):
                return rule.period
        return self.default_period

    @property
    def periods(self) -> tuple[str, ...]:
        """Every period this season can produce, rule order first."""
        out: list[str] = []
        for p in [r.period for r in self.rules] + [self.default_period]:
            if p not in out:
                out.append(p)
        return tuple(out)


@dataclass(frozen=True)
class HolidayRule:
    """Fixed date (month + day) or nth weekday of a month (nth -1 = last)."""

    name: str
    month: int
    day: int | None = None
    weekday: int | None = None  # Monday = 0
    nth: int | None = None

    @property
    def fixed(self) -> bool:
        return self.day is not None


@dataclass(frozen=True)
class Component:
    """Per-kWh rate part (delivery, generation...). per_kwh is season -> period -> $/kWh."""

    key: str
    label: str
    per_kwh: dict[str, dict[str, float]]


@dataclass(frozen=True)
class Adder:
    """Flat per-kWh charge on top of the period rate.

    basis:
      net_interval  charged on each interval's max(0, import - export), never credited
      import        charged on gross import, never credited
      netted        part of the energy rate, credited on export
    """

    key: str
    label: str
    per_kwh: float
    basis: str


@dataclass(frozen=True)
class NBC:
    """Non-bypassable charges, billed on each interval's net import."""

    per_kwh: float
    parts: dict[str, float] = field(default_factory=dict)
    interval_minutes: int = 60


@dataclass(frozen=True)
class ExportTable:
    """Hourly export prices: month (1-12) -> day type ("weekday"/"weekend") -> 24 prices."""

    utility: str
    name: str
    effective_date: date | None
    prices: dict[int, dict[str, tuple[float, ...]]]
    source_urls: tuple[str, ...] = ()
    notes: str = ""
    # calendar year -> same shape as prices; empty when one table covers every year
    by_year: dict[int, dict[int, dict[str, tuple[float, ...]]]] = field(default_factory=dict)

    def price(self, month: int, day_type: str, hour: int, year: int | None = None) -> float:
        # holidays are priced like weekends
        kind = "weekday" if day_type == "weekday" else "weekend"
        table = self.prices
        if year is not None and self.by_year:
            years = sorted(self.by_year)
            # past the table's last year: keep its last prices
            use = year if year in self.by_year else (years[0] if year < years[0] else years[-1])
            table = self.by_year[use]
        return table[month][kind][hour]


@dataclass(frozen=True)
class Tariff:
    id: str
    name: str
    utility: str
    plan: str
    timezone: str
    currency: str
    effective_date: date
    seasons: tuple[Season, ...]
    period_labels: dict[str, str]
    holidays: tuple[HolidayRule, ...]
    holiday_sunday_shift: bool
    components: tuple[Component, ...]
    adders: tuple[Adder, ...]
    nbc: NBC | None
    daily_charge: float
    nem: dict[str, Any]
    extras: dict[str, Any]

    def label(self, period: str) -> str:
        return self.period_labels.get(period, period)

    def season(self, key: str) -> Season:
        for s in self.seasons:
            if s.key == key:
                return s
        raise KeyError(key)
