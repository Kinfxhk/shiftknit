// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { Assignment, Project } from '../src/index';
import { checkRoster, solveAndCheck } from '../src/index';
import { randomProject } from '../../../test/oracle/random-project';
import { bigProject } from './helpers/big';

/** Make person j identical to person i (except id and name). */
function twin(p: Project, i: number, j: number): Project {
  const staff = p.staff.map((s, x) => (x === j ? { ...p.staff[i]!, id: s.id, name: s.name } : s));
  const locks = p.locks.filter((l) => l.staff !== p.staff[i]!.id && l.staff !== p.staff[j]!.id);
  const previous = p.previous.filter(
    (l) => l.staff !== p.staff[i]!.id && l.staff !== p.staff[j]!.id,
  );
  return { ...p, staff, locks, previous };
}

describe('soft objectives', () => {
  it('fairness is symmetric: swapping two identical people keeps the total penalty (200 projects)', () => {
    let tested = 0;
    for (let seed = 1; seed <= 400 && tested < 200; seed++) {
      const base = randomProject(seed * 13, { staff: [2, 6], days: [3, 10], shifts: [1, 3] });
      const p = twin(base, 0, 1);
      const { result } = solveAndCheck(p, { seed, searchBudget: 3000, exactBudget: 3000 });
      if (!result.roster) continue;
      const a = p.staff[0]!.id;
      const b = p.staff[1]!.id;
      const swapped: Assignment[] = result.roster.assignments.map((x) =>
        x.staff === a ? { ...x, staff: b } : x.staff === b ? { ...x, staff: a } : x,
      );
      const r1 = checkRoster(p, result.roster);
      const r2 = checkRoster(p, { assignments: swapped });
      expect(r2.valid, `seed ${seed}`).toBe(true);
      expect(r2.penalty.total, `seed ${seed}`).toBe(r1.penalty.total);
      expect(r2.shortfall).toBe(r1.shortfall);
      tested++;
    }
    expect(tested).toBe(200);
  });

  it('honours preferences when nothing else is at stake', async () => {
    const { project } = await import('./helpers/fixtures');
    const p = project({
      skills: [],
      shifts: [{ id: 'e', name: 'E', start: '09:00', end: '17:00', demand: 1 }],
      staff: [
        { id: 'a', name: 'A', preferences: [{ kind: 'want', weekday: 2, weight: 5 }] },
        { id: 'b', name: 'B', preferences: [{ kind: 'avoid', weekday: 2, weight: 5 }] },
      ],
      weights: { fairHours: 0, fairWeekend: 0, fairNight: 0, isolatedDayOff: 0 },
      rules: { minRestMinutes: 0, restDay: { enabled: false } },
    });
    const r = solveAndCheck(p, { seed: 4 });
    expect(r.result.proven).toBe(true);
    expect(r.result.objective!.penalty).toBe(0);
    expect(r.result.roster!.assignments).toContainEqual({
      staff: 'a',
      date: '2026-11-04',
      shift: 'e',
    });
  });
});

describe('performance at the size limits', () => {
  it('30 people × 31 days × 6 shifts: a checked, fully staffed rota within 10 seconds', () => {
    const p = bigProject();
    const t0 = performance.now();
    const r = solveAndCheck(p, { seed: 1 });
    const seconds = (performance.now() - t0) / 1000;
    console.info(
      `benchmark 30×31×6: ${seconds.toFixed(2)} s, status ${r.result.status}, penalty ${r.result.objective?.penalty}`,
    );
    expect(r.rejected).toBe(false);
    expect(r.result.status).toBe('complete');
    expect(r.report!.valid).toBe(true);
    expect(seconds).toBeLessThan(10);
  });
});
