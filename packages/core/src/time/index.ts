// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Calendar dates, wall-clock times and real elapsed minutes in an IANA time zone.
// All arithmetic is integer minutes since the Unix epoch (UTC). Time-zone offsets come
// from the built-in Intl API, so results never depend on the computer's own zone.

/** A calendar date as a day number: days since 1970-01-01. */
export type DayNum = number;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;
const MS_PER_MIN = 60_000;
export const MIN_PER_DAY = 1440;

/** Parse 'YYYY-MM-DD' strictly (real calendar dates only). Returns undefined if invalid. */
export function parseDate(s: string): DayNum | undefined {
  const m = DATE_RE.exec(s);
  if (!m) return undefined;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d)
    return undefined;
  return Math.round(ms / 86_400_000);
}

/** Format a day number as 'YYYY-MM-DD'. */
export function formatDate(day: DayNum): string {
  const d = new Date(day * 86_400_000);
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/** Day of week with Monday = 0 … Sunday = 6. */
export function weekday(day: DayNum): number {
  return (((day + 3) % 7) + 7) % 7; // 1970-01-01 was a Thursday (3)
}

/** Parse 'HH:MM' (00:00–23:59, or 24:00 when allow24) to minutes after midnight. */
export function parseTime(s: string, allow24 = false): number | undefined {
  const m = TIME_RE.exec(s);
  if (!m) return undefined;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (mi > 59) return undefined;
  if (h === 24 && mi === 0 && allow24) return MIN_PER_DAY;
  if (h > 23) return undefined;
  return h * 60 + mi;
}

export function formatTime(min: number): string {
  const h = Math.floor(min / 60);
  return `${String(h).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Is `tz` an IANA zone name the runtime knows? */
export function isValidTimeZone(tz: string): boolean {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  if (!/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(tz)) return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** UTC offset of `tz` at the instant `epochMin`, in minutes (local = UTC + offset). */
export function offsetAt(epochMin: number, tz: string): number {
  const parts = formatter(tz).formatToParts(new Date(epochMin * MS_PER_MIN));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? NaN);
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round(local / MS_PER_MIN) - epochMin;
}

/**
 * The instant (epoch minutes) of local wall-clock time `minOfDay` on `day` in `tz`.
 * Ambiguous times (clocks go back) resolve to the earlier instant; times that do not
 * exist (clocks go forward) are moved forward by the gap. This matches the common
 * "compatible" rule, so a 01:30 start on a spring-forward night becomes 02:30 local.
 * `minOfDay` may exceed 1440 (it is added to the date first).
 */
export function zonedInstant(day: DayNum, minOfDay: number, tz: string): number {
  const naive = day * MIN_PER_DAY + minOfDay;
  const before = offsetAt(naive - MIN_PER_DAY, tz);
  const after = offsetAt(naive + MIN_PER_DAY, tz);
  const candidates: number[] = [];
  for (const off of before === after ? [before] : [before, after]) {
    const t = naive - off;
    if (offsetAt(t, tz) === off) candidates.push(t);
  }
  if (candidates.length > 0) return Math.min(...candidates);
  return naive - before; // in a gap: interpret with the pre-transition offset
}

/** Local calendar day and minute-of-day of an instant in `tz`. */
export function localParts(epochMin: number, tz: string): { day: DayNum; minOfDay: number } {
  const local = epochMin + offsetAt(epochMin, tz);
  const day = Math.floor(local / MIN_PER_DAY);
  return { day, minOfDay: local - day * MIN_PER_DAY };
}

/** A concrete shift occurrence: real start/end instants in epoch minutes. */
export interface Interval {
  start: number;
  end: number;
}

/**
 * Real interval of a shift that starts at local `startMin` on `day` and ends at local
 * `endMin`. When `endMin <= startMin` the shift ends on the next calendar day.
 */
export function shiftInterval(day: DayNum, startMin: number, endMin: number, tz: string): Interval {
  const start = zonedInstant(day, startMin, tz);
  const endDay = endMin <= startMin ? day + 1 : day;
  const end = zonedInstant(endDay, endMin, tz);
  return { start, end };
}

/** Real instant of local midnight at the start of `day`. */
export function dayStart(day: DayNum, tz: string): number {
  return zonedInstant(day, 0, tz);
}
