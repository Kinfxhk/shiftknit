// SPDX-License-Identifier: AGPL-3.0-or-later
// Conflict explanations must be reproducible: with ONLY the listed rules the goal is still
// impossible (confirmed by the solver AND by brute force), and when marked minimal,
// dropping any one listed rule makes it possible.
import { describe, expect, it } from 'vitest';
import type { Unit } from '../../packages/core/src/index';
import {
  decide,
  describeUnit,
  explain,
  LANGS,
  relaxTo,
  solve,
  validateProject,
} from '../../packages/core/src/index';
import { bruteForceRelaxed, gridCount } from './brute';
import { randomProject } from './random-project';

describe('conflict explanations', () => {
  it('names the real cause: night shift needs 2 first-aiders but only 1 can work', () => {
    const v = validateProject({
      schema: 'shiftknit/project',
      version: 1,
      name: 'Care home',
      start: '2026-11-01',
      days: 7,
      skills: ['firstaid'],
      shifts: [
        { id: 'day', name: 'Day', start: '08:00', end: '20:00', demand: 1 },
        {
          id: 'night',
          name: 'Night',
          start: '20:00',
          end: '08:00',
          demand: 2,
          skillDemand: [{ skills: ['firstaid'], min: 2 }],
        },
      ],
      staff: [
        { id: 'ann', name: 'Ann', skills: ['firstaid'] },
        { id: 'bo', name: 'Bo', skills: ['firstaid'], leave: ['2026-11-03'] },
        { id: 'cy', name: 'Cy' },
        { id: 'di', name: 'Di' },
        { id: 'ed', name: 'Ed', skills: ['firstaid'] },
      ],
      rules: { minRestMinutes: 600, restDay: { enabled: false } },
      locks: [{ staff: 'ed', date: '2026-11-03', shift: 'day' }],
    });
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    const p = v.value;
    const r = solve(p, { seed: 1 });
    expect(r.status).toBe('shortfall');
    expect(r.coverageImpossible).toBe(true);
    const e = explain(p, r)!;
    expect(e).not.toBeNull();
    expect(e.goal).toBe('coverage');
    expect(e.minimal).toBe(true);
    expect(e.days).toBe(1);
    expect(e.start).toBe('2026-11-03');
    const types = e.units.map((u) => u.type).sort();
    expect(types).toEqual(['leave', 'lock', 'skill']);
    const text = e.units.map((u) => describeUnit('en', u, p)).join(' ');
    expect(text).toContain('Night on 2026-11-03 needs 2 staff with firstaid.');
    expect(text).toContain('Bo is on leave on 2026-11-03.');
    expect(text).toContain('Ed is locked to Day on 2026-11-03.');
    for (const lang of LANGS)
      for (const u of e.units) expect(describeUnit(lang, u, p)).not.toMatch(/\{\w+\}|unit\./);
  });

  it('every explanation for 60 random impossible projects is reproducible and minimal', () => {
    let explained = 0;
    let minimal = 0;
    for (let seed = 1; explained < 60 && seed < 5000; seed++) {
      const p = randomProject(seed * 31, { staff: [1, 3], days: [1, 5], shifts: [1, 2] });
      const r = solve(p, { seed, exactBudget: 2_000_000 });
      const impossible =
        (r.status === 'none' && r.proven) || (r.status !== 'none' && r.coverageImpossible);
      if (!impossible || gridCount(p) > 40_000) continue;
      const e = explain(p, r, { nodes: 20_000_000 });
      expect(e, `seed ${seed}: an impossible small project must be explained`).not.toBeNull();
      if (!e) continue;
      explained++;
      const big = { nodes: 50_000_000 };
      // Still impossible with only these rules (solver)…
      const sub = e.days === p.days ? p : { ...p }; // explanations of tiny projects use the full period or one day
      void sub;
      expect(decide(scoped(p, e), e.units, e.goal, big, 5_000_000), `seed ${seed}`).toBe(
        'infeasible',
      );
      // …and by brute force, independently of the solver.
      const relaxed = relaxTo(scoped(p, e), e.units);
      const bf = bruteForceRelaxed(
        relaxed.project,
        relaxed.relax.zeroNeed!,
        relaxed.relax.zeroSkill!,
      );
      if (e.goal === 'coverage') expect(bf.anyCovered, `seed ${seed} brute force`).toBe(false);
      else expect(bf.anyValid, `seed ${seed} brute force`).toBe(false);
      if (e.minimal) {
        minimal++;
        for (const u of e.units) {
          const rest = e.units.filter((x) => x !== u);
          expect(
            decide(scoped(p, e), rest, e.goal, big, 5_000_000),
            `seed ${seed} without ${JSON.stringify(u)}`,
          ).toBe('feasible');
          const rx = relaxTo(scoped(p, e), rest);
          const b2 = bruteForceRelaxed(rx.project, rx.relax.zeroNeed!, rx.relax.zeroSkill!);
          expect(
            e.goal === 'coverage' ? b2.anyCovered : b2.anyValid,
            `seed ${seed} brute force without ${u.type}`,
          ).toBe(true);
        }
      }
    }
    expect(explained).toBe(60);
    expect(minimal).toBe(60);
  });
});

import { restrictPeriod } from '../../packages/core/src/index';
import type { Explanation, Project } from '../../packages/core/src/index';
function scoped(p: Project, e: Explanation): Project {
  const first = Date.UTC(+p.start.slice(0, 4), +p.start.slice(5, 7) - 1, +p.start.slice(8, 10));
  const s = Date.UTC(+e.start.slice(0, 4), +e.start.slice(5, 7) - 1, +e.start.slice(8, 10));
  const offset = Math.round((s - first) / 86_400_000);
  return offset === 0 && e.days === p.days ? p : restrictPeriod(p, offset, e.days);
}
export type { Unit };
