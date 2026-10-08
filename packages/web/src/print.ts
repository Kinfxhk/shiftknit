// SPDX-License-Identifier: AGPL-3.0-or-later
// Print views: team rota, one page per person, and the rest-day roster (for posting rest
// days in advance). Built with textContent only.

import type { Lang, Project, Roster } from '@shiftknit/core';
import { formatDate, parseDate, restDayTable, weekday, weekdayNames } from '@shiftknit/core';
import { h } from './dom';
import { ui } from './strings';

interface Ctx {
  project: Project;
  roster: Roster;
  lang: Lang;
  version: string;
}

function dates(p: Project): string[] {
  const first = parseDate(p.start) ?? 0;
  return Array.from({ length: p.days }, (_, d) => formatDate(first + d));
}

function wd(lang: Lang, date: string): string {
  return weekdayNames(lang)[weekday(parseDate(date) ?? 0)]!;
}

function header(c: Ctx, title: string): HTMLElement {
  const ds = dates(c.project);
  return h(
    'header',
    {},
    h('h1', {}, `${c.project.name} — ${title}`),
    h('p', {}, `${ds[0]} – ${ds[ds.length - 1]} (${c.project.timeZone})`),
  );
}

function footer(c: Ctx): HTMLElement {
  return h(
    'footer',
    {},
    h('p', {}, ui(c.lang, 'check.note')),
    h('p', {}, ui(c.lang, 'print.generated', { version: c.version })),
  );
}

export function printTeam(host: HTMLElement, c: Ctx): void {
  const ds = dates(c.project);
  const shift = new Map(c.project.shifts.map((s) => [s.id, s]));
  const cell = new Map(c.roster.assignments.map((a) => [`${a.staff}|${a.date}`, a.shift]));
  host.replaceChildren(
    h(
      'section',
      { class: 'print-page' },
      header(c, ui(c.lang, 'rota.title').replace(/^\d+\.\s*/, '')),
      h(
        'table',
        { class: 'print-grid' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', {}, ui(c.lang, 'staff.title')),
            ds.map((d) => h('th', {}, wd(c.lang, d), h('br'), d.slice(5))),
          ),
        ),
        h(
          'tbody',
          {},
          c.project.staff.map((s) =>
            h(
              'tr',
              {},
              h('th', {}, s.name),
              ds.map((d) => {
                const sh = shift.get(cell.get(`${s.id}|${d}`) ?? '');
                return h('td', {}, sh ? sh.name : '—');
              }),
            ),
          ),
        ),
      ),
      h(
        'ul',
        { class: 'legend' },
        c.project.shifts.map((s) => h('li', {}, `${s.name}: ${s.start}–${s.end}`)),
      ),
      footer(c),
    ),
  );
}

export function printStaffPages(host: HTMLElement, c: Ctx): void {
  const shift = new Map(c.project.shifts.map((s) => [s.id, s]));
  host.replaceChildren(
    ...c.project.staff.map((s) => {
      const mine = c.roster.assignments
        .filter((a) => a.staff === s.id)
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      return h(
        'section',
        { class: 'print-page' },
        header(c, s.name),
        h(
          'table',
          { class: 'print-list' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              [
                ui(c.lang, 'print.date'),
                ui(c.lang, 'shifts.name'),
                ui(c.lang, 'shifts.start'),
                ui(c.lang, 'shifts.end'),
              ].map((t) => h('th', {}, t)),
            ),
          ),
          h(
            'tbody',
            {},
            mine.map((a) => {
              const sh = shift.get(a.shift);
              return h(
                'tr',
                {},
                h('td', {}, `${wd(c.lang, a.date)} ${a.date}`),
                h('td', {}, sh?.name ?? a.shift),
                h('td', {}, sh?.start ?? ''),
                h('td', {}, sh?.end ?? ''),
              );
            }),
          ),
        ),
        footer(c),
      );
    }),
  );
}

export function printRestDays(host: HTMLElement, c: Ctx): void {
  const ds = dates(c.project);
  host.replaceChildren(
    h(
      'section',
      { class: 'print-page' },
      header(c, ui(c.lang, 'print.restTitle')),
      h('p', {}, ui(c.lang, 'print.restNote', { from: ds[0]!, to: ds[ds.length - 1]! })),
      h(
        'table',
        { class: 'print-list', id: 'rest-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', {}, ui(c.lang, 'staff.title')),
            h('th', {}, ui(c.lang, 'print.restDays')),
          ),
        ),
        h(
          'tbody',
          {},
          restDayTable(c.project, c.roster).map((r) =>
            h(
              'tr',
              {},
              h('th', {}, r.name),
              h('td', {}, r.restDates.map((d) => `${wd(c.lang, d)} ${d}`).join(', ')),
            ),
          ),
        ),
      ),
      h('p', {}, ui(c.lang, 'setup.restDayNote')),
      footer(c),
    ),
  );
}
