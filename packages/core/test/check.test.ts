// SPDX-License-Identifier: AGPL-3.0-or-later
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { checkRoster } from '../src/check/index';
import type { CheckFn } from './helpers/check-cases';
import { GOLDEN_CASES, runGolden } from './helpers/check-cases';
import { project } from './helpers/fixtures';

describe('checker golden cases', () => {
  it('has at least 6 cases for every hard rule', () => {
    const per = new Map<string, number>();
    for (const c of GOLDEN_CASES) per.set(c.rule, (per.get(c.rule) ?? 0) + 1);
    for (const rule of [
      'rest',
      'overlap',
      'availability',
      'leave',
      'weeklyMax',
      'consecutive',
      'restDay',
    ])
      expect(per.get(rule) ?? 0, rule).toBeGreaterThanOrEqual(6);
    expect((per.get('weeklyMin') ?? 0) + (per.get('weeklyMax') ?? 0)).toBeGreaterThanOrEqual(9);
    expect(
      (per.get('overstaffed') ?? 0) + (per.get('skill') ?? 0) + (per.get('lock') ?? 0),
    ).toBeGreaterThanOrEqual(6);
  });

  for (const c of GOLDEN_CASES)
    it(`[${c.rule}] ${c.name}`, () => {
      const rep = checkRoster(c.project, c.roster);
      expect(rep.violations.map((v) => v.rule).sort()).toEqual(c.violations);
      if (c.shortfall !== undefined) expect(rep.shortfall).toBe(c.shortfall);
      if (c.gapKinds) expect(rep.gaps.map((g) => g.kind).sort()).toEqual(c.gapKinds);
      expect(rep.valid).toBe(c.violations.length === 0);
    });
});

describe('checker details', () => {
  it('reports numbers: rest gap and limit', () => {
    const c = GOLDEN_CASES.find((x) => x.name === '1 minute short')!;
    const v = checkRoster(c.project, c.roster).violations[0]!;
    expect(v).toMatchObject({
      rule: 'rest',
      staff: 'p',
      date: '2026-11-03',
      value: 659,
      limit: 660,
    });
  });

  it('scores soft rules: preferences, fairness, stability, isolated day off', () => {
    const p = project({
      days: 3,
      shifts: [{ id: 'e', name: 'E', start: '09:00', end: '17:00', demand: [1, 1, 1, 1, 1, 1, 1] }],
      staff: [
        { id: 'a', name: 'A', preferences: [{ kind: 'avoid', shift: 'e', weekday: 0, weight: 2 }] },
        { id: 'b', name: 'B', preferences: [{ kind: 'want', date: '2026-11-03', weight: 3 }] },
      ],
      skills: [],
      rules: { minRestMinutes: 0, restDay: { enabled: false } },
      previous: [{ staff: 'a', date: '2026-11-02', shift: null }],
    });
    const rep = checkRoster(p, {
      assignments: [
        { staff: 'a', date: '2026-11-02', shift: 'e' },
        { staff: 'a', date: '2026-11-03', shift: 'e' },
        { staff: 'a', date: '2026-11-04', shift: 'e' },
      ],
    });
    // avoid hit (2) + want missed (3) = 5 points × 10; hours spread 24 h × 1; stability 1 × 3.
    expect(rep.penalty).toEqual({
      preference: 50,
      fairHours: 24,
      fairWeekend: 0,
      fairNight: 0,
      stability: 3,
      isolatedDayOff: 0,
      total: 77,
    });
    const iso = checkRoster(p, {
      assignments: [
        { staff: 'b', date: '2026-11-02', shift: 'e' },
        { staff: 'a', date: '2026-11-03', shift: 'e' },
        { staff: 'b', date: '2026-11-04', shift: 'e' },
      ],
    });
    expect(iso.penalty.isolatedDayOff).toBe(4);
  });

  it('never throws on random rosters and is symmetric in assignment order', () => {
    const p = project({ days: 7 });
    const ids = ['a', 'b', 'c'];
    const shifts = ['early', 'late'];
    const arb = fc.array(
      fc.record({
        staff: fc.constantFrom(...ids),
        date: fc
          .integer({ min: 0, max: 8 })
          .map((i) => `2026-11-${String(2 + i).padStart(2, '0')}`),
        shift: fc.constantFrom(...shifts),
      }),
      { maxLength: 30 },
    );
    fc.assert(
      fc.property(arb, (assignments) => {
        const r1 = checkRoster(p, { assignments });
        const r2 = checkRoster(p, { assignments: [...assignments].reverse() });
        const key = (r: typeof r1) =>
          JSON.stringify([r.violations.map((v) => v.rule).sort(), r.shortfall, r.penalty]);
        expect(key(r1)).toBe(key(r2));
      }),
      { numRuns: 300, seed: 11 },
    );
  });
});

// ---------------------------------------------------------------------------------
// Mutation testing: deliberately break the checker in small, realistic ways; the golden
// table must notice every mutant. Each mutant is a copy of check/ written next to it.
// ---------------------------------------------------------------------------------
const srcDir = fileURLToPath(new URL('../src', import.meta.url));
const checkSrc = readFileSync(join(srcDir, 'check', 'check.ts'), 'utf8');
const created: string[] = [];
afterAll(() => {
  for (const d of created) rmSync(d, { recursive: true, force: true });
});

const MUTANTS: [string, string, string][] = [
  [
    'rest: < becomes <=',
    'else if (gap < project.rules.minRestMinutes)',
    'else if (gap <= project.rules.minRestMinutes)',
  ],
  [
    'overnight shifts end on the same day',
    'return shiftInterval(day, parseTime(shift.start) ?? 0, parseTime(shift.end) ?? 0, tz);',
    'return { start: zonedInstant(day, parseTime(shift.start) ?? 0, tz), end: zonedInstant(day, parseTime(shift.end) ?? 0, tz) };',
  ],
  [
    'rest day = calendar day without a shift',
    'const restDays = countRestPeriods(busy, win, rule.minMinutes);',
    'let restDays = 0; void busy; void win; for (let d = first + k; d < first + k + 7; d++) if (!startDays.has(d)) restDays++;',
  ],
  [
    'rest day accepts 23 h 59 m',
    'if (s > cursor) n += Math.floor((s - cursor) / minMinutes);',
    'if (s > cursor) n += Math.floor((s - cursor + 1) / minMinutes);',
  ],
  [
    'week boundary off by one day',
    'const anchor = first - ((weekday(first) - project.rules.weekStart + 7) % 7);',
    'const anchor = first - ((weekday(first) - project.rules.weekStart + 7) % 7) + 1;',
  ],
  ['skills counted with OR instead of AND', 'req.skills.every((k)', 'req.skills.some((k)'],
  [
    'touching shifts count as overlap',
    'if (next.iv.start < prev.iv.end)',
    'if (next.iv.start <= prev.iv.end)',
  ],
  [
    'consecutive: > becomes >=',
    'if (run > person.maxConsecutiveDays)',
    'if (run >= person.maxConsecutiveDays)',
  ],
  [
    'leave checks only the start date',
    'if (p.iv.start < lv.end && lv.start < p.iv.end)',
    'if (p.day === lday)',
  ],
  [
    'availability ignores the previous day',
    'for (let d = day - 1; d <= day + 1; d++)',
    'for (let d = day; d <= day + 1; d++)',
  ],
  [
    'weekly max: > becomes >=',
    'if (minutes > person.maxWeeklyMinutes)',
    'if (minutes >= person.maxWeeklyMinutes)',
  ],
  ['overstaffing allowed by one', 'if (who.length > need)', 'if (who.length > need + 1)'],
  [
    'locked day off ignored',
    'lock.shift === null ? cell.length === 0',
    'lock.shift === null ? true',
  ],
  ['fixed mode used for rolling', "const step = rule.mode === 'fixed' ? 7 : 1;", 'const step = 7;'],
  [
    'partial weeks checked for minimum hours',
    'const fullWeek = startDay >= first && startDay + 6 <= last;',
    'const fullWeek = true;',
  ],
  [
    'rest-day rule ignores trailing rest',
    'if (win.end > cursor) n += Math.floor((win.end - cursor) / minMinutes);',
    'void cursor;',
  ],
];

describe('checker mutation testing', () => {
  it('has at least 8 mutants and each one changes the source exactly once', () => {
    expect(MUTANTS.length).toBeGreaterThanOrEqual(8);
    for (const [name, from] of MUTANTS) expect(checkSrc.split(from).length - 1, name).toBe(1);
  });

  for (const [name, from, to] of MUTANTS)
    it(`catches mutant: ${name}`, async () => {
      const dir = join(
        srcDir,
        `check-mutant-${MUTANTS.findIndex((m) => m[0] === name)}-${process.pid}`,
      );
      created.push(dir);
      mkdirSync(dir, { recursive: true });
      cpSync(join(srcDir, 'check', 'types.ts'), join(dir, 'types.ts'));
      writeFileSync(join(dir, 'check.ts'), checkSrc.replace(from, to));
      const mod = (await import(pathToFileURL(join(dir, 'check.ts')).href)) as {
        checkRoster: CheckFn;
      };
      const failed = runGolden(mod.checkRoster);
      expect(failed.length, `mutant "${name}" survived`).toBeGreaterThan(0);
    });

  it('the unmutated checker passes the whole table', () => {
    expect(runGolden(checkRoster)).toEqual([]);
  });
});

describe('violation sentences', () => {
  it('render every golden violation in both languages without placeholders', async () => {
    const { describeViolation, describeGap, LANGS } = await import('../src/index');
    let n = 0;
    for (const c of GOLDEN_CASES) {
      const rep = checkRoster(c.project, c.roster);
      for (const lang of LANGS) {
        for (const v of rep.violations) {
          const s = describeViolation(lang, v, c.project);
          expect(s).not.toMatch(/\{\w+\}|violation\./);
          n++;
        }
        for (const g of rep.gaps)
          expect(describeGap(lang, g, c.project)).not.toMatch(/\{\w+\}|gap\./);
      }
    }
    expect(n).toBeGreaterThan(40);
  });

  it('formats a rest violation with hours and minutes', async () => {
    const { describeViolation } = await import('../src/index');
    const c = GOLDEN_CASES.find((x) => x.name === '1 minute short')!;
    const v = checkRoster(c.project, c.roster).violations[0]!;
    expect(describeViolation('en', v, c.project)).toBe(
      'P: only 10 h 59 min of rest between L (2026-11-02) and E0959 (2026-11-03); at least 11 h needed.',
    );
    expect(describeViolation('zh-HK', v, c.project)).toContain('10 小時 59 分鐘');
  });
});
