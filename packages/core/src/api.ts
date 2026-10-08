// SPDX-License-Identifier: AGPL-3.0-or-later
// Solve, then verify with the independent checker. A rota is only returned when the
// checker finds no broken hard rule AND agrees with the solver's own shortfall and
// penalty. Otherwise the result is marked "rejected" and carries no rota.

import type { CheckReport } from './check/index';
import { checkRoster } from './check/index';
import type { Project } from './model/types';
import type { SolveOptions, SolveResult } from './solve/index';
import { solve } from './solve/index';

export interface VerifiedResult {
  result: SolveResult;
  /** Present whenever a rota was produced. */
  report: CheckReport | null;
  /** True when the solver's rota failed the checker (a bug); the rota is withheld. */
  rejected: boolean;
}

export type Solver = (p: Project, o?: SolveOptions) => SolveResult;

export function solveAndCheck(
  project: Project,
  options: SolveOptions = {},
  solver: Solver = solve,
): VerifiedResult {
  const result = solver(project, options);
  if (!result.roster) return { result, report: null, rejected: false };
  const report = checkRoster(project, result.roster);
  const agrees =
    report.valid &&
    result.objective !== null &&
    report.shortfall === result.objective.shortfall &&
    report.penalty.total === result.objective.penalty;
  if (agrees) return { result, report, rejected: false };
  return { result: { ...result, roster: null }, report, rejected: true };
}
