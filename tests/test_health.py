"""Tests for health.py."""

from datetime import UTC, datetime, timedelta

from custom_components.daymill import health as h

NOW = datetime(2026, 6, 15, 12, 0, tzinfo=UTC)
RECENT = NOW - timedelta(minutes=1)


def face(label, *powers, reported=RECENT):
    return h.RoofFace(label, [h.Panel(p, reported) for p in powers])


def test_all_ok():
    faces = [face("East", 0.3, 0.31, 0.29), face("West", 0.2, 0.21)]
    assert h.evaluate(faces, NOW, sun_elevation=40) == "OK"


def test_gateway_offline_wins_even_at_night():
    faces = [face("East", 0.0, 0.3)]
    assert h.evaluate(faces, NOW, sun_elevation=-30, gateway_online=False) == "Gateway offline"


def test_nothing_checked_when_sun_low():
    faces = [face("East", 0.0, 0.3, 0.3)]
    assert h.evaluate(faces, NOW, sun_elevation=10) == "OK"
    assert h.evaluate(faces, NOW, sun_elevation=None) == "OK"
    assert h.evaluate(faces, NOW, sun_elevation="unknown") == "OK"


def test_no_output():
    faces = [face("East", 0.3, 0.004, 0.3)]
    assert h.evaluate(faces, NOW, sun_elevation=10.5) == "East 2 no output"


def test_no_output_for_unavailable_panel():
    faces = [face("East", 0.3, "unavailable", 0.3)]
    assert h.evaluate(faces, NOW, sun_elevation=30) == "East 2 no output"


def test_siblings_too_low_is_ok():
    # Siblings average exactly 0.05: not above the threshold.
    faces = [face("North", 0.05, 0.0, 0.05)]
    assert h.evaluate(faces, NOW, sun_elevation=30) == "OK"


def test_single_panel_face_never_no_output():
    assert h.evaluate([face("Solo", 0.0)], NOW, sun_elevation=30) == "OK"


def test_stale_beats_no_output():
    old = NOW - timedelta(hours=2, seconds=1)
    panels = [h.Panel(0.3, RECENT), h.Panel(0.0, old), h.Panel(0.3, RECENT)]
    faces = [h.RoofFace("East", panels)]
    assert h.evaluate(faces, NOW, sun_elevation=30) == "East 2 stale"


def test_exactly_two_hours_is_not_stale():
    panels = [h.Panel(0.3, NOW - timedelta(hours=2)), h.Panel(0.3, RECENT)]
    assert h.evaluate([h.RoofFace("East", panels)], NOW, sun_elevation=30) == "OK"


def test_missing_timestamp_not_stale():
    panels = [h.Panel(0.3, None), h.Panel(0.3, None)]
    assert h.evaluate([h.RoofFace("East", panels)], NOW, sun_elevation=30) == "OK"


def test_multiple_faces_and_custom_names():
    panels = [h.Panel(0.3, RECENT), h.Panel(0.0, RECENT, name="Garage left")]
    faces = [face("East", 0.0, 0.3, 0.3), h.RoofFace("West", panels)]
    assert h.evaluate(faces, NOW, sun_elevation=30) == "East 1 no output, Garage left no output"


def test_findings_truncated():
    faces = [face("A very long roof face name", *([0.0] + [0.5] * 3)) for _ in range(20)]
    text = h.evaluate(faces, NOW, sun_elevation=30)
    assert len(text) == 250


def test_custom_thresholds():
    faces = [face("East", 0.1, 0.05)]
    assert h.evaluate(faces, NOW, sun_elevation=30) == "OK"
    assert (
        h.evaluate(faces, NOW, sun_elevation=30, panel_min_kw=0.06, sibling_min_kw=0.08)
        == "East 2 no output"
    )


def test_gateway_online():
    assert h.gateway_online("12345")
    assert not h.gateway_online("unavailable")
    assert not h.gateway_online("unknown")
    assert not h.gateway_online(None)


def test_update_problem_persistence():
    first = h.update_problem("East 2 no output", None, NOW)
    assert first == (False, NOW, "East 2 no output")

    later = NOW + timedelta(minutes=29, seconds=59)
    assert h.update_problem("East 2 no output", first.problem_since, later).problem is False

    at_30 = NOW + timedelta(minutes=30)
    state = h.update_problem("East 2 no output", first.problem_since, at_30)
    assert state.problem is True
    assert state.problem_since == NOW


def test_update_problem_clears_at_once():
    state = h.update_problem("OK", NOW - timedelta(hours=3), NOW)
    assert state == (False, None, "OK")


def test_update_problem_restored_iso_string():
    since = (NOW - timedelta(hours=1)).isoformat()
    state = h.update_problem("Gateway offline", since, NOW)
    assert state.problem is True
    assert state.problem_since == NOW - timedelta(hours=1)


def test_update_problem_bad_string_restarts():
    state = h.update_problem("Gateway offline", "", NOW)
    assert state == (False, NOW, "Gateway offline")
