// SPDX-License-Identifier: AGPL-3.0-or-later
// Cross-check the solver's claims against exhaustive enumeration on small projects:
// "no rota exists", "full coverage impossible" and "proven optimal" must all be true.
import { describe, expect, it } from 'vitest';
import { solveAndCheck } from '../../packages/core/src/index';
import { bruteForce, gridCount } from './brute';
import { randomProject } from './random-project';

interface Tally {
  cases: number;
  none: number;
  shortfall: number;
  complete: number;
  impossible: number;
}

function crossCheck(seed: number, size: Parameters<typeof randomProject>[1], tally: Tally) {
  const p = randomProject(seed, size);
  const grids = gridCount(p);
  if (grids > 60_000) return false;
  const oracle = bruteForce(p);
  const { result, report, rejected } = solveAndCheck(p, { seed, exactBudget: 5_000_000 });
  const tag = `seed ${seed}`;
  expect(rejected, tag).toBe(false);
  expect(result.proven, `${tag}: small cases must be solved exactly`).toBe(true);
  if (result.status === 'none') {
    expect(oracle.anyValid, `${tag}: solver says no rota exists`).toBe(false);
    tally.none++;
  } else {
    expect(report?.valid, tag).toBe(true);
    expect(oracle.best, tag).not.toBeNull();
    expect(result.objective, `${tag}: proven optimum must equal the oracle`).toEqual(oracle.best);
    if (result.status === 'complete') tally.complete++;
    else tally.shortfall++;
  }
  if (result.coverageImpossible) {
    tally.impossible++;
    expect(
      oracle.best === null || oracle.best.shortfall > 0,
      `${tag}: coverage claimed impossible`,
    ).toBe(true);
  }
  tally.cases++;
  return true;
}

describe('exhaustive oracle', () => {
  it('agrees with the solver on 300 small random projects (≤3 people × ≤4 days × ≤2 shifts)', () => {
    const tally: Tally = { cases: 0, none: 0, shortfall: 0, complete: 0, impossible: 0 };
    for (let seed = 1; tally.cases < 300; seed++)
      crossCheck(seed, { staff: [1, 3], days: [1, 4], shifts: [1, 2] }, tally);
    // The generator must exercise every kind of claim.
    expect(tally.none).toBeGreaterThan(0);
    expect(tally.shortfall).toBeGreaterThan(0);
    expect(tally.complete).toBeGreaterThan(0);
    expect(tally.impossible).toBeGreaterThan(0);
  });

  it('agrees on 40 seven-day projects (rest days, weekly hours, consecutive days)', () => {
    const tally: Tally = { cases: 0, none: 0, shortfall: 0, complete: 0, impossible: 0 };
    for (let seed = 10_001; tally.cases < 40; seed++)
      crossCheck(seed, { staff: [1, 2], days: [7, 7], shifts: [1, 1] }, tally);
    expect(tally.cases).toBe(40);
  });
});
