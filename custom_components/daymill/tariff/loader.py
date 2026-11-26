"""Load and validate tariff presets and NEM 3.0 export tables.

File reads here block, so call them from an executor inside Home Assistant.
"""

from __future__ import annotations

import calendar
from datetime import date, time
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import yaml

from .model import (
    ADDER_BASES,
    DAY_TYPES,
    NBC,
    NEM_MODES,
    Adder,
    Component,
    ExportTable,
    HolidayRule,
    PeriodRule,
    Season,
    Tariff,
    TariffError,
    Window,
)

TARIFF_DIR = Path(__file__).parent
PRESET_DIR = TARIFF_DIR / "presets"

# "monday"/"mon" -> 0 ... "sunday"/"sun" -> 6
WEEKDAYS = {name.lower(): i for i, name in enumerate(calendar.day_name)}
WEEKDAYS.update({k[:3]: v for k, v in list(WEEKDAYS.items())})

DAY_ALIASES = {
    "all": ("weekday", "weekend", "holiday"),
    "weekend_holiday": ("weekend", "holiday"),
}


def _read_yaml(path: Path) -> Any:
    try:
        with open(path, encoding="utf-8") as f:
            return yaml.safe_load(f)
    except FileNotFoundError as err:
        raise TariffError(f"file not found: {path.name}") from err
    except yaml.YAMLError as err:
        raise TariffError(f"{path.name}: bad YAML: {err}") from err


class _Checker:
    """Collects every problem instead of stopping at the first one."""

    def __init__(self) -> None:
        self.errors: list[str] = []

    def err(self, where: str, msg: str) -> None:
        self.errors.append(f"{where}: {msg}" if where else msg)

    def str_(self, d: dict, key: str, where: str, default: str | None = None) -> str:
        v = d.get(key, default)
        if not isinstance(v, str) or not v.strip():
            self.err(f"{where}.{key}" if where else key, "required text value")
            return default or ""
        return v

    def num(self, v: Any, where: str, default: float = 0.0) -> float:
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            self.err(where, f"expected a number, got {v!r}")
            return default
        return float(v)

    def dict_(self, v: Any, where: str) -> dict:
        if v is None:
            return {}
        if not isinstance(v, dict):
            self.err(where, f"expected a mapping, got {type(v).__name__}")
            return {}
        return v

    def list_(self, v: Any, where: str) -> list:
        if v is None:
            return []
        if not isinstance(v, list):
            self.err(where, f"expected a list, got {type(v).__name__}")
            return []
        return v


def _parse_time(v: Any, where: str, chk: _Checker) -> time | None:
    # YAML 1.1 reads an unquoted 16:00 as the base-60 int 960
    if isinstance(v, int) and not isinstance(v, bool):
        h, m = divmod(v, 60)
    elif isinstance(v, str):
        try:
            hs, ms = v.strip().split(":")[:2]
            h, m = int(hs), int(ms)
        except ValueError:
            chk.err(where, f"bad time {v!r}, use HH:MM")
            return None
    else:
        chk.err(where, f"bad time {v!r}, use HH:MM")
        return None
    if (h, m) == (24, 0):
        return time(0)
    if not (0 <= h < 24 and 0 <= m < 60):
        chk.err(where, f"bad time {v!r}")
        return None
    return time(h, m)


def _parse_month_day(v: Any, where: str, chk: _Checker) -> tuple[int, int] | None:
    try:
        if isinstance(v, str):
            m, d = (int(x) for x in v.split("-"))
        elif isinstance(v, (list, tuple)) and len(v) == 2:
            m, d = int(v[0]), int(v[1])
        else:
            raise ValueError
        date(2000, m, d)  # leap year so 02-29 is allowed
    except (TypeError, ValueError):
        chk.err(where, f"bad month-day {v!r}, use 'MM-DD'")
        return None
    return m, d


def _parse_date(v: Any, where: str, chk: _Checker) -> date | None:
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        try:
            return date.fromisoformat(v)
        except ValueError:
            pass
    chk.err(where, f"bad date {v!r}, use YYYY-MM-DD")
    return None


def _parse_days(v: Any, where: str, chk: _Checker) -> frozenset[str]:
    if v is None:
        return frozenset(DAY_TYPES)
    items = [v] if isinstance(v, str) else chk.list_(v, where)
    out: set[str] = set()
    for item in items:
        if item in DAY_ALIASES:
            out.update(DAY_ALIASES[item])
        elif item in DAY_TYPES:
            out.add(item)
        else:
            chk.err(where, f"unknown day type {item!r} (weekday, weekend, holiday, all)")
    return frozenset(out)


def _parse_seasons(raw: Any, chk: _Checker) -> tuple[Season, ...]:
    seasons: list[Season] = []
    items = chk.list_(raw, "seasons")
    if not items:
        chk.err("seasons", "at least one season is required")
    seen_keys: set[str] = set()
    seen_starts: set[tuple[int, int]] = set()
    for i, s in enumerate(items):
        w = f"seasons[{i}]"
        s = chk.dict_(s, w)
        key = chk.str_(s, "key", w)
        if key in seen_keys:
            chk.err(f"{w}.key", f"duplicate season {key!r}")
        seen_keys.add(key)
        start = _parse_month_day(s.get("start"), f"{w}.start", chk) or (1, 1)
        if start in seen_starts:
            chk.err(f"{w}.start", "two seasons start on the same day")
        seen_starts.add(start)
        default = chk.str_(s, "default_period", w)
        rules: list[PeriodRule] = []
        for j, r in enumerate(chk.list_(s.get("rules"), f"{w}.rules")):
            rw = f"{w}.rules[{j}]"
            r = chk.dict_(r, rw)
            period = chk.str_(r, "period", rw)
            days = _parse_days(r.get("days"), f"{rw}.days", chk)
            windows: list[Window] = []
            for k, win in enumerate(chk.list_(r.get("windows"), f"{rw}.windows")):
                ww = f"{rw}.windows[{k}]"
                if not isinstance(win, (list, tuple)) or len(win) != 2:
                    chk.err(ww, "expected [start, end]")
                    continue
                a = _parse_time(win[0], ww, chk)
                b = _parse_time(win[1], ww, chk)
                if a is not None and b is not None:
                    windows.append(Window(a, b))
            if not windows:
                chk.err(f"{rw}.windows", "at least one window is required")
            rules.append(PeriodRule(period, tuple(windows), days))
        seasons.append(Season(key, start, tuple(rules), default))
    return tuple(seasons)


def _parse_holidays(raw: Any, chk: _Checker) -> tuple[tuple[HolidayRule, ...], bool]:
    raw = chk.dict_(raw, "holidays")
    shift = raw.get("sunday_shift", False)
    if not isinstance(shift, bool):
        chk.err("holidays.sunday_shift", "expected true or false")
        shift = False
    rules: list[HolidayRule] = []
    for i, h in enumerate(chk.list_(raw.get("rules"), "holidays.rules")):
        w = f"holidays.rules[{i}]"
        h = chk.dict_(h, w)
        name = chk.str_(h, "name", w)
        if "date" in h:
            md = _parse_month_day(h["date"], f"{w}.date", chk)
            if md:
                rules.append(HolidayRule(name, md[0], day=md[1]))
            continue
        month = h.get("month")
        if not isinstance(month, int) or not 1 <= month <= 12:
            chk.err(f"{w}.month", f"bad month {month!r}")
            continue
        wd = WEEKDAYS.get(str(h.get("weekday", "")).lower())
        if wd is None:
            chk.err(f"{w}.weekday", f"bad weekday {h.get('weekday')!r}")
            continue
        nth = h.get("nth", 1)
        if nth == "last":
            nth = -1
        if not isinstance(nth, int) or isinstance(nth, bool) or nth == 0 or not -5 <= nth <= 5:
            chk.err(f"{w}.nth", f"bad nth {nth!r} (1-5 or 'last')")
            continue
        rules.append(HolidayRule(name, month, weekday=wd, nth=nth))
    return tuple(rules), shift


def _parse_components(raw: Any, seasons: tuple[Season, ...], chk: _Checker) -> tuple:
    comps: list[Component] = []
    items = chk.list_(raw, "components")
    if not items:
        chk.err("components", "at least one rate component is required")
    for i, c in enumerate(items):
        w = f"components[{i}]"
        c = chk.dict_(c, w)
        key = chk.str_(c, "key", w)
        label = c.get("label") or key
        table: dict[str, dict[str, float]] = {}
        per = chk.dict_(c.get("per_kwh"), f"{w}.per_kwh")
        for s in seasons:
            row = chk.dict_(per.get(s.key), f"{w}.per_kwh.{s.key}")
            for p in s.periods:
                if p not in row:
                    chk.err(f"{w}.per_kwh.{s.key}", f"missing price for period {p!r}")
            table[s.key] = {p: chk.num(v, f"{w}.per_kwh.{s.key}.{p}") for p, v in row.items()}
        for extra in set(per) - {s.key for s in seasons}:
            chk.err(f"{w}.per_kwh", f"unknown season {extra!r}")
        comps.append(Component(key, label, table))
    return tuple(comps)


def _parse_adders(raw: Any, chk: _Checker) -> tuple[Adder, ...]:
    out: list[Adder] = []
    for i, a in enumerate(chk.list_(raw, "adders")):
        w = f"adders[{i}]"
        a = chk.dict_(a, w)
        key = chk.str_(a, "key", w)
        basis = a.get("basis", "net_interval")
        if basis not in ADDER_BASES:
            chk.err(f"{w}.basis", f"unknown basis {basis!r} ({', '.join(sorted(ADDER_BASES))})")
        out.append(
            Adder(key, a.get("label") or key, chk.num(a.get("per_kwh"), f"{w}.per_kwh"), basis)
        )
    return tuple(out)


def _parse_nbc(raw: Any, chk: _Checker) -> NBC | None:
    if raw is None:
        return None
    raw = chk.dict_(raw, "nbc")
    per = chk.num(raw.get("per_kwh"), "nbc.per_kwh")
    parts = {
        str(k): chk.num(v, f"nbc.parts.{k}")
        for k, v in chk.dict_(raw.get("parts"), "nbc.parts").items()
    }
    if parts and abs(sum(parts.values()) - per) > 1e-9:
        chk.err("nbc.parts", f"parts add up to {sum(parts.values()):.5f}, not {per}")
    minutes = raw.get("interval_minutes", 60)
    if not isinstance(minutes, int) or minutes <= 0 or 1440 % minutes:
        chk.err("nbc.interval_minutes", f"bad interval {minutes!r}")
        minutes = 60
    return NBC(per, parts, minutes)


def validate(data: Any) -> list[str]:
    """Problems with a tariff mapping. Empty list means it loads."""
    try:
        _build(data)
    except TariffError as err:
        return list(err.args[1]) if len(err.args) > 1 else [str(err)]
    return []


def _build(data: Any) -> Tariff:
    chk = _Checker()
    if not isinstance(data, dict):
        raise TariffError("tariff must be a mapping", ["tariff must be a mapping"])
    tid = chk.str_(data, "id", "")
    name = chk.str_(data, "name", "")
    tz = chk.str_(data, "timezone", "")
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        chk.err("timezone", f"unknown time zone {tz!r}")
    eff = _parse_date(data.get("effective_date"), "effective_date", chk)
    seasons = _parse_seasons(data.get("seasons"), chk)
    holidays, shift = _parse_holidays(data.get("holidays"), chk)
    components = _parse_components(data.get("components"), seasons, chk)
    adders = _parse_adders(data.get("adders"), chk)
    nbc = _parse_nbc(data.get("nbc"), chk)
    daily = chk.num(data.get("daily_charge", 0.0), "daily_charge")

    keys = [c.key for c in components] + [a.key for a in adders]
    dupes = {k for k in keys if keys.count(k) > 1}
    if dupes:
        chk.err("components/adders", f"duplicate keys {sorted(dupes)}")

    labels = {
        str(k): str(v) for k, v in chk.dict_(data.get("period_labels"), "period_labels").items()
    }
    for s in seasons:
        for p in s.periods:
            labels.setdefault(p, p.replace("_", " ").title())

    nem = chk.dict_(data.get("nem"), "nem")
    for mode in nem:
        if mode not in NEM_MODES:
            chk.err("nem", f"unknown NEM mode {mode!r} ({', '.join(NEM_MODES)})")
    nem = {k: dict(chk.dict_(v, f"nem.{k}")) for k, v in nem.items()}
    if "nscr" in nem.get("nem2", {}):
        chk.num(nem["nem2"]["nscr"], "nem.nem2.nscr")
    nem3 = nem.get("nem3")
    if nem3 is not None and "export_table" not in nem3 and "export_prices" not in nem3:
        chk.err("nem.nem3", "needs export_table (file) or export_prices (inline table)")
    if nem3 and "export_prices" in nem3:
        parse_export_table(
            {"utility": data.get("utility", ""), "name": name, "prices": nem3["export_prices"]},
            chk=chk,
            where="nem.nem3.export_prices",
        )

    if chk.errors:
        raise TariffError("invalid tariff: " + "; ".join(chk.errors), chk.errors)
    return Tariff(
        id=tid,
        name=name,
        utility=str(data.get("utility", "")),
        plan=str(data.get("plan", "")),
        timezone=tz,
        currency=str(data.get("currency", "USD")),
        effective_date=eff,
        seasons=seasons,
        period_labels=labels,
        holidays=holidays,
        holiday_sunday_shift=shift,
        components=components,
        adders=adders,
        nbc=nbc,
        daily_charge=daily,
        nem=nem,
        extras=dict(data.get("extras") or {}),
    )


def load_tariff(source: dict | str | Path) -> Tariff:
    """Build a Tariff from a mapping or a YAML file path. Raises TariffError."""
    if isinstance(source, dict):
        return _build(source)
    return _build(_read_yaml(Path(source)))


def list_presets() -> dict[str, str]:
    """Bundled presets as {id: name}."""
    out: dict[str, str] = {}
    for path in sorted(PRESET_DIR.glob("*.yaml")):
        data = _read_yaml(path)
        if isinstance(data, dict) and "id" in data:
            out[str(data["id"])] = str(data.get("name", data["id"]))
    return out


def load_preset(preset_id: str) -> Tariff:
    for path in sorted(PRESET_DIR.glob("*.yaml")):
        data = _read_yaml(path)
        if isinstance(data, dict) and data.get("id") == preset_id:
            return _build(data)
    raise TariffError(f"no preset {preset_id!r}")


def _parse_month_prices(
    raw: Any, chk: _Checker, where: str
) -> dict[int, dict[str, tuple[float, ...]]]:
    prices: dict[int, dict[str, tuple[float, ...]]] = {}
    raw = chk.dict_(raw, where)
    by_month: dict[int, Any] = {}
    for k, v in raw.items():
        try:
            m = int(k)
        except (TypeError, ValueError):
            chk.err(where, f"bad month {k!r}")
            continue
        by_month[m] = v
    for m in range(1, 13):
        if m not in by_month:
            chk.err(where, f"missing month {m}")
            continue
        row = chk.dict_(by_month[m], f"{where}.{m}")
        prices[m] = {}
        for kind in ("weekday", "weekend"):
            hours = chk.list_(row.get(kind), f"{where}.{m}.{kind}")
            if len(hours) != 24:
                chk.err(f"{where}.{m}.{kind}", f"needs 24 hourly prices, got {len(hours)}")
            prices[m][kind] = tuple(
                chk.num(v, f"{where}.{m}.{kind}[{h}]") for h, v in enumerate(hours)
            )
    for m in set(by_month) - set(range(1, 13)):
        chk.err(where, f"bad month {m}")
    return prices


def parse_export_table(
    data: Any, chk: _Checker | None = None, where: str = "prices"
) -> ExportTable:
    """Hourly export table from a mapping. Months 1-12, weekday/weekend, 24 hours each.

    An optional prices_by_year holds other calendar years in the same shape;
    "prices" is the year in price_year (or the effective date's year).
    """
    own = chk is None
    chk = chk or _Checker()
    data = chk.dict_(data, "")
    prices = _parse_month_prices(data.get("prices"), chk, where)
    eff = None
    if data.get("effective_date") is not None:
        eff = _parse_date(data["effective_date"], "effective_date", chk)
    by_year: dict[int, dict[int, dict[str, tuple[float, ...]]]] = {}
    for k, v in (data.get("prices_by_year") or {}).items():
        try:
            year = int(k)
        except (TypeError, ValueError):
            chk.err("prices_by_year", f"bad year {k!r}")
            continue
        by_year[year] = _parse_month_prices(v, chk, f"prices_by_year.{year}")
    base_year = data.get("price_year") or (eff.year if eff else None)
    if by_year and base_year is not None:
        by_year.setdefault(int(base_year), prices)
    if own and chk.errors:
        raise TariffError("invalid export table: " + "; ".join(chk.errors), chk.errors)
    return ExportTable(
        utility=str(data.get("utility", "")),
        name=str(data.get("name", "")),
        effective_date=eff,
        prices=prices,
        source_urls=tuple(str(u) for u in data.get("source_urls") or ()),
        notes=str(data.get("notes", "") or ""),
        by_year=by_year,
    )


def load_export_table(ref: str | Path) -> ExportTable:
    """Load an export table file. Relative paths resolve against the tariff folder."""
    path = Path(ref)
    if not path.is_absolute():
        path = TARIFF_DIR / path
    return parse_export_table(_read_yaml(path))


def export_table_for(tariff: Tariff) -> ExportTable:
    """The NEM 3.0 export table a tariff points at (inline or file)."""
    nem3 = tariff.nem.get("nem3")
    if not nem3:
        raise TariffError(f"{tariff.id} has no NEM 3.0 export prices")
    if "export_prices" in nem3:
        return parse_export_table(
            {"utility": tariff.utility, "name": tariff.name, "prices": nem3["export_prices"]}
        )
    return load_export_table(nem3["export_table"])


def export_table_data(tariff: Tariff) -> dict[str, Any] | None:
    """Raw NEM 3.0 export table mapping (for billing.nbt_options), or None."""
    nem3 = tariff.nem.get("nem3")
    if not nem3:
        return None
    if "export_prices" in nem3:
        return {"utility": tariff.utility, "name": tariff.name, "prices": nem3["export_prices"]}
    path = Path(nem3["export_table"])
    if not path.is_absolute():
        path = TARIFF_DIR / path
    data = _read_yaml(path)
    return data if isinstance(data, dict) else None


def nbt_table_for_pto(utility: str, pto_year: int) -> dict[str, Any] | None:
    """The bundled export table whose price_vintages include this PTO year, or None."""
    for path in sorted((TARIFF_DIR / "nbt").glob("*.yaml")):
        data = _read_yaml(path)
        if (
            isinstance(data, dict)
            and data.get("utility") == utility
            and pto_year in (data.get("price_vintages") or ())
        ):
            return data
    return None
