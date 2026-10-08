// SPDX-License-Identifier: AGPL-3.0-or-later
// Turn checker output into sentences, using staff and shift names (plain text only).
import type { Gap, Violation } from '../check/types';
import type { Unit } from '../explain/index';
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

/** Weekday short names, Monday first. */
export function weekdayNames(lang: Lang): string[] {
  return t(lang, 'weekday.short').split(',');
}

export function describeUnit(
  lang: Lang,
  u: Unit,
  p: Project,
  goal: 'coverage' | 'noRota' = 'coverage',
): string {
  const staffName = (id: string) => p.staff.find((s) => s.id === id)?.name ?? id;
  const shift = (id: string) => p.shifts.find((s) => s.id === id);
  const wd = (date: string) => {
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  };
  switch (u.type) {
    case 'need': {
      const sh = shift(u.shift);
      const n = sh?.demand[wd(u.date)] ?? 0;
      return t(lang, goal === 'noRota' || n === 0 ? 'unit.needCap' : 'unit.need', {
        shift: sh?.name ?? u.shift,
        date: u.date,
        n,
      });
    }
    case 'skill': {
      const sh = shift(u.shift);
      const r = sh?.skillDemand[u.index];
      return t(lang, 'unit.skill', {
        shift: sh?.name ?? u.shift,
        date: u.date,
        n: r?.min ?? 0,
        skills: (r?.skills ?? []).join(lang === 'en' ? ' + ' : '＋'),
      });
    }
    case 'availability': {
      const person = p.staff.find((s) => s.id === u.staff);
      const names = weekdayNames(lang);
      const windows = (person?.availability ?? [])
        .map(
          (w) =>
            `${w.days.map((d) => names[d]).join(lang === 'en' ? ', ' : '、')} ${w.from}–${w.to}`,
        )
        .join(lang === 'en' ? '; ' : '；');
      return t(lang, 'unit.availability', { staff: staffName(u.staff), windows });
    }
    case 'leave':
      return t(lang, 'unit.leave', { staff: staffName(u.staff), date: u.date });
    case 'maxWeekly':
    case 'minWeekly': {
      const person = p.staff.find((s) => s.id === u.staff);
      const m =
        u.type === 'maxWeekly' ? (person?.maxWeeklyMinutes ?? 0) : (person?.minWeeklyMinutes ?? 0);
      return t(lang, `unit.${u.type}`, { staff: staffName(u.staff), h: formatMinutes(lang, m) });
    }
    case 'maxConsecutive':
      return t(lang, 'unit.maxConsecutive', {
        staff: staffName(u.staff),
        n: p.staff.find((s) => s.id === u.staff)?.maxConsecutiveDays ?? 0,
      });
    case 'lock': {
      const l = p.locks.find((x) => x.staff === u.staff && x.date === u.date);
      if (!l || l.shift === null)
        return t(lang, 'unit.lockOff', { staff: staffName(u.staff), date: u.date });
      return t(lang, 'unit.lock', {
        staff: staffName(u.staff),
        date: u.date,
        shift: shift(l.shift)?.name ?? l.shift,
      });
    }
    case 'minRest':
      return t(lang, 'unit.minRest', { h: formatMinutes(lang, p.rules.minRestMinutes) });
    case 'restDay':
      return t(lang, 'unit.restDay', {
        n: p.rules.restDay.count,
        h: formatMinutes(lang, p.rules.restDay.minMinutes),
        mode: t(lang, `mode.${p.rules.restDay.mode}`),
      });
  }
}
