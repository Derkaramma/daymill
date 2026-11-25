"""Turn holiday rules into dates for a given year."""

from __future__ import annotations

import calendar
from collections.abc import Iterable
from datetime import date, timedelta

from .model import HolidayRule


def rule_date(rule: HolidayRule, year: int, sunday_shift: bool = False) -> date:
    """Date a rule lands on in `year`.

    Fixed dates on a Sunday move to Monday when sunday_shift is set.
    Saturday dates never move.
    """
    if rule.fixed:
        d = date(year, rule.month, rule.day)
        if sunday_shift and d.weekday() == 6:
            d += timedelta(days=1)
        return d
    if rule.nth is not None and rule.nth < 0:
        last = date(year, rule.month, calendar.monthrange(year, rule.month)[1])
        d = last - timedelta(days=(last.weekday() - rule.weekday) % 7)
        return d - timedelta(weeks=-rule.nth - 1)
    first = date(year, rule.month, 1)
    d = first + timedelta(days=(rule.weekday - first.weekday()) % 7)
    d += timedelta(weeks=(rule.nth or 1) - 1)
    if d.month != rule.month:
        raise ValueError(f"{rule.name}: no {rule.nth}th weekday in {year}-{rule.month:02d}")
    return d


def holidays_for_year(
    rules: Iterable[HolidayRule], year: int, sunday_shift: bool = False
) -> dict[date, str]:
    """{date: name} for one year, sorted by date."""
    out = {rule_date(r, year, sunday_shift): r.name for r in rules}
    return dict(sorted(out.items()))
