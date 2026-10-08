// SPDX-License-Identifier: AGPL-3.0-or-later
// Turn a validated project into flat arrays for the solver. The solver works on a grid
// of cells (person × day); each cell is OFF (0) or one shift (1 … K). One shift per
// person per day is a modelling choice of the solver; the checker does not assume it.

import type { Project } from '../model/types';
import {
  dayStart,
  formatDate,
  parseDate,
  parseTime,
  shiftInterval,
  weekday,
  zonedInstant,
} from '../time/index';

export interface Compiled {
  S: number;
  D: number;
  K: number;
  V: number; // K + 1 values per cell
  first: number;
  staffIds: string[];
  shiftIds: string[];
  /** ivStart/ivEnd/worked indexed by d*K + k. */
  ivStart: number[];
  ivEnd: number[];
  worked: number[];
  demand: number[];
  /** Most people allowed on a slot (normally = demand; relaxed slots are uncapped). */
  cap: number[];
  /** Skill requirements per slot d*K + k: bit mask (person needs all bits) and minimum.
   * Only present on slots with demand > 0, as in the checker. */
  skillReqs: { mask: number; min: number }[][];
  staffMask: number[];
  /** allowed[(s*D + d)*V + v] (v = 0 is always allowed unless locked to a shift). */
  allowed: Uint8Array;
  /** Cost of choosing value v in cell (s, d): preferences + stability, already weighted. */
  cellCost: Int32Array;
  week: number[];
  weekCount: number;
  weekFull: boolean[];
  maxWeekly: number[];
  minWeekly: number[];
  maxConsec: number[];
  minRest: number;
  restOn: boolean;
  restCount: number;
  restMin: number;
  /** Rest-day windows: [startDayIndex, windowStartInstant, windowEndInstant]. */
  windows: [number, number, number][];
  /** For each day, indexes of windows that end on that day / contain it. */
  windowsEnding: number[][];
  windowsContaining: number[][];
  isNight: boolean[];
  isWeekend: boolean[];
  weights: Project['weights'];
}

/** Internal relaxations used by the conflict explainer (keys use date and ids). */
export interface Relax {
  /** "date|shift": staffing need removed (and the slot uncapped). */
  zeroNeed?: ReadonlySet<string>;
  /** "date|shift|index": one skill need removed. */
  zeroSkill?: ReadonlySet<string>;
}

export function compile(p: Project, relax: Relax = {}): Compiled {
  const tz = p.timeZone;
  const first = parseDate(p.start) ?? 0;
  const S = p.staff.length;
  const D = p.days;
  const K = p.shifts.length;
  const V = K + 1;
  const skillBit = new Map(p.skills.map((s, i) => [s, 1 << i]));
  const maskOf = (list: string[]) => list.reduce((m, s) => m | (skillBit.get(s) ?? 0), 0);

  const ivStart: number[] = [];
  const ivEnd: number[] = [];
  const worked: number[] = [];
  const demand: number[] = [];
  const cap: number[] = [];
  const skillReqs: { mask: number; min: number }[][] = [];
  for (let d = 0; d < D; d++)
    for (const sh of p.shifts) {
      const iv = shiftInterval(first + d, parseTime(sh.start) ?? 0, parseTime(sh.end) ?? 0, tz);
      ivStart.push(iv.start);
      ivEnd.push(iv.end);
      worked.push(Math.max(0, iv.end - iv.start - sh.breakMinutes));
      const need = sh.demand[weekday(first + d)] ?? 0;
      const key = `${formatDate(first + d)}|${sh.id}`;
      const zero = relax.zeroNeed?.has(key) ?? false;
      demand.push(zero ? 0 : need);
      cap.push(zero ? Math.max(S, need) : need);
      skillReqs.push(
        need === 0
          ? []
          : sh.skillDemand
              .map((r, j) => ({ mask: maskOf(r.skills), min: r.min, j }))
              .filter((r) => !(relax.zeroSkill?.has(`${key}|${r.j}`) ?? false))
              .map(({ mask, min }) => ({ mask, min })),
      );
    }

  const allowed = new Uint8Array(S * D * V);
  const cellCost = new Int32Array(S * D * V);
  const shiftIndex = new Map(p.shifts.map((s, i) => [s.id, i]));
  p.staff.forEach((person, s) => {
    // Availability as merged real intervals per day (windows starting d-1 … d+1).
    const availFor = (d: number): [number, number][] => {
      const list: [number, number][] = [];
      for (let x = d - 1; x <= d + 1; x++)
        for (const w of person.availability) {
          if (!w.days.includes(weekday(first + x))) continue;
          const from = parseTime(w.from) ?? 0;
          const to = parseTime(w.to, true) ?? 0;
          const a = zonedInstant(first + x, from, tz);
          const b =
            to === 1440
              ? dayStart(first + x + 1, tz)
              : zonedInstant(first + x + (to <= from ? 1 : 0), to, tz);
          list.push([a, b]);
        }
      list.sort((u, v) => u[0] - v[0] || u[1] - v[1]);
      const merged: [number, number][] = [];
      for (const iv of list) {
        const last = merged[merged.length - 1];
        if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
        else merged.push([iv[0], iv[1]]);
      }
      return merged;
    };
    const leave = person.leave
      .map((l) => parseDate(l))
      .filter((x): x is number => x !== undefined)
      .map((l) => [dayStart(l, tz), dayStart(l + 1, tz)] as const);
    for (let d = 0; d < D; d++) {
      const base = (s * D + d) * V;
      allowed[base] = 1;
      const avail = person.availability.length ? availFor(d) : null;
      for (let k = 0; k < K; k++) {
        const a = ivStart[d * K + k]!;
        const b = ivEnd[d * K + k]!;
        let ok = true;
        if (avail && !avail.some(([x, y]) => x <= a && b <= y)) ok = false;
        if (leave.some(([x, y]) => a < y && x < b)) ok = false;
        allowed[base + k + 1] = ok ? 1 : 0;
      }
    }
  });
  for (const lock of p.locks) {
    const s = p.staff.findIndex((x) => x.id === lock.staff);
    const d = (parseDate(lock.date) ?? 0) - first;
    const keep = lock.shift === null ? 0 : (shiftIndex.get(lock.shift) ?? -1) + 1;
    for (let v = 0; v < V; v++) if (v !== keep) allowed[(s * D + d) * V + v] = 0;
  }

  // Preferences and stability as per-cell costs.
  p.staff.forEach((person, s) => {
    for (const pref of person.preferences) {
      const k = pref.shift === undefined ? -1 : (shiftIndex.get(pref.shift) ?? -1);
      for (let d = 0; d < D; d++) {
        if (pref.date !== undefined && parseDate(pref.date) !== first + d) continue;
        if (pref.weekday !== undefined && weekday(first + d) !== pref.weekday) continue;
        for (let v = 0; v < V; v++) {
          const hit = k < 0 ? v > 0 : v === k + 1;
          const bad = pref.kind === 'want' ? !hit : hit;
          if (bad) cellCost[(s * D + d) * V + v]! += pref.weight * p.weights.preference;
        }
      }
    }
  });
  for (const prev of p.previous) {
    const s = p.staff.findIndex((x) => x.id === prev.staff);
    const d = (parseDate(prev.date) ?? 0) - first;
    const keep = prev.shift === null ? 0 : (shiftIndex.get(prev.shift) ?? -1) + 1;
    for (let v = 0; v < V; v++)
      if (v !== keep) cellCost[(s * D + d) * V + v]! += p.weights.stability;
  }

  const anchor = first - ((weekday(first) - p.rules.weekStart + 7) % 7);
  const week: number[] = [];
  for (let d = 0; d < D; d++) week.push(Math.floor((first + d - anchor) / 7));
  const weekCount = (week[D - 1] ?? 0) + 1;
  const weekFull: boolean[] = [];
  for (let w = 0; w < weekCount; w++) {
    const startDay = anchor + 7 * w;
    weekFull.push(startDay >= first && startDay + 6 <= first + D - 1);
  }

  const rd = p.rules.restDay;
  const windows: [number, number, number][] = [];
  const windowsEnding: number[][] = Array.from({ length: D }, () => []);
  const windowsContaining: number[][] = Array.from({ length: D }, () => []);
  if (rd.enabled && D >= 7) {
    const step = rd.mode === 'fixed' ? 7 : 1;
    for (let i = 0; i + 7 <= D; i += step) {
      const idx = windows.length;
      windows.push([i, dayStart(first + i, tz), dayStart(first + i + 7, tz)]);
      windowsEnding[i + 6]!.push(idx);
      for (let d = Math.max(0, i - 2); d < i + 7; d++) windowsContaining[d]!.push(idx);
    }
  }

  return {
    S,
    D,
    K,
    V,
    first,
    staffIds: p.staff.map((s) => s.id),
    shiftIds: p.shifts.map((s) => s.id),
    ivStart,
    ivEnd,
    worked,
    demand,
    cap,
    skillReqs,
    staffMask: p.staff.map((s) => maskOf(s.skills)),
    allowed,
    cellCost,
    week,
    weekCount,
    weekFull,
    maxWeekly: p.staff.map((s) => s.maxWeeklyMinutes),
    minWeekly: p.staff.map((s) => s.minWeeklyMinutes),
    maxConsec: p.staff.map((s) => s.maxConsecutiveDays),
    minRest: p.rules.minRestMinutes,
    restOn: rd.enabled && windows.length > 0,
    restCount: rd.count,
    restMin: rd.minMinutes,
    windows,
    windowsEnding,
    windowsContaining,
    isNight: p.shifts.map((s) => s.night),
    isWeekend: Array.from({ length: D }, (_, d) => weekday(first + d) >= 5),
    weights: p.weights,
  };
}
