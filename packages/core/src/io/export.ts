// SPDX-License-Identifier: AGPL-3.0-or-later
// Project / rota JSON, CSV tables and the rest-day table.

import type { Gap } from '../check/types';
import type { Lang } from '../i18n/index';
import { t } from '../i18n/index';
import type { ModelError, Result } from '../model/errors';
import { safeParseJson } from '../model/json';
import type { Project, Roster } from '../model/types';
import { validateProject } from '../model/validate';
import { dayStart, formatDate, parseDate, parseTime, shiftInterval, weekday } from '../time/index';
import { toCsv } from './csv';

/** Pretty JSON of a project, with keys in schema order. */
export function exportProject(p: Project): string {
  return JSON.stringify(p, null, 2) + '\n';
}

/** Parse and validate an untrusted project file. */
export function importProject(text: string): Result<Project> {
  const parsed = safeParseJson(text);
  if (!parsed.ok) return parsed;
  return validateProject(parsed.value);
}

export type { ModelError };

function dates(p: Project): string[] {
  const first = parseDate(p.start) ?? 0;
  return Array.from({ length: p.days }, (_, d) => formatDate(first + d));
}

/** Grid CSV: one row per person, one column per date, cells = shift names. */
export function gridCsv(p: Project, roster: Roster, lang: Lang, bom = true): string {
  const ds = dates(p);
  const shiftName = new Map(p.shifts.map((s) => [s.id, s.name]));
  const cell = new Map<string, string[]>();
  for (const a of roster.assignments) {
    const k = `${a.staff}|${a.date}`;
    cell.set(k, [...(cell.get(k) ?? []), shiftName.get(a.shift) ?? a.shift]);
  }
  const rows = [[t(lang, 'csv.staff'), ...ds]];
  for (const s of p.staff)
    rows.push([s.name, ...ds.map((d) => (cell.get(`${s.id}|${d}`) ?? []).join(' + '))]);
  return toCsv(rows, bom);
}

/** List CSV: one row per assignment with times and worked hours. */
export function listCsv(p: Project, roster: Roster, lang: Lang, bom = true): string {
  const shifts = new Map(p.shifts.map((s) => [s.id, s]));
  const staff = new Map(p.staff.map((s) => [s.id, s]));
  const rows = [
    ['date', 'staff', 'shift', 'start', 'end', 'break', 'worked'].map((k) => t(lang, `csv.${k}`)),
  ];
  const list = [...roster.assignments].sort((a, b) =>
    a.date !== b.date
      ? a.date < b.date
        ? -1
        : 1
      : a.staff < b.staff
        ? -1
        : a.staff > b.staff
          ? 1
          : 0,
  );
  for (const a of list) {
    const sh = shifts.get(a.shift);
    const day = parseDate(a.date);
    if (!sh || day === undefined) continue;
    const iv = shiftInterval(day, parseTime(sh.start) ?? 0, parseTime(sh.end) ?? 0, p.timeZone);
    const worked = iv.end - iv.start - sh.breakMinutes;
    rows.push([
      a.date,
      staff.get(a.staff)?.name ?? a.staff,
      sh.name,
      sh.start,
      sh.end,
      String(sh.breakMinutes),
      (worked / 60).toFixed(2),
    ]);
  }
  return toCsv(rows, bom);
}

/** Gaps as CSV, for managers. */
export function gapsCsv(p: Project, gaps: Gap[], lang: Lang, bom = true): string {
  const name = new Map(p.shifts.map((s) => [s.id, s.name]));
  const rows = [['date', 'shift', 'need', 'have', 'skills'].map((k) => t(lang, `csv.${k}`))];
  for (const g of gaps)
    rows.push([
      g.date,
      name.get(g.shift) ?? g.shift,
      String(g.need),
      String(g.have),
      (g.skills ?? []).join(' + '),
    ]);
  return toCsv(rows, bom);
}

/**
 * Rest-day table: for each person, the calendar days on which they do not work at all
 * (no shift overlaps local 00:00–24:00). Useful for posting rest days in advance.
 */
export function restDayTable(
  p: Project,
  roster: Roster,
): { staff: string; name: string; restDates: string[] }[] {
  const first = parseDate(p.start) ?? 0;
  const shifts = new Map(p.shifts.map((s) => [s.id, s]));
  return p.staff.map((person) => {
    const ivs = roster.assignments
      .filter((a) => a.staff === person.id)
      .flatMap((a) => {
        const sh = shifts.get(a.shift);
        const day = parseDate(a.date);
        return sh && day !== undefined
          ? [shiftInterval(day, parseTime(sh.start) ?? 0, parseTime(sh.end) ?? 0, p.timeZone)]
          : [];
      });
    const restDates: string[] = [];
    for (let d = 0; d < p.days; d++) {
      const a = dayStart(first + d, p.timeZone);
      const b = dayStart(first + d + 1, p.timeZone);
      if (!ivs.some((iv) => iv.start < b && a < iv.end)) restDates.push(formatDate(first + d));
    }
    return { staff: person.id, name: person.name, restDates };
  });
}

export { weekday };
