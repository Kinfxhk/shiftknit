// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { parseDate, shiftInterval, localParts, weekday } from '../../src/index';

/** A digest of many time computations; must not depend on the process time zone. */
export function timeDigest(): string {
  const h = createHash('sha256');
  const zones = ['Asia/Hong_Kong', 'Europe/London', 'America/New_York', 'Pacific/Auckland'];
  const base = parseDate('2026-01-01')!;
  for (const tz of zones)
    for (let day = base; day < base + 400; day += 3) {
      const i = shiftInterval(day, 22 * 60 + 30, 7 * 60, tz);
      const p = localParts(i.end, tz);
      h.update(`${tz}|${day}|${i.start}|${i.end}|${p.day}|${p.minOfDay}|${weekday(day)}\n`);
    }
  return h.digest('hex');
}
