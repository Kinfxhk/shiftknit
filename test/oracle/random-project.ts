// SPDX-License-Identifier: AGPL-3.0-or-later
// Seeded random project generator for property and oracle tests.
import type { Project } from '../../packages/core/src/index';
import { formatDate, parseDate, validateProject } from '../../packages/core/src/index';

export class TestRng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  int(n: number): number {
    // xorshift32
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return n <= 1 ? 0 : this.s % n;
  }
  pick<T>(a: readonly T[]): T {
    return a[this.int(a.length)]!;
  }
  chance(pct: number): boolean {
    return this.int(100) < pct;
  }
}

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export interface Size {
  staff: [number, number];
  days: [number, number];
  shifts: [number, number];
}

export function randomProject(seed: number, size: Size): Project {
  const r = new TestRng(seed);
  const between = ([a, b]: [number, number]) => a + r.int(b - a + 1);
  const S = between(size.staff);
  const D = between(size.days);
  const K = between(size.shifts);
  const tz = r.pick(['Asia/Hong_Kong', 'Asia/Hong_Kong', 'Europe/London', 'America/New_York']);
  const start = formatDate(
    parseDate(r.pick(['2026-11-02', '2026-10-21', '2026-03-26', '2026-10-30', '2026-12-29']))!,
  );
  const skills = r.chance(50) ? ['s1', 's2'] : [];
  const shifts = Array.from({ length: K }, (_, k) => {
    const st = r.int(48) * 30;
    const len = (4 + r.int(9)) * 60;
    const demand = Array.from({ length: 7 }, () => (r.chance(25) ? 0 : 1 + (r.chance(25) ? 1 : 0)));
    return {
      id: `k${k}`,
      name: `Shift ${k}`,
      start: hhmm(st),
      end: hhmm((st + len) % 1440),
      breakMinutes: r.pick([0, 0, 30, 60]),
      demand,
      skillDemand:
        skills.length && r.chance(40)
          ? [{ skills: r.chance(30) ? ['s1', 's2'] : ['s1'], min: 1 }]
          : [],
    };
  });
  const first = parseDate(start)!;
  const staff = Array.from({ length: S }, (_, s) => {
    const maxW = r.chance(40) ? (8 + r.int(40)) * 60 : 10080;
    const minW = r.chance(15) ? Math.min(maxW, r.int(16) * 60) : 0;
    return {
      id: `p${s}`,
      name: `Person ${s}`,
      skills: skills.filter(() => r.chance(50)),
      maxConsecutiveDays: Math.min(31, 1 + r.int(D + 1)),
      maxWeeklyMinutes: maxW,
      minWeeklyMinutes: minW,
      availability: r.chance(30)
        ? [
            {
              days: [0, 1, 2, 3, 4, 5, 6]
                .filter(() => r.chance(70))
                .concat([r.int(7)])
                .filter((v, i, a) => a.indexOf(v) === i),
              from: hhmm(r.int(24) * 60),
              to: r.chance(30) ? '24:00' : hhmm(r.int(24) * 60),
            },
          ]
        : [],
      leave: r.chance(25) ? [formatDate(first + r.int(D))] : [],
      preferences: r.chance(40)
        ? [
            {
              kind: r.pick(['want', 'avoid'] as const),
              ...(K > 0 && r.chance(60) ? { shift: `k${r.int(K)}` } : {}),
              ...(r.chance(50) ? { weekday: r.int(7) } : {}),
              weight: 1 + r.int(5),
            },
          ]
        : [],
    };
  });
  const locks =
    r.chance(25) && S > 0
      ? [
          {
            staff: `p${r.int(S)}`,
            date: formatDate(first + r.int(D)),
            shift: K === 0 || r.chance(30) ? null : `k${r.int(K)}`,
          },
        ]
      : [];
  const previous =
    r.chance(25) && S > 0
      ? [
          {
            staff: `p${r.int(S)}`,
            date: formatDate(first + r.int(D)),
            shift: K === 0 || r.chance(50) ? null : `k${r.int(K)}`,
          },
        ]
      : [];
  const raw = {
    schema: 'shiftknit/project',
    version: 1,
    name: `random ${seed}`,
    timeZone: tz,
    start,
    days: D,
    skills,
    shifts,
    staff,
    rules: {
      minRestMinutes: r.pick([0, 480, 660, 720]),
      restDay: {
        enabled: r.chance(70),
        count: r.chance(85) ? 1 : 2,
        minMinutes: 1440,
        mode: r.chance(70) ? 'rolling' : 'fixed',
      },
      weekStart: r.chance(70) ? 0 : r.int(7),
    },
    weights: {
      preference: r.int(11),
      fairHours: r.int(3),
      fairWeekend: r.int(6),
      fairNight: r.int(6),
      stability: r.int(4),
      isolatedDayOff: r.int(5),
    },
    locks,
    previous,
  };
  const v = validateProject(raw);
  if (!v.ok)
    throw new Error(
      `generator produced an invalid project (seed ${seed}): ${JSON.stringify(v.errors)}`,
    );
  return v.value;
}
