// SPDX-License-Identifier: AGPL-3.0-or-later
// Differences between two rotas, cell by cell (person × date). Used for the change list
// after a rota is published again. `applyChanges(a, diffRosters(a, b))` gives back b's
// cells exactly (tested with random rotas).

import type { Lang } from '../i18n/index';
import type { Assignment, Project, Roster } from '../model/types';
import { toCsv } from '../io/csv';
import { st } from './labels';

export interface RosterChange {
  staff: string;
  date: string;
  /** Shift ids before (sorted; empty = off). */
  before: string[];
  /** Shift ids after (sorted; empty = off). */
  after: string[];
}

function cells(r: Roster): Map<string, string[]> {
  const m = new Map<string, Set<string>>();
  for (const a of r.assignments) {
    const k = `${a.staff}\u0000${a.date}`;
    let s = m.get(k);
    if (!s) m.set(k, (s = new Set()));
    s.add(a.shift);
  }
  return new Map([...m].map(([k, s]) => [k, [...s].sort()]));
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Every person-date cell whose set of shifts differs, sorted by date then person. */
export function diffRosters(before: Roster, after: Roster): RosterChange[] {
  const a = cells(before);
  const b = cells(after);
  const keys = new Set([...a.keys(), ...b.keys()]);
  const out: RosterChange[] = [];
  for (const k of keys) {
    const x = a.get(k) ?? [];
    const y = b.get(k) ?? [];
    if (same(x, y)) continue;
    const [staff, date] = k.split('\u0000') as [string, string];
    out.push({ staff, date, before: x, after: y });
  }
  return out.sort((p, q) =>
    p.date < q.date ? -1 : p.date > q.date ? 1 : p.staff < q.staff ? -1 : p.staff > q.staff ? 1 : 0,
  );
}

/** Replace the changed cells of `base` with their "after" shifts. */
export function applyChanges(base: Roster, changes: RosterChange[]): Roster {
  const changed = new Set(changes.map((c) => `${c.staff}\u0000${c.date}`));
  const kept = base.assignments.filter((a) => !changed.has(`${a.staff}\u0000${a.date}`));
  const added: Assignment[] = changes.flatMap((c) =>
    c.after.map((shift) => ({ staff: c.staff, date: c.date, shift })),
  );
  return { assignments: [...kept, ...added] };
}

function names(p: Project): { staff: Map<string, string>; shift: Map<string, string> } {
  return {
    staff: new Map(p.staff.map((s) => [s.id, s.name])),
    shift: new Map(p.shifts.map((s) => [s.id, s.name])),
  };
}

/** One readable line per change, e.g. "Ada, 2026-11-03: Opening → off". */
export function describeChange(lang: Lang, p: Project, c: RosterChange): string {
  const n = names(p);
  const show = (ids: string[]) =>
    ids.length ? ids.map((id) => n.shift.get(id) ?? id).join(' + ') : st(lang, 'share.off');
  return st(lang, 'share.change', {
    name: n.staff.get(c.staff) ?? c.staff,
    date: c.date,
    before: show(c.before),
    after: show(c.after),
  });
}

/** CSV of changes: date, person, before, after. */
export function changesCsv(lang: Lang, p: Project, changes: RosterChange[], bom = true): string {
  const n = names(p);
  const show = (ids: string[]) =>
    ids.length ? ids.map((id) => n.shift.get(id) ?? id).join(' + ') : st(lang, 'share.off');
  const head =
    lang === 'zh-HK' ? ['日期', '員工', '原本', '改為'] : ['Date', 'Person', 'Before', 'After'];
  return toCsv(
    [
      head,
      ...changes.map((c) => [
        c.date,
        n.staff.get(c.staff) ?? c.staff,
        show(c.before),
        show(c.after),
      ]),
    ],
    bom,
  );
}
