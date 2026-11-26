"""Today / 7 day / 30 day / month / year totals from recorder statistics.

Same numbers the Energy dashboard uses. Each value is the change of the
statistic's sum since the window start, read through the recorder's public
statistics API (long-term rows plus the 5-minute rows for the newest part).
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timedelta, tzinfo
from typing import Any

from homeassistant.components.recorder import get_instance
from homeassistant.components.recorder.statistics import statistic_during_period
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from .const import TOTALS_WINDOWS


def _midnight(day: datetime, tz: tzinfo) -> datetime:
    return datetime.combine(day.date(), datetime.min.time(), tzinfo=tz)


def window_starts(now: datetime, tz: tzinfo | None = None) -> dict[str, datetime]:
    """Start of each totals window, in UTC.

    Calendar windows (today, month, year) start at midnight in `tz`, which
    should be the tariff's zone so "today" matches the ledger's cost today.
    Defaults to HA's time zone.
    """
    zone = tz or dt_util.get_default_time_zone()
    local = dt_util.as_utc(now).astimezone(zone)
    return {
        "today": dt_util.as_utc(_midnight(local, zone)),
        "d7": dt_util.as_utc(now - timedelta(days=7)),
        "d30": dt_util.as_utc(now - timedelta(days=30)),
        "month": dt_util.as_utc(_midnight(local.replace(day=1), zone)),
        "year": dt_util.as_utc(_midnight(local.replace(month=1, day=1), zone)),
    }


def empty_totals(metrics: Mapping[str, Any]) -> dict[str, float]:
    return {f"{m}_{w}": 0.0 for m in metrics for w in TOTALS_WINDOWS}


def _query(
    hass: HomeAssistant,
    stat_ids: Mapping[str, str | None],
    now: datetime,
    tz: tzinfo | None = None,
) -> dict[str, float]:
    starts = window_starts(now, tz)
    out: dict[str, float] = {}
    for metric, stat_id in stat_ids.items():
        for window in TOTALS_WINDOWS:
            change = None
            if stat_id:
                result = statistic_during_period(
                    hass, starts[window], None, stat_id, {"change"}, None
                )
                change = result.get("change")
            # no statistics yet counts as 0
            out[f"{metric}_{window}"] = round(change, 4) if change is not None else 0.0
    return out


async def async_fetch_totals(
    hass: HomeAssistant,
    stat_ids: Mapping[str, str | None],
    now: datetime | None = None,
    tz: tzinfo | None = None,
) -> dict[str, float]:
    """{metric}_{window} for every metric. stat_ids maps metric -> statistic id."""
    when = now or dt_util.utcnow()
    return await get_instance(hass).async_add_executor_job(_query, hass, stat_ids, when, tz)


def self_sufficiency_today(totals: Mapping[str, float]) -> int | None:
    """(produced - exported) / used today, as 0-100. None before totals are loaded."""
    used = totals.get("used_today")
    if used is None:
        return None
    if used <= 0:
        return 0
    own = totals.get("produced_today", 0.0) - totals.get("exported_today", 0.0)
    return round(min(max(own / used * 100, 0.0), 100.0))
