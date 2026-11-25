// History and statistics over the HA websocket, with a small cache so several
// cards on one dashboard don't ask for the same data.

const cache = new Map();
const DEFAULT_TTL = 60_000;
const MAX_ENTRIES = 50;
const connIds = new WeakMap();
let connSeq = 0;

function cacheKey(hass, msg) {
  // A new connection (reconnect, user switch) starts a fresh cache.
  let conn = connIds.get(hass?.connection);
  if (!conn) {
    conn = ++connSeq;
    if (hass?.connection) connIds.set(hass.connection, conn);
  }
  return `${conn}|${JSON.stringify(msg)}`;
}
// hass.callWS with caching. Failed calls are not cached.
export function cachedCall(hass, msg, ttl = DEFAULT_TTL) {
  const key = cacheKey(hass, msg);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.promise;
  const promise = hass.callWS(msg);
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
  return promise;
}

export function clearCache() {
  cache.clear();
}

// ---- time helpers ----

const iso = (d) => (d instanceof Date ? d : new Date(d)).toISOString();

// Round down to a whole number of minutes, so repeated calls share a cache key.
export function floorTo(date, minutes) {
  const step = minutes * 60_000;
  return new Date(Math.floor(new Date(date).getTime() / step) * step);
}

export function hoursAgo(hours, now = Date.now(), roundMinutes = 5) {
  return floorTo(now - hours * 3_600_000, roundMinutes);
}

export function startOfDay(d = new Date(), daysBack = 0) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - daysBack);
  return out;
}

// ---- history ----

// Raw history/history_during_period. Returns {entity_id: [{s, a?, lu, lc?}]}.
export function fetchHistory(hass, opts) {
  const {
    entityIds,
    start,
    end,
    minimal = true,
    noAttributes = true,
    significantOnly = false,
    ttl,
  } = opts;
  const msg = {
    type: "history/history_during_period",
    start_time: iso(start),
    entity_ids: [...entityIds],
    minimal_response: minimal,
    no_attributes: noAttributes,
    significant_changes_only: significantOnly,
  };
  if (end) msg.end_time = iso(end);
  return cachedCall(hass, msg, ttl);
}

// History rows -> [{t: ms, v: number}] with non-numeric states dropped.
// map converts each value, e.g. a unit conversion.
export function toSeries(rows, map = (v) => v) {
  const out = [];
  for (const r of rows || []) {
    const v = Number(r.s);
    const t = (r.lu ?? r.lc) * 1000;
    if (r.s === "" || r.s === null || !Number.isFinite(v) || !Number.isFinite(t)) continue;
    out.push({ t, v: map(v) });
  }
  return out;
}

// Live history: history/stream. onData gets {entity_id: [rows]} with everything
// since start, kept in memory and trimmed to the last `hours` if given.
// Returns a promise of an unsubscribe function.
export function subscribeHistory(hass, opts, onData) {
  const { entityIds, start, hours, minimal = true, noAttributes = true, significantOnly = false } = opts;
  const data = {};
  const msg = {
    type: "history/stream",
    entity_ids: [...entityIds],
    start_time: iso(start ?? hoursAgo(hours ?? 24)),
    minimal_response: minimal,
    no_attributes: noAttributes,
    significant_changes_only: significantOnly,
  };
  return hass.connection.subscribeMessage((message) => {
    const states = message?.states || {};
    for (const [id, rows] of Object.entries(states)) {
      (data[id] ||= []).push(...rows);
    }
    if (hours) {
      const cutoff = (Date.now() - hours * 3_600_000) / 1000;
      for (const id of Object.keys(data)) {
        const rows = data[id];
        let i = 0;
        // keep one row before the cutoff so the line starts at the left edge
        while (i < rows.length - 1 && (rows[i + 1].lu ?? rows[i + 1].lc) < cutoff) i++;
        if (i) data[id] = rows.slice(i);
      }
    }
    onData(data);
  }, msg);
}

// ---- statistics ----

// recorder/statistics_during_period.
// period: "5minute" | "hour" | "day" | "week" | "month".
// Returns {statistic_id: [{start: ms, end: ms, change?, sum?, mean?, min?, max?, state?}]}.
export function fetchStatistics(hass, opts) {
  const { statisticIds, start, end, period = "hour", types = ["change"], units, ttl = 5 * 60_000 } = opts;
  const msg = {
    type: "recorder/statistics_during_period",
    start_time: iso(start),
    statistic_ids: [...statisticIds],
    period,
    types,
  };
  if (end) msg.end_time = iso(end);
  if (units) msg.units = units;
  return cachedCall(hass, msg, ttl);
}

// One statistic -> [{t: ms, v: number}] using `field` (default change).
export function statSeries(rows, field = "change") {
  const out = [];
  for (const r of rows || []) {
    const t = typeof r.start === "number" ? r.start : Date.parse(r.start);
    const v = r[field];
    if (typeof v === "number" && Number.isFinite(v) && Number.isFinite(t)) out.push({ t, v });
  }
  return out;
}

// Sum of `field` over all rows.
export function statTotal(rows, field = "change") {
  return statSeries(rows, field).reduce((a, p) => a + p.v, 0);
}
