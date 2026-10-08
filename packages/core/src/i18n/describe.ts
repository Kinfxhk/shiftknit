// SPDX-License-Identifier: AGPL-3.0-or-later
// Turn checker output into sentences, using staff and shift names (plain text only).
import type { Gap, Violation } from '../check/types';
import type { Project } from '../model/types';
import type { Lang } from './index';
import { t } from './index';

export function formatMinutes(lang: Lang, minutes: number): string {
  const sign = minutes < 0 ? '-' : '';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return sign + (m === 0 ? t(lang, 'unit.h', { h }) : t(lang, 'unit.hm', { h, m }));
}

const MINUTE_RULES = new Set(['rest', 'weeklyMax', 'weeklyMin']);

export function describeViolation(lang: Lang, v: Violation, p: Project): string {
  const staff = p.staff.find((s) => s.id === v.staff)?.name ?? v.staff ?? '';
  const shift = p.shifts.find((s) => s.id === v.shift)?.name ?? v.shift ?? '';
  const otherShift = p.shifts.find((s) => s.id === v.otherShift)?.name ?? v.otherShift ?? '';
  const fmt = (n: number | undefined) =>
    n === undefined ? '' : MINUTE_RULES.has(v.rule) ? formatMinutes(lang, n) : String(n);
  const key =
    v.rule === 'lock' && v.shift === undefined ? 'violation.lockOff' : `violation.${v.rule}`;
  return t(lang, key, {
    staff,
    shift,
    otherShift,
    date: v.date ?? '',
    otherDate: v.otherDate ?? '',
    value: fmt(v.value),
    limit: fmt(v.limit),
    restLength: formatMinutes(lang, p.rules.restDay.minMinutes),
  });
}

export function describeGap(lang: Lang, g: Gap, p: Project): string {
  const shift = p.shifts.find((s) => s.id === g.shift)?.name ?? g.shift;
  const skills = (g.skills ?? []).join(lang === 'en' ? ' + ' : '＋');
  return t(lang, `gap.${g.kind}`, { shift, date: g.date, need: g.need, have: g.have, skills });
}
