// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Independent rule checker. Input: a project and a roster. Output: every broken hard
// rule (with person, date and numbers), every staffing gap, and the soft-penalty score.
//
// This module is deliberately simple and direct: it recomputes everything from the raw
// project and must NOT import the solver (ESLint + the hygiene script enforce this). The
// solver has its own incremental logic; tests compare the two on every output.

import type { Assignment, Project, Roster, Shift, Staff } from '../model/types';
import {
  dayStart,
  formatDate,
  parseDate,
  parseTime,
  shiftInterval,
  weekday,
  zonedInstant,
} from '../time/index';
import type { Interval } from '../time/index';
import type { CheckReport, Gap, Penalty, Violation } from './types';

interface Placed {
  day: number;
  shift: Shift;
  iv: Interval;
  worked: number;
}

/** Real interval of `shift` starting on calendar `day`. */
function intervalOf(shift: Shift, day: number, tz: string): Interval {
  return shiftInterval(day, parseTime(shift.start) ?? 0, parseTime(shift.end) ?? 0, tz);
}

/** Merge overlapping or touching intervals (input need not be sorted). */
function merge(list: Interval[]): Interval[] {
  const s = [...list].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const iv of s) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else out.push({ ...iv });
  }
  return out;
}

/** Real availability intervals of a person around `day` (windows starting day-1 … day+1). */
function availabilityAround(person: Staff, day: number, tz: string): Interval[] {
  const list: Interval[] = [];
  for (let d = day - 1; d <= day + 1; d++)
    for (const w of person.availability) {
      if (!w.days.includes(weekday(d))) continue;
      const from = parseTime(w.from) ?? 0;
      const to = parseTime(w.to, true) ?? 0;
      const start = zonedInstant(d, from, tz);
      const end = to === 1440 ? dayStart(d + 1, tz) : zonedInstant(to <= from ? d + 1 : d, to, tz);
      list.push({ start, end });
    }
  return merge(list);
}

/** Number of separate rest periods of `minMinutes` inside `win`, given busy intervals.
 * A gap of 2 × minMinutes counts as two rest days. */
function countRestPeriods(busy: Interval[], win: Interval, minMinutes: number): number {
  let n = 0;
  let cursor = win.start;
  for (const b of busy) {
    const s = Math.max(b.start, win.start);
    const e = Math.min(b.end, win.end);
    if (e <= s) continue;
    if (s > cursor) n += Math.floor((s - cursor) / minMinutes);
    cursor = Math.max(cursor, e);
  }
  if (win.end > cursor) n += Math.floor((win.end - cursor) / minMinutes);
  return n;
}

/** Spread (max − min) of a list of numbers; 0 for an empty list. */
function spread(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.max(...values) - Math.min(...values);
}

export function checkRoster(project: Project, roster: Roster): CheckReport {
  const tz = project.timeZone;
  const first = parseDate(project.start) ?? 0;
  const last = first + project.days - 1;
  const shiftById = new Map(project.shifts.map((s) => [s.id, s]));
  const staffById = new Map(project.staff.map((s) => [s.id, s]));
  const violations: Violation[] = [];

  // ---- Structure: unknown ids, dates outside the period, duplicates. -------------------
  const placedBy = new Map<string, Placed[]>(project.staff.map((s) => [s.id, []]));
  const seen = new Set<string>();
  const kept: Assignment[] = [];
  for (const a of roster.assignments) {
    const day = parseDate(a.date);
    const shift = shiftById.get(a.shift);
    const key = `${a.staff}|${a.date}|${a.shift}`;
    if (!staffById.has(a.staff) || !shift || day === undefined || day < first || day > last) {
      violations.push({ rule: 'structure', staff: a.staff, date: a.date, shift: a.shift });
      continue;
    }
    if (seen.has(key)) {
      violations.push({
        rule: 'structure',
        staff: a.staff,
        date: a.date,
        shift: a.shift,
        value: 2,
      });
      continue;
    }
    seen.add(key);
    kept.push(a);
    const iv = intervalOf(shift, day, tz);
    placedBy.get(a.staff)!.push({ day, shift, iv, worked: iv.end - iv.start - shift.breakMinutes });
  }

  // ---- Per-person rules. -------------------------------------------------------------
  const anchor = first - ((weekday(first) - project.rules.weekStart + 7) % 7);
  for (const person of project.staff) {
    const placed = placedBy.get(person.id)!;
    placed.sort((x, y) => x.iv.start - y.iv.start || (x.shift.id < y.shift.id ? -1 : 1));

    // 1. Availability windows.
    if (person.availability.length > 0)
      for (const p of placed) {
        const avail = availabilityAround(person, p.day, tz);
        if (!avail.some((w) => w.start <= p.iv.start && p.iv.end <= w.end))
          violations.push({
            rule: 'availability',
            staff: person.id,
            date: formatDate(p.day),
            shift: p.shift.id,
          });
      }

    // 1b. Leave: no shift may overlap a leave day.
    for (const ld of person.leave) {
      const lday = parseDate(ld);
      if (lday === undefined) continue;
      const lv = { start: dayStart(lday, tz), end: dayStart(lday + 1, tz) };
      for (const p of placed)
        if (p.iv.start < lv.end && lv.start < p.iv.end)
          violations.push({
            rule: 'leave',
            staff: person.id,
            date: formatDate(p.day),
            shift: p.shift.id,
            otherDate: ld,
          });
    }

    // 2. Overlap and 3. minimum rest, between consecutive shifts in time order.
    for (let i = 1; i < placed.length; i++) {
      const prev = placed[i - 1]!;
      const next = placed[i]!;
      const gap = next.iv.start - prev.iv.end;
      const common = {
        staff: person.id,
        date: formatDate(next.day),
        shift: next.shift.id,
        otherDate: formatDate(prev.day),
        otherShift: prev.shift.id,
      };
      if (next.iv.start < prev.iv.end) violations.push({ rule: 'overlap', ...common });
      else if (gap < project.rules.minRestMinutes)
        violations.push({
          rule: 'rest',
          ...common,
          value: gap,
          limit: project.rules.minRestMinutes,
        });
    }

    // 4. Weekly worked minutes (week of the shift's start date).
    const weekly = new Map<number, number>();
    for (const p of placed) {
      const w = Math.floor((p.day - anchor) / 7);
      weekly.set(w, (weekly.get(w) ?? 0) + p.worked);
    }
    for (let w = 0; anchor + 7 * w <= last; w++) {
      const startDay = anchor + 7 * w;
      const minutes = weekly.get(w) ?? 0;
      if (minutes > person.maxWeeklyMinutes)
        violations.push({
          rule: 'weeklyMax',
          staff: person.id,
          date: formatDate(Math.max(startDay, first)),
          value: minutes,
          limit: person.maxWeeklyMinutes,
        });
      const fullWeek = startDay >= first && startDay + 6 <= last;
      if (fullWeek && minutes < person.minWeeklyMinutes)
        violations.push({
          rule: 'weeklyMin',
          staff: person.id,
          date: formatDate(startDay),
          value: minutes,
          limit: person.minWeeklyMinutes,
        });
    }

    // 5. Consecutive working days (a day counts when a shift starts on it).
    const startDays = new Set(placed.map((p) => p.day));
    let run = 0;
    for (let d = first; d <= last; d++) {
      run = startDays.has(d) ? run + 1 : 0;
      if (run > person.maxConsecutiveDays)
        violations.push({
          rule: 'consecutive',
          staff: person.id,
          date: formatDate(d),
          value: run,
          limit: person.maxConsecutiveDays,
        });
    }

    // 6. Rest days: in each 7-day period, `count` continuous rest periods of minMinutes.
    const rule = project.rules.restDay;
    if (rule.enabled && project.days >= 7) {
      const busy = merge(placed.map((p) => p.iv));
      const step = rule.mode === 'fixed' ? 7 : 1;
      for (let k = 0; k + 7 <= project.days; k += step) {
        const win = { start: dayStart(first + k, tz), end: dayStart(first + k + 7, tz) };
        const restDays = countRestPeriods(busy, win, rule.minMinutes);
        if (restDays < rule.count)
          violations.push({
            rule: 'restDay',
            staff: person.id,
            date: formatDate(first + k),
            value: restDays,
            limit: rule.count,
          });
      }
    }
  }

  // ---- 7. Staffing: overstaffing is a violation; understaffing is a gap. ---------------
  const gaps: Gap[] = [];
  const byCell = new Map<string, string[]>();
  for (const a of kept) {
    const key = `${a.date}|${a.shift}`;
    const list = byCell.get(key) ?? [];
    list.push(a.staff);
    byCell.set(key, list);
  }
  for (let d = first; d <= last; d++) {
    const date = formatDate(d);
    for (const s of project.shifts) {
      const need = s.demand[weekday(d)] ?? 0;
      const who = byCell.get(`${date}|${s.id}`) ?? [];
      if (who.length > need)
        violations.push({ rule: 'overstaffed', date, shift: s.id, value: who.length, limit: need });
      if (who.length < need)
        gaps.push({ date, shift: s.id, kind: 'staff', need, have: who.length });
      if (need === 0) continue;
      for (const req of s.skillDemand) {
        const have = who.filter((id) =>
          req.skills.every((k) => staffById.get(id)!.skills.includes(k)),
        ).length;
        if (have < req.min)
          gaps.push({
            date,
            shift: s.id,
            kind: 'skill',
            skills: [...req.skills],
            need: req.min,
            have,
          });
      }
    }
  }

  // ---- 8. Locks: the cell must hold exactly the locked value. --------------------------
  const cellOf = (staff: string, date: string) =>
    kept.filter((a) => a.staff === staff && a.date === date).map((a) => a.shift);
  for (const lock of project.locks) {
    const cell = cellOf(lock.staff, lock.date);
    const ok =
      lock.shift === null ? cell.length === 0 : cell.length === 1 && cell[0] === lock.shift;
    if (!ok)
      violations.push({
        rule: 'lock',
        staff: lock.staff,
        date: lock.date,
        ...(lock.shift === null ? {} : { shift: lock.shift }),
      });
  }

  // ---- Soft penalty. --------------------------------------------------------------
  const w = project.weights;
  let prefPoints = 0;
  for (const person of project.staff) {
    for (const pref of person.preferences) {
      for (let d = first; d <= last; d++) {
        const date = formatDate(d);
        if (pref.date !== undefined && pref.date !== date) continue;
        if (pref.weekday !== undefined && pref.weekday !== weekday(d)) continue;
        const cell = cellOf(person.id, date);
        const hit = pref.shift === undefined ? cell.length > 0 : cell.includes(pref.shift);
        if (pref.kind === 'want' && !hit) prefPoints += pref.weight;
        if (pref.kind === 'avoid' && hit) prefPoints += pref.weight;
      }
    }
  }
  const hours: number[] = [];
  const weekends: number[] = [];
  const nights: number[] = [];
  let isolated = 0;
  for (const person of project.staff) {
    const placed = placedBy.get(person.id)!;
    hours.push(placed.reduce((n, p) => n + p.worked, 0));
    weekends.push(placed.filter((p) => weekday(p.day) >= 5).length);
    nights.push(placed.filter((p) => p.shift.night).length);
    const works = new Set(placed.map((p) => p.day));
    for (let d = first + 1; d < last; d++)
      if (works.has(d - 1) && !works.has(d) && works.has(d + 1)) isolated++;
  }
  let changes = 0;
  for (const prev of project.previous) {
    const cell = cellOf(prev.staff, prev.date);
    const same =
      prev.shift === null ? cell.length === 0 : cell.length === 1 && cell[0] === prev.shift;
    if (!same) changes++;
  }
  const penalty: Penalty = {
    preference: w.preference * prefPoints,
    fairHours: w.fairHours * Math.floor(spread(hours) / 60),
    fairWeekend: w.fairWeekend * spread(weekends),
    fairNight: w.fairNight * spread(nights),
    stability: w.stability * changes,
    isolatedDayOff: w.isolatedDayOff * isolated,
    total: 0,
  };
  penalty.total =
    penalty.preference +
    penalty.fairHours +
    penalty.fairWeekend +
    penalty.fairNight +
    penalty.stability +
    penalty.isolatedDayOff;

  return {
    valid: violations.length === 0,
    violations,
    gaps,
    shortfall: gaps.reduce((n, g) => n + (g.need - g.have), 0),
    penalty,
  };
}
