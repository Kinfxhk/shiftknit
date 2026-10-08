// SPDX-License-Identifier: AGPL-3.0-or-later
// Worked hours per person per week (break excluded), using the same week boundaries as the
// checker's weekly-hours rule: weeks start on rules.weekStart and a shift counts in the week
// of the date it starts on. Weeks are clipped to the period.

import type { Lang } from '../i18n/index';
import type { Project, Roster } from '../model/types';
import { formatDate, parseDate, parseTime, shiftInterval, weekday } from '../time/index';
import { toCsv } from '../io/csv';
import { st } from './labels';

export interface HoursRow {
  staff: string;
  name: string;
  /** Worked minutes in each week of `weeks`. */
  minutes: number[];
  total: number;
  shifts: number;
}

export interface HoursTable {
  /** First day of each (clipped) week inside the period. */
  weeks: string[];
  rows: HoursRow[];
}

export function weeklyHours(project: Project, roster: Roster): HoursTable {
  const first = parseDate(project.start) ?? 0;
  const last = first + project.days - 1;
  const anchor = first - ((weekday(first) - project.rules.weekStart + 7) % 7);
  const nWeeks = Math.floor((last - anchor) / 7) + 1;
  const weeks = Array.from({ length: nWeeks }, (_, w) =>
    formatDate(Math.max(first, anchor + 7 * w)),
  );
  const shifts = new Map(project.shifts.map((s) => [s.id, s]));
  const rows = new Map<string, HoursRow>(
    project.staff.map((s) => [
      s.id,
      { staff: s.id, name: s.name, minutes: weeks.map(() => 0), total: 0, shifts: 0 },
    ]),
  );
  const seen = new Set<string>();
  for (const a of roster.assignments) {
    const row = rows.get(a.staff);
    const sh = shifts.get(a.shift);
    const day = parseDate(a.date);
    const key = `${a.staff}|${a.date}|${a.shift}`;
    if (!row || !sh || day === undefined || day < first || day > last || seen.has(key)) continue;
    seen.add(key);
    const iv = shiftInterval(
      day,
      parseTime(sh.start) ?? 0,
      parseTime(sh.end) ?? 0,
      project.timeZone,
    );
    const worked = iv.end - iv.start - sh.breakMinutes;
    const w = Math.floor((day - anchor) / 7);
    row.minutes[w]! += worked;
    row.total += worked;
    row.shifts++;
  }
  return { weeks, rows: [...rows.values()] };
}

const h2 = (m: number) => (Math.round((m / 60) * 100) / 100).toString();

/** CSV: person, hours per week…, total hours, number of shifts. */
export function hoursCsv(lang: Lang, project: Project, roster: Roster, bom = true): string {
  const t = weeklyHours(project, roster);
  return toCsv(
    [
      [
        st(lang, 'hours.person'),
        ...t.weeks.map((d) => st(lang, 'hours.week', { date: d })),
        st(lang, 'hours.total'),
        st(lang, 'hours.shifts'),
      ],
      ...t.rows.map((r) => [r.name, ...r.minutes.map(h2), h2(r.total), String(r.shifts)]),
    ],
    bom,
  );
}
