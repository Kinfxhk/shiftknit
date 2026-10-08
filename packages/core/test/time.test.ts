// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  dayStart,
  formatDate,
  formatTime,
  isValidTimeZone,
  localParts,
  offsetAt,
  parseDate,
  parseTime,
  shiftInterval,
  weekday,
  zonedInstant,
} from '../src/index';
import { timeDigest } from './helpers/tz-digest-lib';

const d = (s: string) => parseDate(s)!;
const len = (date: string, start: string, end: string, tz: string) => {
  const i = shiftInterval(d(date), parseTime(start)!, parseTime(end)!, tz);
  return i.end - i.start;
};

describe('dates and times', () => {
  it('parses only real dates', () => {
    expect(parseDate('2026-02-28')).toBeDefined();
    expect(parseDate('2026-02-29')).toBeUndefined();
    expect(parseDate('2028-02-29')).toBeDefined();
    expect(parseDate('2026-13-01')).toBeUndefined();
    expect(parseDate('2026-1-01')).toBeUndefined();
    expect(parseDate(' 2026-01-01')).toBeUndefined();
    expect(formatDate(d('2026-10-08'))).toBe('2026-10-08');
  });

  it('knows weekdays (Monday = 0)', () => {
    expect(weekday(d('2026-10-05'))).toBe(0); // Monday
    expect(weekday(d('2026-10-08'))).toBe(3); // Thursday
    expect(weekday(d('2026-10-11'))).toBe(6); // Sunday
    expect(weekday(d('1969-12-31'))).toBe(2); // before the epoch
  });

  it('parses HH:MM strictly; 24:00 only where allowed', () => {
    expect(parseTime('00:00')).toBe(0);
    expect(parseTime('23:59')).toBe(1439);
    expect(parseTime('24:00')).toBeUndefined();
    expect(parseTime('24:00', true)).toBe(1440);
    expect(parseTime('24:30', true)).toBeUndefined();
    expect(parseTime('12:60')).toBeUndefined();
    expect(parseTime('7:00')).toBeUndefined();
    expect(formatTime(450)).toBe('07:30');
  });

  it('validates IANA zones', () => {
    expect(isValidTimeZone('Asia/Hong_Kong')).toBe(true);
    expect(isValidTimeZone('Europe/London')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('../../etc')).toBe(false);
  });
});

describe('real shift lengths (golden)', () => {
  it('overnight shift in Hong Kong (no DST)', () => {
    expect(len('2026-03-28', '22:00', '07:00', 'Asia/Hong_Kong')).toBe(540);
    expect(len('2026-10-24', '22:00', '07:00', 'Asia/Hong_Kong')).toBe(540);
    expect(offsetAt(zonedInstant(d('2026-07-01'), 0, 'Asia/Hong_Kong'), 'Asia/Hong_Kong')).toBe(
      480,
    );
  });

  it('Europe/London spring forward 2026-03-29 loses one hour', () => {
    expect(len('2026-03-28', '22:00', '07:00', 'Europe/London')).toBe(480);
    expect(
      dayStart(d('2026-03-30'), 'Europe/London') - dayStart(d('2026-03-29'), 'Europe/London'),
    ).toBe(1380);
    expect(len('2026-03-29', '09:00', '17:00', 'Europe/London')).toBe(480);
  });

  it('Europe/London fall back 2026-10-25 gains one hour', () => {
    expect(len('2026-10-24', '22:00', '07:00', 'Europe/London')).toBe(600);
    expect(
      dayStart(d('2026-10-26'), 'Europe/London') - dayStart(d('2026-10-25'), 'Europe/London'),
    ).toBe(1500);
  });

  it('non-existent local time moves forward; ambiguous time takes the earlier instant', () => {
    const gap = zonedInstant(d('2026-03-29'), 90, 'Europe/London'); // 01:30 does not exist
    expect(localParts(gap, 'Europe/London').minOfDay).toBe(150); // 02:30 BST
    const amb = zonedInstant(d('2026-10-25'), 90, 'Europe/London'); // 01:30 happens twice
    expect(offsetAt(amb, 'Europe/London')).toBe(60); // the first (BST) occurrence
  });

  it('same-day shift that spans the fall-back hour', () => {
    expect(len('2026-10-25', '00:00', '04:00', 'Europe/London')).toBe(300);
  });
});

describe('time properties', () => {
  const zones = [
    'Asia/Hong_Kong',
    'Europe/London',
    'America/New_York',
    'Australia/Sydney',
    'Asia/Kolkata',
  ];
  it('start + real length lands on the local end time (3,000 runs)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: d('2025-01-01'), max: d('2027-12-31') }),
        fc.integer({ min: 0, max: 1439 }),
        fc.integer({ min: 0, max: 1439 }),
        fc.constantFrom(...zones),
        (day, s, e, tz) => {
          fc.pre(s !== e);
          const i = shiftInterval(day, s, e, tz);
          expect(i.end).toBeGreaterThan(i.start);
          expect(i.end - i.start).toBeLessThanOrEqual(1440 + 60);
          const endDay = e <= s ? day + 1 : day;
          const back = localParts(i.end, tz);
          // Exactly the local end time, unless that wall time does not exist (DST gap).
          const exists =
            zonedInstant(endDay, e, tz) === i.end && localParts(i.end, tz).minOfDay === e;
          if (exists) expect(back).toEqual({ day: endDay, minOfDay: e });
          const front = localParts(i.start, tz);
          if (front.minOfDay === s) expect(front.day).toBe(day);
        },
      ),
      { numRuns: 3000, seed: 20261008 },
    );
  });

  it('formatDate/parseDate round-trip', () => {
    fc.assert(
      fc.property(fc.integer({ min: d('1900-01-01'), max: d('2200-12-31') }), (n) => {
        expect(parseDate(formatDate(n))).toBe(n);
      }),
      { numRuns: 1000, seed: 7 },
    );
  });
});

describe('independence from the machine time zone', () => {
  it('gives identical results under TZ=America/New_York, Asia/Tokyo and the default zone', () => {
    const here = timeDigest();
    const script = fileURLToPath(new URL('./helpers/tz-digest.ts', import.meta.url));
    for (const tz of ['America/New_York', 'Asia/Tokyo', 'Europe/London', 'UTC']) {
      const out = execFileSync(process.execPath, ['--import', 'tsx', script], {
        encoding: 'utf8',
        env: { ...process.env, TZ: tz },
      }).trim();
      expect(out, `TZ=${tz}`).toBe(here);
    }
  });
});
