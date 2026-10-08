// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { Solver } from '../src/index';
import { checkRoster, solve, solveAndCheck } from '../src/index';
import { randomProject } from '../../../test/oracle/random-project';
import { project } from './helpers/fixtures';

describe('solver properties', () => {
  it('every rota from 1,000 random projects passes the independent checker', () => {
    let rotas = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const p = randomProject(seed * 7919, { staff: [0, 6], days: [1, 10], shifts: [0, 3] });
      const { result, report, rejected } = solveAndCheck(p, {
        seed,
        searchBudget: 1500,
        exactBudget: 1500,
      });
      expect(rejected, `seed ${seed}`).toBe(false);
      if (result.roster) {
        rotas++;
        expect(report!.valid, `seed ${seed}`).toBe(true);
        expect(report!.shortfall).toBe(result.objective!.shortfall);
        expect(report!.penalty.total).toBe(result.objective!.penalty);
        if (result.status === 'complete') expect(report!.shortfall).toBe(0);
      }
    }
    expect(rotas).toBeGreaterThan(700);
  });

  it('is deterministic: same seed → byte-identical output', () => {
    for (const seed of [3, 17, 99]) {
      const p = randomProject(seed, { staff: [6, 8], days: [14, 14], shifts: [2, 3] });
      const a = JSON.stringify(solve(p, { seed }));
      const b = JSON.stringify(solve(p, { seed }));
      expect(a).toBe(b);
    }
  });

  it('produces the same bytes on every platform (golden hash)', () => {
    const h = createHash('sha256');
    for (const seed of [1, 2, 3, 4, 5]) {
      const p = randomProject(seed * 101, { staff: [5, 8], days: [7, 14], shifts: [2, 3] });
      h.update(JSON.stringify(solve(p, { seed, searchBudget: 20_000, exactBudget: 20_000 })));
    }
    expect(h.digest('hex')).toBe(GOLDEN_HASH);
  });
});

const GOLDEN_HASH = 'fe17cb6136d8223277713410eac7de631b2a3f994a236bbf1b42fa26b23e551f';

describe('solver edge cases', () => {
  const base = {
    skills: ['firstaid'],
    rules: { minRestMinutes: 660, restDay: { enabled: true } },
  };
  it('0 staff: shortfall equals total demand, proven', () => {
    const r = solve(project({ ...base, staff: [] }));
    expect(r.status).toBe('shortfall');
    expect(r.proven).toBe(true);
    expect(r.objective!.shortfall).toBe(14);
    expect(r.coverageImpossible).toBe(true);
  });

  it('everyone on leave: no assignments, coverage impossible by the bound', () => {
    const dates = [
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ];
    const r = solveAndCheck(
      project({
        ...base,
        staff: [
          { id: 'a', name: 'A', leave: dates },
          { id: 'b', name: 'B', leave: dates },
        ],
      }),
    );
    expect(r.result.roster!.assignments).toEqual([]);
    expect(r.result.shortfallBound).toBe(14);
    expect(r.result.coverageImpossible).toBe(true);
  });

  it('demand 0 everywhere: empty rota, proven optimal', () => {
    const r = solve(
      project({
        ...base,
        shifts: [{ id: 'e', name: 'E', start: '09:00', end: '17:00', demand: 0 }],
      }),
    );
    expect(r).toMatchObject({
      status: 'complete',
      proven: true,
      objective: { shortfall: 0, penalty: 0 },
    });
    expect(r.roster!.assignments).toEqual([]);
  });

  it('a single shift and enough people: complete and checked', () => {
    const r = solveAndCheck(
      project({
        ...base,
        shifts: [{ id: 'e', name: 'E', start: '09:00', end: '17:00', demand: 1 }],
      }),
    );
    expect(r.result.status).toBe('complete');
    expect(r.report!.valid).toBe(true);
  });

  it('everyone can only do the same shift', () => {
    const only = [{ days: [0, 1, 2, 3, 4, 5, 6], from: '07:00', to: '15:00' }];
    const r = solveAndCheck(
      project({
        ...base,
        staff: [
          { id: 'a', name: 'A', availability: only },
          { id: 'b', name: 'B', availability: only },
        ],
      }),
    );
    expect(r.result.status).toBe('shortfall');
    expect(r.result.objective!.shortfall).toBe(7); // the late shift can never be filled
    expect(r.result.coverageImpossible).toBe(true);
    expect(r.report!.valid).toBe(true);
  });

  it('a skill nobody has: proven shortfall, rota still valid', () => {
    const r = solveAndCheck(
      project({
        ...base,
        shifts: [
          {
            id: 'e',
            name: 'E',
            start: '07:00',
            end: '15:00',
            demand: 1,
            skillDemand: [{ skills: ['firstaid'], min: 1 }],
          },
        ],
        staff: [
          { id: 'b', name: 'B' },
          { id: 'c', name: 'C' },
        ],
      }),
    );
    expect(r.result.objective!.shortfall).toBe(7);
    expect(r.result.coverageImpossible).toBe(true);
    expect(r.report!.gaps.every((g) => g.kind === 'skill')).toBe(true);
  });

  it('contradictory locks: no rota, proven', () => {
    const r = solve(
      project({
        ...base,
        locks: [
          { staff: 'a', date: '2026-11-02', shift: 'late' },
          { staff: 'a', date: '2026-11-03', shift: 'early' }, // only 8 h rest
        ],
      }),
    );
    expect(r).toMatchObject({ status: 'none', proven: true, roster: null });
  });

  it('respects locks', () => {
    const p = project({
      ...base,
      locks: [
        { staff: 'b', date: '2026-11-04', shift: 'late' },
        { staff: 'a', date: '2026-11-05', shift: null },
      ],
    });
    const r = solveAndCheck(p);
    const a = r.result.roster!.assignments;
    expect(a).toContainEqual({ staff: 'b', date: '2026-11-04', shift: 'late' });
    expect(a.some((x) => x.staff === 'a' && x.date === '2026-11-05')).toBe(false);
    expect(checkRoster(p, r.result.roster!).valid).toBe(true);
  });
});

// Solver mutation: a solver that forgets a rule must be stopped by the checker.
const srcDir = fileURLToPath(new URL('../src', import.meta.url));
const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

async function mutantSolver(name: string, file: string, from: string, to: string): Promise<Solver> {
  const dir = join(srcDir, `solve-mutant-${name}-${process.pid}`);
  made.push(dir);
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(join(srcDir, 'solve')))
    cpSync(join(srcDir, 'solve', f), join(dir, f));
  const text = readFileSync(join(dir, file), 'utf8');
  expect(text.split(from).length - 1, name).toBe(1);
  writeFileSync(join(dir, file), text.replace(from, to));
  const mod = (await import(pathToFileURL(join(dir, 'index.ts')).href)) as { solve: Solver };
  return mod.solve;
}

describe('the checker stops a broken solver', () => {
  const tight = () =>
    project({
      skills: [],
      shifts: [
        { id: 'early', name: 'Early', start: '07:00', end: '15:00', demand: [0, 1, 0, 1, 0, 1, 0] },
        { id: 'late', name: 'Late', start: '15:00', end: '23:00', demand: [1, 0, 1, 0, 1, 0, 0] },
      ],
      staff: [{ id: 'a', name: 'A', maxConsecutiveDays: 7, maxWeeklyMinutes: 1500 }],
      rules: { minRestMinutes: 660, restDay: { enabled: false } },
    });

  it('solver that ignores the rest minimum → rota rejected', async () => {
    const bad = await mutantSolver(
      'rest',
      'rows.ts',
      'return gap >= c.minRest && gap >= 0;',
      'return gap >= 0;',
    );
    const r = solveAndCheck(tight(), { seed: 1 }, bad);
    expect(r.rejected).toBe(true);
    expect(r.result.roster).toBeNull();
    expect(r.report!.violations.some((v) => v.rule === 'rest')).toBe(true);
  });

  it('solver that ignores weekly maximum hours → rota rejected', async () => {
    const bad = await mutantSolver(
      'weekly',
      'rows.ts',
      'if (sum > c.maxWeekly[s]!) return false;',
      'void sum;',
    );
    const r = solveAndCheck(
      project({
        skills: [],
        staff: [{ id: 'a', name: 'A', maxWeeklyMinutes: 900 }],
        rules: { minRestMinutes: 0, restDay: { enabled: false } },
      }),
      { seed: 1 },
      bad,
    );
    expect(r.rejected).toBe(true);
    expect(r.report!.violations.some((v) => v.rule === 'weeklyMax')).toBe(true);
  });

  it('solver that misreports its penalty → rota rejected', async () => {
    const bad = await mutantSolver(
      'score',
      'grid.ts',
      'w.isolatedDayOff * this.isolated;',
      'w.isolatedDayOff * this.isolated + 1;',
    );
    const r = solveAndCheck(tight(), { seed: 1 }, bad);
    expect(r.rejected).toBe(true);
  });
});
