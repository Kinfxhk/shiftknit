// SPDX-License-Identifier: AGPL-3.0-or-later
// "Why is there no full rota?" — find a small set of constraints that together make the
// goal impossible (deletion filter with chunking). Every claim is decided by the exact
// search: a set is only reported when it is PROVEN infeasible, and it is marked minimal
// only when removing any single constraint was PROVEN to make the goal possible.

import type { Project, Staff } from '../model/types';
import type { Relax } from '../solve/compile';
import type { SolveResult } from '../solve/index';
import { solve } from '../solve/index';
import { formatDate, parseDate } from '../time/index';

export type Unit =
  | { type: 'need'; date: string; shift: string }
  | { type: 'skill'; date: string; shift: string; index: number }
  | { type: 'availability'; staff: string }
  | { type: 'leave'; staff: string; date: string }
  | { type: 'maxWeekly'; staff: string }
  | { type: 'minWeekly'; staff: string }
  | { type: 'maxConsecutive'; staff: string }
  | { type: 'lock'; staff: string; date: string }
  | { type: 'minRest' }
  | { type: 'restDay' };

/** coverage = full staffing is impossible; noRota = no rota satisfies the hard rules. */
export type Goal = 'coverage' | 'noRota';

export interface Explanation {
  goal: Goal;
  /** Period in which the conflict was shown (a sub-period proves the whole project). */
  start: string;
  days: number;
  units: Unit[];
  minimal: boolean;
}

export type Verdict = 'infeasible' | 'feasible' | 'unknown';

const key = (u: Unit): string => JSON.stringify(u);

/** All constraints of a project that the explainer may keep or drop. */
export function allUnits(p: Project): Unit[] {
  const first = parseDate(p.start) ?? 0;
  const units: Unit[] = [];
  for (let d = 0; d < p.days; d++) {
    const date = formatDate(first + d);
    const wd = (((first + d + 3) % 7) + 7) % 7;
    for (const s of p.shifts) {
      // Slots with no demand still matter: they cap the number of people at zero.
      units.push({ type: 'need', date, shift: s.id });
      if ((s.demand[wd] ?? 0) === 0) continue;
      s.skillDemand.forEach((_, index) => units.push({ type: 'skill', date, shift: s.id, index }));
    }
  }
  for (const s of p.staff) {
    if (s.availability.length) units.push({ type: 'availability', staff: s.id });
    for (const date of s.leave) {
      const n = parseDate(date) ?? -1;
      if (n >= first - 1 && n <= first + p.days) units.push({ type: 'leave', staff: s.id, date });
    }
    if (s.maxWeeklyMinutes < 10080) units.push({ type: 'maxWeekly', staff: s.id });
    if (s.minWeeklyMinutes > 0) units.push({ type: 'minWeekly', staff: s.id });
    if (s.maxConsecutiveDays < p.days) units.push({ type: 'maxConsecutive', staff: s.id });
  }
  for (const l of p.locks) units.push({ type: 'lock', staff: l.staff, date: l.date });
  if (p.rules.minRestMinutes > 0) units.push({ type: 'minRest' });
  if (p.rules.restDay.enabled && p.days >= 7) units.push({ type: 'restDay' });
  return units;
}

/** The project with only `keep` active (everything else relaxed away). */
export function relaxTo(p: Project, keep: readonly Unit[]): { project: Project; relax: Relax } {
  const k = new Set(keep.map(key));
  const has = (u: Unit) => k.has(key(u));
  const staff: Staff[] = p.staff.map((s) => ({
    ...s,
    availability: has({ type: 'availability', staff: s.id }) ? s.availability : [],
    leave: s.leave.filter((date) => has({ type: 'leave', staff: s.id, date })),
    maxWeeklyMinutes: has({ type: 'maxWeekly', staff: s.id }) ? s.maxWeeklyMinutes : 10080,
    minWeeklyMinutes: has({ type: 'minWeekly', staff: s.id }) ? s.minWeeklyMinutes : 0,
    maxConsecutiveDays: has({ type: 'maxConsecutive', staff: s.id }) ? s.maxConsecutiveDays : 31,
    preferences: [],
  }));
  const zeroNeed = new Set<string>();
  const zeroSkill = new Set<string>();
  const first = parseDate(p.start) ?? 0;
  for (let d = 0; d < p.days; d++) {
    const date = formatDate(first + d);
    for (const s of p.shifts) {
      if (!has({ type: 'need', date, shift: s.id })) zeroNeed.add(`${date}|${s.id}`);
      s.skillDemand.forEach((_, index) => {
        if (!has({ type: 'skill', date, shift: s.id, index }))
          zeroSkill.add(`${date}|${s.id}|${index}`);
      });
    }
  }
  return {
    project: {
      ...p,
      staff,
      locks: p.locks.filter((l) => has({ type: 'lock', staff: l.staff, date: l.date })),
      previous: [],
      rules: {
        ...p.rules,
        minRestMinutes: has({ type: 'minRest' }) ? p.rules.minRestMinutes : 0,
        restDay: {
          ...p.rules.restDay,
          enabled: p.rules.restDay.enabled && has({ type: 'restDay' }),
        },
      },
    },
    relax: { zeroNeed, zeroSkill },
  };
}

/** Restrict a project to a sub-period. Every rule in the sub-period is implied by the same
 * rule in the whole project, so "impossible here" proves "impossible overall". */
export function restrictPeriod(p: Project, startDay: number, days: number): Project {
  const first = parseDate(p.start) ?? 0;
  const lo = first + startDay;
  const hi = lo + days - 1;
  const inside = (date: string) => {
    const n = parseDate(date) ?? -1;
    return n >= lo && n <= hi;
  };
  const aligned = startDay % 7 === 0;
  return {
    ...p,
    start: formatDate(lo),
    days,
    locks: p.locks.filter((l) => inside(l.date)),
    previous: [],
    staff: p.staff.map((s) => ({ ...s, preferences: [] })),
    rules: {
      ...p.rules,
      restDay: {
        ...p.rules.restDay,
        // Fixed 7-day blocks only line up when the sub-period starts on a block boundary.
        enabled: p.rules.restDay.enabled && (p.rules.restDay.mode === 'rolling' || aligned),
      },
    },
  };
}

export interface ExplainBudget {
  /** Total exact-search nodes the explainer may use. */
  nodes: number;
}

/** Decide whether `goal` is possible with only `keep` active, with the exact search. */
export function decide(
  p: Project,
  keep: readonly Unit[],
  goal: Goal,
  budget: ExplainBudget,
  perTest = 200_000,
): Verdict {
  if (budget.nodes <= 0) return 'unknown';
  const { project, relax } = relaxTo(p, keep);
  const cells = project.staff.length * project.days;
  const r: SolveResult = solve(project, {
    seed: 1,
    relax,
    searchBudget: 200 + cells * 20,
    exactBudget: Math.min(perTest, budget.nodes),
  });
  budget.nodes -= r.stats.exactNodes + 1;
  if (goal === 'coverage') {
    if (r.status === 'complete') return 'feasible';
    if (r.shortfallBound > 0 || r.proven) return 'infeasible';
    return 'unknown';
  }
  if (r.status !== 'none') return 'feasible';
  return r.proven ? 'infeasible' : 'unknown';
}

/** Chunked deletion filter. `kept` stays proven-infeasible throughout. */
function minimise(
  units: Unit[],
  test: (u: Unit[]) => Verdict,
): { units: Unit[]; minimal: boolean } {
  let kept = [...units];
  let minimal = true;
  let chunk = Math.max(1, Math.ceil(kept.length / 2));
  for (;;) {
    let i = 0;
    while (i < kept.length) {
      const cand = [...kept.slice(0, i), ...kept.slice(i + chunk)];
      const v = test(cand);
      if (v === 'infeasible') kept = cand;
      else {
        if (chunk === 1 && v === 'unknown') minimal = false;
        i += chunk;
      }
    }
    if (chunk === 1) break;
    chunk = Math.max(1, Math.floor(chunk / 2));
  }
  return { units: kept, minimal };
}

/**
 * Explain a result that is not a complete rota. Returns null when there is nothing to
 * explain or when no proven conflict was found within the budget.
 */
export function explain(
  project: Project,
  result: SolveResult,
  budget: ExplainBudget = { nodes: 2_000_000 },
): Explanation | null {
  if (result.status === 'complete') return null;
  const goal: Goal = result.status === 'none' ? 'noRota' : 'coverage';
  if (goal === 'coverage' && !result.coverageImpossible) return null;
  if (goal === 'noRota' && !result.proven) return null;
  const first = parseDate(project.start) ?? 0;

  // Candidate scopes, smallest first.
  const scopes: [number, number][] = [];
  const dayHasStaticGap = goal === 'coverage' && result.shortfallBound > 0;
  if (dayHasStaticGap) {
    // Find the first day whose own staffing bound is positive: a one-day conflict.
    for (let d = 0; d < project.days; d++) {
      const one = restrictPeriod(project, d, 1);
      const r = solve(one, { seed: 1, searchBudget: 50, exactBudget: 1 });
      if (r.shortfallBound > 0) {
        scopes.push([d, 1]);
        break;
      }
    }
  }
  if (project.staff.length * project.days <= 40) scopes.push([0, project.days]);
  else {
    for (const len of [1, 2, 3, 7, 14]) {
      if (len > project.days) break;
      for (let d = 0; d + len <= project.days && d < 6 * len; d += len) scopes.push([d, len]);
    }
    scopes.push([0, project.days]);
  }

  const seen = new Set<string>();
  for (const [start, days] of scopes) {
    const tag = `${start}|${days}`;
    if (seen.has(tag)) continue;
    seen.add(tag);
    if (budget.nodes <= 0) return null;
    const sub =
      days === project.days && start === 0 ? project : restrictPeriod(project, start, days);
    const units = allUnits(sub);
    if (decide(sub, units, goal, budget) !== 'infeasible') continue;
    const m = minimise(units, (u) => decide(sub, u, goal, budget));
    return {
      goal,
      start: formatDate(first + start),
      days,
      units: m.units,
      minimal: m.minimal && budget.nodes > 0,
    };
  }
  return null;
}
