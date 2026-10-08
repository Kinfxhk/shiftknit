// SPDX-License-Identifier: AGPL-3.0-or-later
// Solver entry point: greedy → local search → exact branch and bound (within budget).
// Deterministic: same project + same options = byte-identical result, as long as the work
// budget (not the optional wall-clock limit) ends the search.

import type { Assignment, Project } from '../model/types';
import { formatDate } from '../time/index';
import { ENGINE_VERSION } from '../version';
import { staticBounds } from './bounds';
import type { Compiled } from './compile';
import { compile } from './compile';
import type { Relax } from './compile';
import { exactSearch } from './exact';
import { Grid } from './grid';
import type { Budget } from './heuristic';
import { greedy, localSearch } from './heuristic';
import { Rng } from './rng';
import { rowOk } from './rows';

export type SolveStatus = 'complete' | 'shortfall' | 'none';

export interface SolveOptions {
  seed?: number;
  /** Work units for local search (default scales with size). */
  searchBudget?: number;
  /** Node budget for the exact search (default 300,000). */
  exactBudget?: number;
  /** Optional wall-clock stop, injected by the caller (CLI / web worker). */
  timeUp?: () => boolean;
  /** Internal: relaxations used by the conflict explainer. */
  relax?: Relax;
}

export interface SolveResult {
  schema: 'shiftknit/result';
  version: 1;
  engine: string;
  seed: number;
  /** complete = every staffing need met; shortfall = best rota still has gaps;
   * none = no rota satisfies the hard rules (found or proven). */
  status: SolveStatus;
  /** True when the exact search finished: the rota is optimal (or, for "none", no rota
   * exists). False means "best found within the budget". */
  proven: boolean;
  /** True when full coverage is proven impossible (by the bound or the exact search). */
  coverageImpossible: boolean;
  objective: { shortfall: number; penalty: number } | null;
  /** Lower bound on the shortfall from availability, leave and locks alone. */
  shortfallBound: number;
  roster: { assignments: Assignment[] } | null;
  stats: { searchSteps: number; exactNodes: number; stoppedBy: 'finished' | 'budget' | 'time' };
}

export function gridToAssignments(c: Compiled, p: Project, g: Grid): Assignment[] {
  const out: Assignment[] = [];
  for (let d = 0; d < c.D; d++)
    for (let s = 0; s < c.S; s++) {
      const v = g.get(s, d);
      if (v > 0)
        out.push({
          staff: p.staff[s]!.id,
          date: formatDate(c.first + d),
          shift: p.shifts[v - 1]!.id,
        });
    }
  return out;
}

/** Are the locked cells consistent on their own (hard rules and staffing caps)? */
function locksConsistent(c: Compiled): boolean {
  const g = new Grid(c);
  for (let s = 0; s < c.S; s++)
    for (let d = 0; d < c.D; d++) {
      const base = (s * c.D + d) * c.V;
      let n = 0;
      for (let v = 0; v < c.V; v++) if (c.allowed[base + v]) n++;
      if (n === 0) return false; // locked to a value the person cannot take
      if (!c.allowed[base]) for (let v = 1; v < c.V; v++) if (c.allowed[base + v]) g.apply(s, d, v);
    }
  for (let i = 0; i < c.D * c.K; i++) if (g.count[i]! > c.cap[i]!) return false;
  for (let s = 0; s < c.S; s++) if (!rowOk(c, s, g.row(s))) return false;
  return true;
}

export function solve(project: Project, options: SolveOptions = {}): SolveResult {
  const seed = (options.seed ?? 1) >>> 0;
  const c = compile(project, options.relax);
  const bounds = staticBounds(c);
  const shortfallBound = bounds.reduce((a, b) => a + b, 0);
  const cells = c.S * c.D;
  const budget: Budget = {
    left: options.searchBudget ?? Math.min(1_500_000, 2_000 + cells * 1_500),
    stoppedByTime: false,
    ...(options.timeUp ? { timeUp: options.timeUp } : {}),
  };
  const base = {
    schema: 'shiftknit/result' as const,
    version: 1 as const,
    engine: ENGINE_VERSION,
    seed,
    shortfallBound,
  };

  if (!locksConsistent(c))
    return {
      ...base,
      status: 'none',
      proven: true,
      coverageImpossible: true,
      objective: null,
      roster: null,
      stats: { searchSteps: 0, exactNodes: 0, stoppedBy: 'finished' },
    };

  const rng = new Rng(seed);
  const start = greedy(c, rng);
  const searchStart = budget.left;
  const heur = localSearch(c, start, rng, budget);
  const searchSteps = searchStart - Math.max(0, budget.left);
  const hObj = heur.objective();

  // Exact search, unless the heuristic result is already provably optimal.
  let best: Grid | null = hObj.deficit === 0 ? heur : null;
  let bestObj = hObj.deficit === 0 ? hObj : null;
  let proven = false;
  let exactNodes = 0;
  const trivially =
    bestObj !== null && bestObj.shortfall === shortfallBound && bestObj.penalty === 0;
  if (trivially) proven = true;
  else if (!budget.stoppedByTime) {
    const exactBudget: Budget = {
      left: options.exactBudget ?? 300_000,
      stoppedByTime: false,
      ...(options.timeUp ? { timeUp: options.timeUp } : {}),
    };
    const ex = exactSearch(c, heur, bounds, exactBudget);
    exactNodes = ex.nodes;
    if (ex.complete) proven = true;
    if (
      ex.best &&
      ex.bestObj &&
      (!bestObj ||
        ex.bestObj.shortfall < bestObj.shortfall ||
        (ex.bestObj.shortfall === bestObj.shortfall && ex.bestObj.penalty < bestObj.penalty))
    ) {
      best = ex.best;
      bestObj = ex.bestObj;
    }
    if (exactBudget.stoppedByTime) budget.stoppedByTime = true;
  }
  const stoppedBy = budget.stoppedByTime ? 'time' : proven ? 'finished' : 'budget';
  if (!best || !bestObj)
    return {
      ...base,
      status: 'none',
      proven,
      coverageImpossible: proven || shortfallBound > 0,
      objective: null,
      roster: null,
      stats: { searchSteps, exactNodes, stoppedBy },
    };
  return {
    ...base,
    status: bestObj.shortfall === 0 ? 'complete' : 'shortfall',
    proven,
    coverageImpossible: shortfallBound > 0 || (proven && bestObj.shortfall > 0),
    objective: { shortfall: bestObj.shortfall, penalty: bestObj.penalty },
    roster: { assignments: gridToAssignments(c, project, best) },
    stats: { searchSteps, exactNodes, stoppedBy },
  };
}
