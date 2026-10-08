// SPDX-License-Identifier: AGPL-3.0-or-later
// Exhaustive oracle (tests only): enumerate every grid (each person-day is OFF or one
// shift), judge each with the independent checker, and return the true optimum.
// Shares no code with the solver.

import { checkRoster } from '../../packages/core/src/check/index';
import type { Assignment, Project } from '../../packages/core/src/index';
import { formatDate, parseDate } from '../../packages/core/src/index';

export interface OracleResult {
  anyValid: boolean;
  /** Lexicographic optimum (shortfall, penalty) among valid rotas. */
  best: { shortfall: number; penalty: number } | null;
  grids: number;
}

export function gridCount(p: Project): number {
  return (p.shifts.length + 1) ** (p.staff.length * p.days);
}

export function bruteForce(p: Project): OracleResult {
  const S = p.staff.length;
  const D = p.days;
  const V = p.shifts.length + 1;
  const n = S * D;
  const first = parseDate(p.start)!;
  const dates = Array.from({ length: D }, (_, d) => formatDate(first + d));
  const digits = new Array<number>(n).fill(0);
  let best: OracleResult['best'] = null;
  let grids = 0;
  for (;;) {
    grids++;
    const assignments: Assignment[] = [];
    for (let i = 0; i < n; i++) {
      const v = digits[i]!;
      if (v > 0)
        assignments.push({
          staff: p.staff[i % S]!.id,
          date: dates[Math.floor(i / S)]!,
          shift: p.shifts[v - 1]!.id,
        });
    }
    const rep = checkRoster(p, { assignments });
    if (rep.valid) {
      const cand = { shortfall: rep.shortfall, penalty: rep.penalty.total };
      if (
        !best ||
        cand.shortfall < best.shortfall ||
        (cand.shortfall === best.shortfall && cand.penalty < best.penalty)
      )
        best = cand;
    }
    let i = 0;
    while (i < n && digits[i] === V - 1) digits[i++] = 0;
    if (i === n) break;
    digits[i]!++;
  }
  return { anyValid: best !== null, best, grids };
}
