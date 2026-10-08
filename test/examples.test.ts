// SPDX-License-Identifier: AGPL-3.0-or-later
// Every example project must open, solve to a fully staffed rota, and pass the checker.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkRoster,
  exportProject,
  importProject,
  solveAndCheck,
} from '../packages/core/src/index';

const dir = fileURLToPath(new URL('../examples/', import.meta.url));
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort();

describe('examples', () => {
  it('there are at least three', () => {
    expect(files).toEqual(['care-home-nights.json', 'small-shop.json', 'volunteer-team.json']);
  });

  for (const f of files) {
    it(`${f}: valid, solvable, passes the independent checker, deterministic`, () => {
      const r = importProject(readFileSync(join(dir, f), 'utf8'));
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      const p = r.value;
      const a = solveAndCheck(p, { seed: 1 });
      expect(a.rejected).toBe(false);
      expect(a.result.status).toBe('complete');
      const report = checkRoster(p, a.result.roster!);
      expect(report.valid).toBe(true);
      expect(report.shortfall).toBe(0);
      expect(solveAndCheck(p, { seed: 1 }).result.roster).toEqual(a.result.roster);
      expect(importProject(exportProject(p))).toEqual({ ok: true, value: p });
    });
  }
});
