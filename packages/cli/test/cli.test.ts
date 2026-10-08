// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parseDuration, run } from '../src/main';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const example = join(root, 'examples', 'small-shop.json');
const dir = mkdtempSync(join(tmpdir(), 'shiftknit-cli-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function call(args: string[]): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const code = run(args, {
    out: (s) => (out += s + '\n'),
    err: (s) => (err += s + '\n'),
    now: () => Date.UTC(2026, 9, 8),
  });
  return { code, out, err };
}

describe('shiftknit CLI', () => {
  it('parses time limits', () => {
    expect(parseDuration('10s')).toBe(10_000);
    expect(parseDuration('500ms')).toBe(500);
    expect(parseDuration('2m')).toBe(120_000);
    expect(parseDuration('3')).toBe(3000);
    expect(() => parseDuration('soon')).toThrow();
    expect(() => parseDuration('0s')).toThrow();
  });

  it('solve → check → export round trip on the sample shop', () => {
    const resultFile = join(dir, 'result.json');
    const s = call([
      'solve',
      example,
      '--seed',
      '1',
      '--time-limit',
      '30s',
      '--out',
      resultFile,
      '--text',
    ]);
    expect(s.code).toBe(0);
    expect(s.err).toMatch(/status: complete/);
    const result = JSON.parse(readFileSync(resultFile, 'utf8')) as {
      status: string;
      rejected: boolean;
    };
    expect(result.status).toBe('complete');
    expect(result.rejected).toBe(false);

    const c = call(['check', example, resultFile]);
    expect(c.code).toBe(0);
    expect(JSON.parse(c.out).valid).toBe(true);

    const ics = call(['export', example, resultFile, '--format', 'ics', '--staff', 'ada']);
    expect(ics.code).toBe(0);
    expect(ics.out).toMatch(/^BEGIN:VCALENDAR\r\n/);
    const csv = call(['export', example, resultFile, '--format', 'csv-grid']);
    expect(csv.out.split('\r\n')[0]).toMatch(/^\ufeffStaff,2026-11-02/);
  });

  it('reports broken rules with exit code 2', () => {
    const roster = join(dir, 'bad.json');
    writeFileSync(
      roster,
      JSON.stringify({
        assignments: [
          { staff: 'ada', date: '2026-11-02', shift: 'close' },
          { staff: 'ada', date: '2026-11-03', shift: 'open' }, // 9 h rest < 11 h
        ],
      }),
    );
    const c = call(['check', example, roster, '--text', '--lang', 'zh-HK']);
    expect(c.code).toBe(2);
    expect(JSON.parse(c.out).violations.some((v: { rule: string }) => v.rule === 'rest')).toBe(
      true,
    );
    expect(c.err).toMatch(/INVALID/);
  });

  it('refuses bad input with exit code 1 and a clear message', () => {
    const bad = join(dir, 'proto.json');
    writeFileSync(bad, '{"__proto__":{"x":1}}');
    expect(call(['solve', bad]).code).toBe(1);
    expect(call(['solve', join(dir, 'missing.json')]).err).toMatch(/cannot read/);
    expect(call(['solve', example, '--seed', '-1']).code).toBe(1);
    expect(call(['frobnicate']).code).toBe(1);
    expect(call(['solve', example, '--bogus']).err).toMatch(/unknown option/);
    expect(call(['export', example, example, '--format', 'pdf']).code).toBe(1);
  });

  it('exit code 3 for a proven impossible project, with an explanation', () => {
    const p = JSON.parse(readFileSync(example, 'utf8')) as Record<string, unknown>;
    const file = join(dir, 'none.json');
    writeFileSync(
      file,
      JSON.stringify({
        ...p,
        days: 1,
        staff: [{ id: 'x', name: 'X', skills: ['keyholder'], maxWeeklyMinutes: 60 }],
        locks: [{ staff: 'x', date: '2026-11-02', shift: 'open' }],
      }),
    );
    const s = call(['solve', file, '--text']);
    expect(s.code).toBe(3);
    expect(JSON.parse(s.out).explanation.units.length).toBeGreaterThan(0);
    expect(s.err).toMatch(/conflict/);
  });

  it('runs as a real process (node --import tsx), the same way on every OS', () => {
    const out = execFileSync(
      process.execPath,
      ['--import', 'tsx', join(root, 'packages', 'cli', 'src', 'main.ts'), '--version'],
      {
        cwd: root,
        encoding: 'utf8',
      },
    );
    expect(out.trim()).toBe('0.1.0');
  });
});
