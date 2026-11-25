"""Panel health checks.

Pure functions: pass in panel readings, timestamps and the sun elevation and
get back a findings string. The coordinator runs this every minute.

Checks, in order:
- gateway offline: reported on its own, nothing else is checked
- only while the sun is above 10 degrees, for each panel on each roof face:
  - "stale": last report more than 2 hours old
  - "no output": the other panels on the same face average more than
    0.05 kW while this panel is under 0.005 kW (or not a number)

A panel with no timestamp at all is not called stale (the source may still be
loading); a dead panel is still caught by the no-output test.

The problem flag turns on once findings have been there for 30 minutes and
clears as soon as everything is OK again.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, NamedTuple

from .sources import to_number

OK = "OK"
GATEWAY_OFFLINE = "Gateway offline"

DEFAULT_MIN_ELEVATION = 10.0
DEFAULT_STALE_S = 7200
DEFAULT_SIBLING_MIN_KW = 0.05
DEFAULT_PANEL_MIN_KW = 0.005
DEFAULT_PERSIST_S = 1800
MAX_FINDINGS_LEN = 250


@dataclass(frozen=True)
class Panel:
    """One panel reading. power is in kW; any state value is accepted."""

    power: Any
    last_reported: datetime | None = None
    name: str | None = None


@dataclass(frozen=True)
class RoofFace:
    """A group of panels that should behave alike (same tilt and direction)."""

    label: str
    panels: Sequence[Panel] = field(default_factory=tuple)


class ProblemState(NamedTuple):
    """Result of update_problem()."""

    problem: bool
    problem_since: datetime | None
    findings: str


def sun_is_up(elevation: Any, min_elevation: float = DEFAULT_MIN_ELEVATION) -> bool:
    """True when the sun is high enough to expect output. Unknown = down."""
    num = to_number(elevation)
    return (num if num is not None else -90.0) > min_elevation


def panel_findings(
    faces: Sequence[RoofFace],
    now: datetime,
    *,
    stale_s: float = DEFAULT_STALE_S,
    sibling_min_kw: float = DEFAULT_SIBLING_MIN_KW,
    panel_min_kw: float = DEFAULT_PANEL_MIN_KW,
) -> list[str]:
    """Per-panel findings, without the sun or gateway checks."""
    found: list[str] = []
    for face in faces:
        powers = [to_number(p.power) for p in face.panels]
        for idx, panel in enumerate(face.panels):
            name = panel.name or f"{face.label} {idx + 1}"
            others = [v for j, v in enumerate(powers) if j != idx and v is not None]
            avg = sum(others) / len(others) if others else 0.0
            me = powers[idx]
            if (
                panel.last_reported is not None
                and (now - panel.last_reported).total_seconds() > stale_s
            ):
                found.append(f"{name} stale")
            elif avg > sibling_min_kw and (me is None or me < panel_min_kw):
                found.append(f"{name} no output")
    return found


def findings_text(found: Sequence[str], max_len: int = MAX_FINDINGS_LEN) -> str:
    """Join findings into the sensor state, "OK" when empty."""
    return (", ".join(found) if found else OK)[:max_len]


def evaluate(
    faces: Sequence[RoofFace],
    now: datetime,
    *,
    sun_elevation: Any,
    gateway_online: bool = True,
    min_elevation: float = DEFAULT_MIN_ELEVATION,
    stale_s: float = DEFAULT_STALE_S,
    sibling_min_kw: float = DEFAULT_SIBLING_MIN_KW,
    panel_min_kw: float = DEFAULT_PANEL_MIN_KW,
    max_len: int = MAX_FINDINGS_LEN,
) -> str:
    """Full health check. Returns "OK" or a comma separated findings list."""
    if not gateway_online:
        return findings_text([GATEWAY_OFFLINE], max_len)
    if not sun_is_up(sun_elevation, min_elevation):
        return OK
    found = panel_findings(
        faces,
        now,
        stale_s=stale_s,
        sibling_min_kw=sibling_min_kw,
        panel_min_kw=panel_min_kw,
    )
    return findings_text(found, max_len)


def gateway_online(state: Any) -> bool:
    """A gateway entity counts as offline when unavailable, unknown or missing."""
    return state is not None and str(state) not in ("unavailable", "unknown", "")


def _as_datetime(value: datetime | str | None) -> datetime | None:
    if value is None or isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def update_problem(
    findings: str,
    previous_since: datetime | str | None,
    now: datetime,
    persist_s: float = DEFAULT_PERSIST_S,
) -> ProblemState:
    """Track how long findings have been present.

    previous_since is the stored problem_since (a datetime or an ISO string
    from restored state). The flag is on once findings have lasted persist_s.
    """
    if findings == OK:
        return ProblemState(False, None, findings)
    since = _as_datetime(previous_since) or now
    on = (now - since) >= timedelta(seconds=persist_s)
    return ProblemState(on, since, findings)
