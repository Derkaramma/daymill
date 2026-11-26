"""Totals from recorder statistics."""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from homeassistant.components.recorder.models import StatisticMeanType
from homeassistant.components.recorder.statistics import async_import_statistics
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.components.recorder.common import (
    async_wait_recording_done,
)

from custom_components.daymill.totals import (
    async_fetch_totals,
    self_sufficiency_today,
    window_starts,
)

from .test_init import setup_entry


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(recorder_mock, enable_custom_integrations):
    """Recorder first: the integration depends on it."""
    yield


def _import(hass: HomeAssistant, stat_id: str, start: datetime, sums: list[float]) -> None:
    metadata = {
        "has_sum": True,
        "mean_type": StatisticMeanType.NONE,
        "name": None,
        "source": "recorder",
        "statistic_id": stat_id,
        "unit_class": "energy",
        "unit_of_measurement": "kWh",
    }
    rows = [{"start": start + timedelta(hours=i), "state": s, "sum": s} for i, s in enumerate(sums)]
    async_import_statistics(hass, metadata, rows)


def test_window_starts() -> None:
    now = datetime(2026, 3, 18, 15, 30, tzinfo=dt_util.get_default_time_zone())
    starts = window_starts(now)
    local = {k: dt_util.as_local(v) for k, v in starts.items()}
    assert local["today"] == now.replace(hour=0, minute=0)
    assert local["month"] == now.replace(day=1, hour=0, minute=0)
    assert local["year"] == now.replace(month=1, day=1, hour=0, minute=0)
    assert starts["d7"] == dt_util.as_utc(now - timedelta(days=7))


def test_self_sufficiency_today() -> None:
    assert self_sufficiency_today({}) is None
    assert self_sufficiency_today({"used_today": 0.0}) == 0
    assert (
        self_sufficiency_today({"used_today": 20.0, "produced_today": 15.0, "exported_today": 5.0})
        == 50
    )
    assert (
        self_sufficiency_today({"used_today": 5.0, "produced_today": 30.0, "exported_today": 0.0})
        == 100
    )


async def test_fetch_totals(hass: HomeAssistant, freezer) -> None:
    freezer.move_to("2026-03-18 12:30:00-07:00")
    now = dt_util.utcnow()
    midnight = dt_util.as_utc(dt_util.start_of_local_day())
    # hourly rows from 2 days before midnight up to the last full hour
    first = midnight - timedelta(hours=48)
    hours = int((now - first).total_seconds() // 3600)
    _import(hass, "sensor.test_produced", first, [float(i) for i in range(hours)])
    await async_wait_recording_done(hass)

    totals = await async_fetch_totals(
        hass, {"produced": "sensor.test_produced", "used": None, "savings": "sensor.missing"}, now
    )
    # one kWh per hour: today has 12 full hours so far
    assert totals["produced_today"] == pytest.approx(12.0)
    assert totals["produced_d7"] == pytest.approx(hours - 1)
    assert totals["used_today"] == 0.0
    assert totals["savings_year"] == 0.0
    assert set(totals) == {
        f"{m}_{w}"
        for m in ("produced", "used", "savings")
        for w in ("today", "d7", "d30", "month", "year")
    }


async def test_totals_sensor(hass: HomeAssistant) -> None:
    entry = await setup_entry(hass)
    coordinator = entry.runtime_data
    await coordinator.async_refresh_totals()
    await hass.async_block_till_done()
    state = hass.states.get("sensor.daymill_totals")
    assert state.state == "0.0"
    for key in ("produced_today", "net_cost_month", "adders_year", "savings_d30"):
        assert key in state.attributes
    ids = coordinator.statistic_ids()
    assert ids["produced"] == "sensor.daymill_energy_produced"
    assert ids["nbc"] == "sensor.daymill_nbc_charges"
    assert hass.states.get("sensor.daymill_self_sufficiency_today").state == "0"


def test_window_starts_in_tariff_zone() -> None:
    tz = ZoneInfo("America/New_York")
    # 02:30 UTC on Mar 18 is still Mar 17 in New York
    now = datetime(2026, 3, 18, 2, 30, tzinfo=dt_util.UTC)
    starts = window_starts(now, tz)
    assert starts["today"] == datetime(2026, 3, 17, tzinfo=tz).astimezone(dt_util.UTC)
    assert starts["month"] == datetime(2026, 3, 1, tzinfo=tz).astimezone(dt_util.UTC)
    assert starts["year"] == datetime(2026, 1, 1, tzinfo=tz).astimezone(dt_util.UTC)
