// Calendar days in a given IANA time zone, without a date library.
// Statistics days and months start at midnight in the server's time zone, so
// the day and month charts key and label their columns there.

const parts = new Map();

function fmt(tz) {
  let f = parts.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    } catch {
      f = new Intl.DateTimeFormat("en-US", { hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    }
    parts.set(tz, f);
  }
  return f;
}

// Wall clock fields of ms in tz: {y, m (0-11), d, H, M, S}.
export function wall(ms, tz) {
  const o = {};
  for (const p of fmt(tz).formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year, m: o.month - 1, d: o.day, H: o.hour % 24, M: o.minute, S: o.second };
}

// Offset of tz from UTC at ms, in ms (UTC-8 -> -8 h).
export function offset(ms, tz) {
  const w = wall(ms, tz);
  return Date.UTC(w.y, w.m, w.d, w.H, w.M, w.S) - Math.floor(ms / 1000) * 1000;
}

// Midnight starting calendar day (y, m, d) in tz, as ms. m and d may be out
// of range (d = 0 is the last day of the month before).
export function midnight(y, m, d, tz) {
  const guess = Date.UTC(y, m, d);
  let ms = guess - offset(guess, tz);
  ms = guess - offset(ms, tz); // once more, in case the offset changed in between
  return ms;
}

// Calendar day of ms in tz, as a UTC date at noon: safe to step with
// setUTCDate/setUTCMonth and to label with timeZone "UTC".
export function calendarDay(ms, tz) {
  const w = wall(ms, tz);
  return new Date(Date.UTC(w.y, w.m, w.d, 12));
}

// The time zone statistics are bucketed in.
export const serverZone = (hass) => hass?.config?.time_zone || Intl.DateTimeFormat().resolvedOptions().timeZone;

// The time zone the user wants times shown in.
export const displayZone = (hass) => (hass?.locale?.time_zone === "server" ? serverZone(hass) : Intl.DateTimeFormat().resolvedOptions().timeZone);
