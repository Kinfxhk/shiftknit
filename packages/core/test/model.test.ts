// SPDX-License-Identifier: AGPL-3.0-or-later
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LANGS,
  LIMITS,
  MESSAGES,
  applyMigrations,
  describeError,
  safeParseJson,
  validateProject,
  validateRoster,
} from '../src/index';
import type { ModelError } from '../src/index';
import { project, rawProject } from './helpers/fixtures';

const codes = (r: { ok: boolean; errors?: ModelError[] }) =>
  r.ok ? [] : (r as { errors: ModelError[] }).errors.map((e) => e.code);

/** Every error must render to a real sentence in both languages. */
function expectBilingual(errors: ModelError[]) {
  expect(errors.length).toBeGreaterThan(0);
  for (const e of errors)
    for (const lang of LANGS) {
      const text = describeError(lang, e);
      expect(text).not.toContain('error.');
      expect(text).not.toMatch(/\{\w+\}/);
    }
}

describe('project validation', () => {
  it('accepts a valid project and fills defaults', () => {
    const p = project();
    expect(p.rules.minRestMinutes).toBe(660);
    expect(p.rules.restDay).toEqual({ enabled: true, count: 1, minMinutes: 1440, mode: 'rolling' });
    expect(p.shifts[0]!.demand).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(p.staff[1]!.maxConsecutiveDays).toBe(6);
    expect(p.locks).toEqual([]);
  });

  it('marks overnight shifts as night shifts by default', () => {
    const p = project({
      shifts: [{ id: 'n', name: 'Night', start: '22:00', end: '07:00', demand: 1 }],
    });
    expect(p.shifts[0]!.night).toBe(true);
  });

  it.each([
    ['unknown field', { colour: 'red' }, 'field.unknown'],
    ['bad zone', { timeZone: 'Mars/Base' }, 'field.timeZone'],
    ['bad date', { start: '2026-02-30' }, 'field.date'],
    ['too many days', { days: 32 }, 'field.range'],
    ['zero days', { days: 0 }, 'field.range'],
    ['fractional days', { days: 1.5 }, 'field.integer'],
    [
      'negative demand',
      { shifts: [{ id: 's', name: 'S', start: '09:00', end: '17:00', demand: -1 }] },
      'field.range',
    ],
    [
      '24:30 time',
      { shifts: [{ id: 's', name: 'S', start: '24:30', end: '17:00', demand: 1 }] },
      'field.time',
    ],
    [
      'zero-length shift',
      { shifts: [{ id: 's', name: 'S', start: '09:00', end: '09:00', demand: 1 }] },
      'shift.zeroLength',
    ],
    [
      'break too long',
      {
        shifts: [{ id: 's', name: 'S', start: '09:00', end: '10:00', breakMinutes: 60, demand: 1 }],
      },
      'shift.breakTooLong',
    ],
    [
      'duplicate staff id',
      {
        staff: [
          { id: 'a', name: 'A' },
          { id: 'a', name: 'B' },
        ],
      },
      'field.duplicateId',
    ],
    ['bad id chars', { staff: [{ id: 'a b', name: 'A' }] }, 'field.pattern'],
    ['unknown skill', { staff: [{ id: 'a', name: 'A', skills: ['nurse'] }] }, 'field.unknownRef'],
    [
      'lock outside period',
      { locks: [{ staff: 'a', date: '2027-01-01', shift: 'early' }] },
      'date.outsidePeriod',
    ],
    [
      'lock unknown shift',
      { locks: [{ staff: 'a', date: '2026-11-02', shift: 'zzz' }] },
      'field.unknownRef',
    ],
    [
      'duplicate lock cell',
      {
        locks: [
          { staff: 'a', date: '2026-11-02', shift: 'early' },
          { staff: 'a', date: '2026-11-02', shift: null },
        ],
      },
      'cell.duplicate',
    ],
    ['control chars in name', { name: 'Shop\u0007' }, 'field.control'],
    [
      'min above max hours',
      { staff: [{ id: 'a', name: 'A', minWeeklyMinutes: 600, maxWeeklyMinutes: 300 }] },
      'staff.minAboveMax',
    ],
    [
      'wrong demand length',
      { shifts: [{ id: 's', name: 'S', start: '09:00', end: '17:00', demand: [1, 2, 3] }] },
      'field.length',
    ],
    ['bad rest mode', { rules: { restDay: { mode: 'weekly' } } }, 'field.enum'],
  ])('rejects %s', (_name, over, code) => {
    const r = validateProject(rawProject(over));
    expect(codes(r)).toContain(code);
    if (!r.ok) expectBilingual(r.errors);
  });

  it('enforces the size limits', () => {
    const staff = Array.from({ length: LIMITS.staff + 1 }, (_, i) => ({
      id: `s${i}`,
      name: `S${i}`,
    }));
    expect(codes(validateProject(rawProject({ staff })))).toContain('limit.exceeded');
    const shifts = Array.from({ length: LIMITS.shifts + 1 }, (_, i) => ({
      id: `x${i}`,
      name: 'X',
      start: '09:00',
      end: '10:00',
      demand: 0,
    }));
    expect(codes(validateProject(rawProject({ shifts })))).toContain('limit.exceeded');
    const skills = Array.from({ length: LIMITS.skills + 1 }, (_, i) => `k${i}`);
    expect(codes(validateProject(rawProject({ skills })))).toContain('limit.exceeded');
  });

  it('accepts names with emoji, RTL and combining characters (rendered as plain text later)', () => {
    const p = project({
      staff: [
        { id: 'a', name: '陳大文 👩‍⚕️' },
        { id: 'b', name: 'مريم' },
        { id: 'c', name: 'Zoe\u0301' },
      ],
    });
    expect(p.staff.map((s) => s.name)).toEqual(['陳大文 👩‍⚕️', 'مريم', 'Zoe\u0301']);
  });
});

describe('hostile JSON', () => {
  it('rejects __proto__ and constructor keys anywhere', () => {
    for (const text of [
      '{"__proto__": {"polluted": true}, "schema": "shiftknit/project"}',
      JSON.stringify(rawProject()).replace(
        '"name":"Ann"',
        '"name":"Ann","constructor":{"prototype":1}',
      ),
      '{"a":[{"prototype":1}]}',
    ]) {
      const r = safeParseJson(text);
      expect(codes(r)).toContain('json.forbiddenKey');
      if (!r.ok) expectBilingual(r.errors);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects 1,000 levels of nesting before parsing', () => {
    const text = '['.repeat(1000) + ']'.repeat(1000);
    const r = safeParseJson(text);
    expect(codes(r)).toEqual(['json.tooDeep']);
    if (!r.ok) expectBilingual(r.errors);
  });

  it('does not count brackets inside strings as nesting', () => {
    const r = safeParseJson(
      JSON.stringify({ a: '[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[["\\' }),
    );
    expect(r.ok).toBe(true);
  });

  it('rejects a 10 MB string', () => {
    const r = safeParseJson(JSON.stringify({ name: 'x'.repeat(10 * 1024 * 1024) }));
    expect(codes(r)).toEqual(['json.tooLarge']);
    if (!r.ok) expectBilingual(r.errors);
  });

  it('rejects syntax errors, NaN, Infinity and negative numbers', () => {
    expect(codes(safeParseJson('{"days": NaN}'))).toEqual(['json.syntax']);
    expect(codes(validateProject({ ...rawProject(), days: Number.NaN }))).toContain(
      'field.notFinite',
    );
    expect(codes(validateProject({ ...rawProject(), days: Infinity }))).toContain(
      'field.notFinite',
    );
    expect(codes(validateProject(rawProject({ days: -3 })))).toContain('field.range');
  });

  it('rejects cyclic object graphs and class instances', () => {
    const o = rawProject() as Record<string, unknown>;
    (o.staff as unknown[]).push(o);
    expect(codes(validateProject(o))).toContain('json.cycle');
    expect(codes(validateProject({ ...rawProject(), start: new Date() }))).toContain('field.type');
  });

  it('rejects long strings and duplicate ids', () => {
    expect(codes(validateProject(rawProject({ name: 'n'.repeat(500) })))).toContain(
      'field.tooLong',
    );
    expect(codes(validateProject(rawProject({ skills: ['x', 'x'] })))).toContain(
      'field.duplicateId',
    );
  });

  it('rejects non-project files and newer formats', () => {
    expect(codes(validateProject({ schema: 'other', version: 1 }))).toEqual(['schema.wrong']);
    expect(codes(validateProject({ ...rawProject(), version: 2 }))).toEqual(['schema.newer']);
    expect(codes(validateProject([]))).toEqual(['field.type']);
    expect(codes(validateProject(null))).toEqual(['field.type']);
  });
});

describe('migrations', () => {
  it('upgrades step by step with a synthetic chain', () => {
    const r = applyMigrations(
      { schema: 'shiftknit/project', version: 1, a: 1 },
      { 1: (o) => ({ ...o, b: 2 }), 2: (o) => ({ ...o, c: (o.b as number) + 1 }) },
      3,
    );
    expect(r).toEqual({
      ok: true,
      value: { schema: 'shiftknit/project', version: 3, a: 1, b: 2, c: 3 },
    });
  });

  it('refuses a version with no migration path', () => {
    const r = applyMigrations({ schema: 'shiftknit/project', version: 0 }, {}, 1);
    expect(codes(r)).toEqual(['schema.unsupported']);
  });

  it('leaves current files unchanged', () => {
    const raw = rawProject();
    const r = applyMigrations(raw, {}, 1);
    expect(r).toEqual({ ok: true, value: raw });
  });
});

describe('roster validation', () => {
  it('accepts a bare roster or a solver result', () => {
    const p = project();
    const a = [{ staff: 'a', date: '2026-11-02', shift: 'early' }];
    expect(validateRoster({ assignments: a }, p)).toEqual({ ok: true, value: { assignments: a } });
    expect(validateRoster({ schema: 'shiftknit/result', roster: { assignments: a } }, p).ok).toBe(
      true,
    );
  });
  it('rejects unknown references', () => {
    const p = project();
    expect(
      codes(
        validateRoster({ assignments: [{ staff: 'zz', date: '2026-11-02', shift: 'early' }] }, p),
      ),
    ).toContain('field.unknownRef');
  });
});

describe('message catalogue', () => {
  it('has the same keys in English and Chinese', () => {
    expect(Object.keys(MESSAGES['zh-HK']).sort()).toEqual(Object.keys(MESSAGES.en).sort());
  });

  it('has a message for every error code used in the core source', () => {
    const srcDir = fileURLToPath(new URL('../src', import.meta.url));
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
      );
    const used = new Set<string>();
    for (const f of walk(srcDir).filter((x) => x.endsWith('.ts'))) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/(?:code: |c\.err\(|err\()'([a-z]+\.[A-Za-z]+)'/g))
        used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(20);
    for (const code of used) expect(MESSAGES.en, code).toHaveProperty([`error.${code}`]);
  });
});
