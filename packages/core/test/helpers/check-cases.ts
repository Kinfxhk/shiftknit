// SPDX-License-Identifier: AGPL-3.0-or-later
// Golden checker cases, as data, so the same table can run against mutated checkers.
import type { Assignment, Project, Roster } from '../../src/index';
import { validateProject } from '../../src/index';
import type { CheckReport } from '../../src/check/index';
import { rawProject } from './fixtures';

export interface GoldenCase {
  name: string;
  rule: string;
  project: Project;
  roster: Roster;
  /** Expected sorted list of violated rule ids (with repeats). */
  violations: string[];
  /** Expected shortfall, when the case is about staffing. */
  shortfall?: number;
  /** Expected gap kinds, when relevant. */
  gapKinds?: string[];
}

const SH = (id: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  start,
  end,
  breakMinutes: 0,
  demand: 1,
  ...extra,
});

function proj(over: Record<string, unknown>): Project {
  const r = validateProject(rawProject(over));
  if (!r.ok) throw new Error(`case project invalid: ${JSON.stringify(r.errors)}`);
  return r.value;
}

const A = (staff: string, date: string, shift: string): Assignment => ({ staff, date, shift });

/** One person, rules isolated: no rest-day rule, no rest minimum unless set. */
function solo(over: Record<string, unknown>, staffOver: Record<string, unknown> = {}) {
  return proj({
    skills: [],
    staff: [{ id: 'p', name: 'P', maxConsecutiveDays: 31, ...staffOver }],
    rules: { minRestMinutes: 0, restDay: { enabled: false } },
    ...over,
  });
}

const cases: GoldenCase[] = [];
const add = (
  rule: string,
  name: string,
  project: Project,
  assignments: Assignment[],
  violations: string[],
  extra: Partial<GoldenCase> = {},
) =>
  cases.push({
    rule,
    name,
    project,
    roster: { assignments },
    violations: [...violations].sort(),
    ...extra,
  });

// ---------------- rest (minimum 11 h between shifts) ----------------
{
  const shifts = [
    SH('L', '15:00', '23:00'),
    SH('E10', '10:00', '18:00'),
    SH('E0959', '09:59', '18:00'),
    SH('N', '22:00', '07:00'),
    SH('X18', '18:00', '23:00'),
    SH('X1759', '17:59', '23:00'),
  ];
  const base = { shifts, rules: { minRestMinutes: 660, restDay: { enabled: false } } };
  add(
    'rest',
    'exactly 11 h is enough',
    solo(base),
    [A('p', '2026-11-02', 'L'), A('p', '2026-11-03', 'E10')],
    [],
  );
  add(
    'rest',
    '1 minute short',
    solo(base),
    [A('p', '2026-11-02', 'L'), A('p', '2026-11-03', 'E0959')],
    ['rest'],
  );
  add(
    'rest',
    'after a night shift: 11 h from 07:00',
    solo(base),
    [A('p', '2026-11-02', 'N'), A('p', '2026-11-03', 'X18')],
    [],
  );
  add(
    'rest',
    'after a night shift: 10 h 59 m',
    solo(base),
    [A('p', '2026-11-02', 'N'), A('p', '2026-11-03', 'X1759')],
    ['rest'],
  );
  add(
    'rest',
    'across the week boundary (Sun→Mon)',
    solo({ ...base, days: 14 }),
    [A('p', '2026-11-08', 'L'), A('p', '2026-11-09', 'E0959')],
    ['rest'],
  );
  add(
    'rest',
    'across the month boundary',
    solo({ ...base, start: '2026-10-26', days: 14 }),
    [A('p', '2026-10-31', 'L'), A('p', '2026-11-01', 'E0959')],
    ['rest'],
  );
  const london = { ...base, timeZone: 'Europe/London', start: '2026-10-19', days: 14 };
  add(
    'rest',
    'DST fall back: night ends 07:00 GMT, 11 h later',
    solo(london),
    [A('p', '2026-10-24', 'N'), A('p', '2026-10-25', 'X18')],
    [],
  );
  const spring = { ...base, timeZone: 'Europe/London', start: '2026-03-23', days: 14 };
  add(
    'rest',
    'DST spring forward: 10 h 59 m',
    solo(spring),
    [A('p', '2026-03-28', 'N'), A('p', '2026-03-29', 'X1759')],
    ['rest'],
  );
}
// ---------------- overlap ----------------
{
  const shifts = [
    SH('D', '09:00', '17:00'),
    SH('O', '16:00', '20:00'),
    SH('T', '17:00', '21:00'),
    SH('N', '22:00', '07:00'),
    SH('M', '06:00', '10:00'),
  ];
  add(
    'overlap',
    'two shifts overlapping by an hour',
    solo({ shifts }),
    [A('p', '2026-11-02', 'D'), A('p', '2026-11-02', 'O')],
    ['overlap'],
  );
  add(
    'overlap',
    'touching shifts do not overlap',
    solo({ shifts }),
    [A('p', '2026-11-02', 'D'), A('p', '2026-11-02', 'T')],
    [],
  );
  add(
    'overlap',
    "overnight shift overlaps next morning's shift",
    solo({ shifts }),
    [A('p', '2026-11-02', 'N'), A('p', '2026-11-03', 'M')],
    ['overlap'],
  );
  add(
    'overlap',
    'overnight shift and a later morning shift are fine',
    solo({ shifts }),
    [A('p', '2026-11-02', 'N'), A('p', '2026-11-04', 'M')],
    [],
  );
  add(
    'overlap',
    'overlap across the month boundary',
    solo({ shifts, start: '2026-10-26', days: 14 }),
    [A('p', '2026-10-31', 'N'), A('p', '2026-11-01', 'M')],
    ['overlap'],
  );
  add(
    'overlap',
    'touching shifts with an 11 h rest rule are a rest problem, not overlap',
    solo({ shifts, rules: { minRestMinutes: 660, restDay: { enabled: false } } }),
    [A('p', '2026-11-02', 'D'), A('p', '2026-11-02', 'T')],
    ['rest'],
  );
}

// ---------------- availability ----------------
{
  const shifts = [SH('E', '07:00', '15:00'), SH('N', '22:00', '07:00'), SH('M2', '02:00', '06:00')];
  const win = (days: number[], from: string, to: string) => ({ days, from, to });
  add(
    'availability',
    'shift exactly fills the window',
    solo({ shifts }, { availability: [win([0], '07:00', '15:00')] }),
    [A('p', '2026-11-02', 'E')],
    [],
  );
  add(
    'availability',
    'window starts 1 minute late',
    solo({ shifts }, { availability: [win([0], '07:01', '15:00')] }),
    [A('p', '2026-11-02', 'E')],
    ['availability'],
  );
  add(
    'availability',
    'overnight window covers an overnight shift',
    solo({ shifts }, { availability: [win([0], '22:00', '07:00')] }),
    [A('p', '2026-11-02', 'N')],
    [],
  );
  add(
    'availability',
    'overnight window ends 1 minute early',
    solo({ shifts }, { availability: [win([0], '22:00', '06:59')] }),
    [A('p', '2026-11-02', 'N')],
    ['availability'],
  );
  add(
    'availability',
    'two whole days join across midnight',
    solo({ shifts }, { availability: [win([0, 1], '00:00', '24:00')] }),
    [A('p', '2026-11-02', 'N')],
    [],
  );
  add(
    'availability',
    'Sunday night into Monday (week boundary)',
    solo({ shifts, days: 14 }, { availability: [win([6], '20:00', '08:00')] }),
    [A('p', '2026-11-08', 'N')],
    [],
  );
  add(
    'availability',
    "early shift inside the previous evening's window",
    solo({ shifts }, { availability: [win([0], '22:00', '07:00')] }),
    [A('p', '2026-11-03', 'M2')],
    [],
  );
  add(
    'availability',
    'not available on that weekday',
    solo({ shifts }, { availability: [win([1, 2, 3, 4, 5, 6], '00:00', '24:00')] }),
    [A('p', '2026-11-02', 'E')],
    ['availability'],
  );
  add(
    'availability',
    'across the month boundary',
    solo({ shifts, start: '2026-10-26', days: 14 }, { availability: [win([5], '22:00', '07:00')] }),
    [A('p', '2026-10-31', 'N')],
    [],
  );
}

// ---------------- leave ----------------
{
  const shifts = [
    SH('E', '07:00', '15:00'),
    SH('N', '22:00', '07:00'),
    SH('Z', '16:00', '00:00'),
    SH('M', '00:00', '08:00'),
  ];
  add(
    'leave',
    'shift on a leave day',
    solo({ shifts }, { leave: ['2026-11-03'] }),
    [A('p', '2026-11-03', 'E')],
    ['leave'],
  );
  add(
    'leave',
    'night shift running into a leave day',
    solo({ shifts }, { leave: ['2026-11-03'] }),
    [A('p', '2026-11-02', 'N')],
    ['leave'],
  );
  add(
    'leave',
    'shift ending exactly at midnight before leave',
    solo({ shifts }, { leave: ['2026-11-03'] }),
    [A('p', '2026-11-02', 'Z')],
    [],
  );
  add(
    'leave',
    'shift starting at midnight after leave',
    solo({ shifts }, { leave: ['2026-11-03'] }),
    [A('p', '2026-11-04', 'M')],
    [],
  );
  add(
    'leave',
    'leave on the first of the month',
    solo({ shifts, start: '2026-10-26', days: 14 }, { leave: ['2026-11-01'] }),
    [A('p', '2026-10-31', 'N')],
    ['leave'],
  );
  add(
    'leave',
    'leave on another day is fine',
    solo({ shifts }, { leave: ['2026-11-05'] }),
    [A('p', '2026-11-03', 'E')],
    [],
  );
}

// ---------------- weekly hours ----------------
{
  const shifts = [SH('D', '09:00', '17:00'), SH('D1', '09:00', '17:01'), SH('N', '22:00', '07:00')];
  const five = (shift: string, from = 2) =>
    [0, 1, 2, 3, 4].map((i) =>
      A('p', `2026-11-${String(from + i).padStart(2, '0')}`, i === 4 ? shift : 'D'),
    );
  add('weeklyMax', '40 h exactly', solo({ shifts }, { maxWeeklyMinutes: 2400 }), five('D'), []);
  add('weeklyMax', '40 h 1 m', solo({ shifts }, { maxWeeklyMinutes: 2400 }), five('D1'), [
    'weeklyMax',
  ]);
  const split = [
    A('p', '2026-11-06', 'D'),
    A('p', '2026-11-07', 'D'),
    A('p', '2026-11-08', 'D'),
    A('p', '2026-11-09', 'D'),
    A('p', '2026-11-10', 'D'),
  ];
  add(
    'weeklyMax',
    'Monday weeks split the hours',
    solo({ shifts, days: 14 }, { maxWeeklyMinutes: 1440 }),
    split,
    [],
  );
  add(
    'weeklyMax',
    'Wednesday weeks put them together',
    solo(
      { shifts, days: 14, rules: { minRestMinutes: 0, restDay: { enabled: false }, weekStart: 2 } },
      { maxWeeklyMinutes: 1440 },
    ),
    split,
    ['weeklyMax'],
  );
  add(
    'weeklyMax',
    'DST fall back: night shift is 10 real hours',
    solo(
      { shifts, timeZone: 'Europe/London', start: '2026-10-19', days: 14 },
      { maxWeeklyMinutes: 599 },
    ),
    [A('p', '2026-10-24', 'N')],
    ['weeklyMax'],
  );
  add(
    'weeklyMax',
    'same night shift in Hong Kong is 9 hours',
    solo({ shifts, start: '2026-10-19', days: 14 }, { maxWeeklyMinutes: 540 }),
    [A('p', '2026-10-24', 'N')],
    [],
  );
  add(
    'weeklyMax',
    'week across the month boundary',
    solo({ shifts, start: '2026-10-26', days: 14 }, { maxWeeklyMinutes: 960 }),
    [A('p', '2026-10-30', 'D'), A('p', '2026-10-31', 'D'), A('p', '2026-11-01', 'D')],
    ['weeklyMax'],
  );
  add(
    'weeklyMin',
    'minimum met exactly',
    solo({ shifts }, { minWeeklyMinutes: 480 }),
    [A('p', '2026-11-03', 'D')],
    [],
  );
  add(
    'weeklyMin',
    'one minute short',
    solo({ shifts }, { minWeeklyMinutes: 481 }),
    [A('p', '2026-11-03', 'D')],
    ['weeklyMin'],
  );
  add(
    'weeklyMin',
    'partial weeks at the edges are not checked',
    solo({ shifts, start: '2026-11-04', days: 7 }, { minWeeklyMinutes: 481 }),
    [A('p', '2026-11-05', 'D')],
    [],
  );
}

// ---------------- consecutive days ----------------
{
  const shifts = [SH('D', '09:00', '17:00'), SH('N', '22:00', '07:00')];
  const run = (n: number, start = 2, shift = 'D', month = '11') =>
    Array.from({ length: n }, (_, i) =>
      A('p', `2026-${month}-${String(start + i).padStart(2, '0')}`, shift),
    );
  add(
    'consecutive',
    '3 days with a limit of 3',
    solo({ shifts }, { maxConsecutiveDays: 3 }),
    run(3),
    [],
  );
  add(
    'consecutive',
    '4 days with a limit of 3',
    solo({ shifts }, { maxConsecutiveDays: 3 }),
    run(4),
    ['consecutive'],
  );
  add(
    'consecutive',
    'night shifts count by start day',
    solo({ shifts }, { maxConsecutiveDays: 3 }),
    run(3, 2, 'N'),
    [],
  );
  add(
    'consecutive',
    'run across the week boundary',
    solo({ shifts, days: 14 }, { maxConsecutiveDays: 3 }),
    run(4, 7),
    ['consecutive'],
  );
  add(
    'consecutive',
    'run across the month boundary',
    solo({ shifts, start: '2026-10-26', days: 14 }, { maxConsecutiveDays: 3 }),
    [...run(2, 30, 'D', '10'), ...run(2, 1)],
    ['consecutive'],
  );
  add(
    'consecutive',
    'a day off resets the count',
    solo({ shifts }, { maxConsecutiveDays: 3 }),
    [...run(3, 2), ...run(3, 6)],
    [],
  );
}

// ---------------- rest days (continuous 24 h) ----------------
{
  const shifts = [
    SH('A', '08:00', '16:00'),
    SH('B', '16:00', '23:00'),
    SH('B1', '15:59', '23:00'),
    SH('N', '22:00', '07:00'),
    SH('M', '06:00', '14:00'),
    SH('D', '09:00', '17:00'),
  ];
  const rd = (extra: Record<string, unknown> = {}) => ({
    enabled: true,
    count: 1,
    minMinutes: 1440,
    mode: 'rolling',
    ...extra,
  });
  const base = (over: Record<string, unknown> = {}) =>
    solo({ shifts, rules: { minRestMinutes: 0, restDay: rd() }, ...over });
  const day = (i: number, s: string, start = '2026-11-02') => {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return A('p', d.toISOString().slice(0, 10), s);
  };
  const exact = [
    day(0, 'A'),
    day(1, 'A'),
    day(2, 'A'),
    day(3, 'B'),
    day(4, 'A'),
    day(5, 'A'),
    day(6, 'A'),
  ];
  add('restDay', 'exactly 24 h 00 m off (shift every calendar day)', base(), exact, []);
  add(
    'restDay',
    '23 h 59 m off',
    base(),
    exact.map((a) => (a.shift === 'B' ? { ...a, shift: 'B1' } : a)),
    ['restDay'],
  );
  add(
    'restDay',
    'a calendar day off is not 24 h after a night shift',
    base(),
    [day(0, 'N'), day(1, 'N'), day(2, 'N'), day(4, 'M'), day(5, 'M'), day(6, 'M')],
    ['restDay'],
  );
  add(
    'restDay',
    'Sunday off (normal week)',
    base(),
    [0, 1, 2, 3, 4, 5].map((i) => day(i, 'D')),
    [],
  );
  add(
    'restDay',
    'window across the month and week boundary',
    base({ start: '2026-10-28', days: 7 }),
    [0, 1, 2, 3, 4, 5, 6].map((i) => day(i, 'D', '2026-10-28')),
    ['restDay'],
  );
  const fortnight = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => day(i, 'D'));
  add('restDay', 'rolling 7-day windows catch a long stretch', base({ days: 14 }), fortnight, [
    'restDay',
    'restDay',
    'restDay',
    'restDay',
    'restDay',
    'restDay',
  ]);
  add(
    'restDay',
    'fixed 7-day blocks allow the same stretch',
    base({ days: 14, rules: { minRestMinutes: 0, restDay: rd({ mode: 'fixed' }) } }),
    fortnight,
    [],
  );
  const two = (gapShift: string) => [
    day(0, 'D'),
    day(1, 'D'),
    day(2, 'D'),
    day(3, 'D'),
    day(4, 'A'),
    day(6, gapShift),
  ];
  // count 2: day 4 A ends 16:00; day 6 at 16:00 → 48 h; 15:59 → 47 h 59 m (plus 8 h at the start: not 24 h).
  add(
    'restDay',
    'two rest days from one 48 h break',
    base({ rules: { minRestMinutes: 0, restDay: rd({ count: 2 }) } }),
    two('B'),
    [],
  );
  add(
    'restDay',
    'two rest days need 48 h, not 47 h 59 m',
    base({ rules: { minRestMinutes: 0, restDay: rd({ count: 2 }) } }),
    two('B1'),
    ['restDay'],
  );
  add(
    'restDay',
    'periods shorter than 7 days are not checked',
    base({ days: 6 }),
    [0, 1, 2, 3, 4, 5].map((i) => day(i, 'D')),
    [],
  );
}

// ---------------- staffing, skills, locks ----------------
{
  const shifts = [
    SH('E', '07:00', '15:00', {
      demand: 1,
      skillDemand: [{ skills: ['firstaid', 'senior'], min: 1 }],
    }),
  ];
  const team = (over: Record<string, unknown> = {}) =>
    proj({
      start: '2026-11-02',
      days: 1,
      skills: ['firstaid', 'senior'],
      shifts,
      staff: [
        { id: 'a', name: 'A', skills: ['firstaid'] },
        { id: 'b', name: 'B', skills: ['firstaid', 'senior'] },
      ],
      rules: { minRestMinutes: 0, restDay: { enabled: false } },
      ...over,
    });
  add('overstaffed', 'demand met exactly', team(), [A('b', '2026-11-02', 'E')], [], {
    shortfall: 0,
  });
  add(
    'overstaffed',
    'one person too many',
    team(),
    [A('a', '2026-11-02', 'E'), A('b', '2026-11-02', 'E')],
    ['overstaffed'],
    { shortfall: 0 },
  );
  add(
    'skill',
    'needs BOTH skills: first-aid alone is not enough',
    team(),
    [A('a', '2026-11-02', 'E')],
    [],
    { shortfall: 1, gapKinds: ['skill'] },
  );
  add('skill', 'nobody assigned: staff and skill gaps', team(), [], [], {
    shortfall: 2,
    gapKinds: ['skill', 'staff'],
  });
  add(
    'lock',
    'locked shift present',
    team({ locks: [{ staff: 'b', date: '2026-11-02', shift: 'E' }] }),
    [A('b', '2026-11-02', 'E')],
    [],
  );
  add(
    'lock',
    'locked shift missing',
    team({ locks: [{ staff: 'b', date: '2026-11-02', shift: 'E' }] }),
    [A('a', '2026-11-02', 'E')],
    ['lock'],
    { shortfall: 1 },
  );
  add(
    'lock',
    'locked day off but assigned',
    team({ locks: [{ staff: 'b', date: '2026-11-02', shift: null }] }),
    [A('b', '2026-11-02', 'E')],
    ['lock'],
  );
  add(
    'structure',
    'duplicate assignment and date outside the period',
    team(),
    [A('b', '2026-11-02', 'E'), A('b', '2026-11-02', 'E'), A('a', '2026-11-09', 'E')],
    ['structure', 'structure'],
  );
}

export const GOLDEN_CASES = cases;

export type CheckFn = (p: Project, r: Roster) => CheckReport;

/** Run every case; returns the names of cases whose outcome differs. */
export function runGolden(check: CheckFn): string[] {
  const failed: string[] = [];
  for (const c of cases) {
    let rep: CheckReport;
    try {
      rep = check(c.project, c.roster);
    } catch {
      failed.push(c.name);
      continue;
    }
    const got = rep.violations.map((v) => v.rule).sort();
    let ok = JSON.stringify(got) === JSON.stringify(c.violations);
    if (c.shortfall !== undefined && rep.shortfall !== c.shortfall) ok = false;
    if (
      c.gapKinds &&
      JSON.stringify(rep.gaps.map((g) => g.kind).sort()) !== JSON.stringify(c.gapKinds)
    )
      ok = false;
    if (!ok) failed.push(c.name);
  }
  return failed;
}
