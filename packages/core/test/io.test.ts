// SPDX-License-Identifier: AGPL-3.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  escapeText,
  exportProject,
  foldLine,
  gridCsv,
  importProject,
  listCsv,
  neutralise,
  parseCsv,
  restDayTable,
  solveAndCheck,
  staffCalendar,
  toCsv,
} from '../src/index';
import { randomProject } from '../../../test/oracle/random-project';
import { project } from './helpers/fixtures';

const STAMP = Date.UTC(2026, 9, 8, 0, 0) / 60_000;

describe('CSV', () => {
  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx', '=HYPERLINK("http://x","y")'])(
    'neutralises formula-looking field %j',
    (f) => {
      expect(neutralise(f)).toBe(`'${f}`);
      expect(parseCsv(toCsv([[f]]))[0]![0]).toBe(`'${f}`);
    },
  );

  it('leaves ordinary fields alone and quotes when needed', () => {
    expect(toCsv([['a', 'b,c', 'say "hi"', 'line\nbreak', ' pad ']], false)).toBe(
      'a,"b,c","say ""hi""","line\nbreak"," pad "\r\n',
    );
    expect(toCsv([['x']])).toBe('\ufeffx\r\n');
  });

  it('round-trips any table (1000 runs)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.string({ unit: 'binary' }), { minLength: 1, maxLength: 6 }), {
          minLength: 1,
          maxLength: 6,
        }),
        fc.boolean(),
        (rows, bom) => {
          expect(parseCsv(toCsv(rows, bom))).toEqual(rows.map((r) => r.map(neutralise)));
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('a hostile staff name cannot become a formula in the grid or list export', () => {
    const p = project({
      staff: [
        { id: 'a', name: '=cmd|"/c calc"!A1', skills: ['firstaid'] },
        { id: 'b', name: '@evil' },
        { id: 'c', name: 'Cat, the "boss"' },
      ],
    });
    const { result } = solveAndCheck(p, { seed: 1 });
    for (const text of [gridCsv(p, result.roster!, 'en'), listCsv(p, result.roster!, 'zh-HK')]) {
      const cells = parseCsv(text).flat();
      expect(cells.some((c) => /^[=+\-@\t\r]/.test(c))).toBe(false);
      expect(cells).toContain(`'=cmd|"/c calc"!A1`);
    }
    const grid = parseCsv(gridCsv(p, result.roster!, 'en'));
    expect(grid[0]).toEqual([
      'Staff',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ]);
    expect(grid[3]![0]).toBe('Cat, the "boss"');
  });
});

/** Independent tiny iCalendar reader for the tests (unfold, split, unescape). */
function readIcs(text: string): { name: string; value: string }[][] {
  expect(text.endsWith('\r\n')).toBe(true);
  expect(/[^\r]\n/.test(text)).toBe(false);
  const physical = text.slice(0, -2).split('\r\n');
  for (const l of physical) {
    const bytes = new TextEncoder().encode(l);
    expect(bytes.length).toBeLessThanOrEqual(75);
    new TextDecoder('utf-8', { fatal: true }).decode(bytes); // throws on a split character
  }
  const logical = text
    .slice(0, -2)
    .replace(/\r\n[ \t]/g, '')
    .split('\r\n');
  const events: { name: string; value: string }[][] = [];
  let cur: { name: string; value: string }[] | undefined;
  for (const l of logical) {
    const i = l.indexOf(':');
    const name = l.slice(0, i);
    const raw = l.slice(i + 1);
    const value = raw.replace(/\\([\\;,nN])/g, (_, c: string) =>
      c === 'n' || c === 'N' ? '\n' : c,
    );
    if (l === 'BEGIN:VEVENT') cur = [];
    else if (l === 'END:VEVENT') {
      events.push(cur!);
      cur = undefined;
    } else if (cur) cur.push({ name, value });
  }
  return events;
}
const prop = (e: { name: string; value: string }[], n: string) =>
  e.find((x) => x.name === n)?.value;

describe('iCalendar', () => {
  it('escapes text and folds long lines without splitting UTF-8', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 300 }), (s) => {
        const folded = foldLine(`SUMMARY:${s}`);
        for (const l of folded.split('\r\n'))
          expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
        expect(folded.replace(/\r\n /g, '')).toBe(`SUMMARY:${s}`);
      }),
      { numRuns: 500 },
    );
  });

  it('writes overnight shifts across a DST change with exact UTC times', () => {
    const p = project({
      timeZone: 'America/New_York',
      start: '2026-10-31',
      days: 2,
      skills: [],
      shifts: [{ id: 'n', name: 'Night; ward 3, "B"', start: '22:00', end: '06:00', demand: 0 }],
      staff: [{ id: 'a', name: '陳大文' }],
      rules: { restDay: { enabled: false }, minRestMinutes: 0 },
    });
    const roster = {
      assignments: [
        { staff: 'a', date: '2026-10-31', shift: 'n' },
        { staff: 'a', date: '2026-11-01', shift: 'n' },
      ],
    };
    const text = staffCalendar(p, roster, 'a', { stamp: STAMP });
    const ev = readIcs(text);
    expect(ev).toHaveLength(2);
    expect(prop(ev[0]!, 'DTSTART')).toBe('20261101T020000Z'); // 22:00 EDT
    expect(prop(ev[0]!, 'DTEND')).toBe('20261101T110000Z'); // 06:00 EST: a 9-hour night
    expect(prop(ev[1]!, 'DTSTART')).toBe('20261102T030000Z'); // 22:00 EST
    expect(prop(ev[1]!, 'DTEND')).toBe('20261102T110000Z');
    expect(prop(ev[0]!, 'SUMMARY')).toBe('Night; ward 3, "B"');
    expect(prop(ev[0]!, 'DTSTAMP')).toBe('20261008T000000Z');
    expect(prop(ev[0]!, 'UID')).not.toBe(prop(ev[1]!, 'UID'));
    expect(text).toContain('X-WR-CALNAME:Test shop – 陳大文');
    expect(staffCalendar(p, roster, 'a', { stamp: STAMP })).toBe(text);
  });

  it('every event of a solved rota round-trips through the reader (200 random projects)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const p = randomProject(seed * 7, { staff: [1, 5], days: [1, 9], shifts: [1, 3] });
      const { result } = solveAndCheck(p, { seed, searchBudget: 2000, exactBudget: 2000 });
      if (!result.roster) continue;
      for (const s of p.staff) {
        const ev = readIcs(staffCalendar(p, result.roster, s.id, { stamp: STAMP }));
        expect(ev).toHaveLength(result.roster.assignments.filter((a) => a.staff === s.id).length);
        for (const e of ev) expect(prop(e, 'DTEND')! > prop(e, 'DTSTART')!).toBe(true);
        expect(new Set(ev.map((e) => prop(e, 'UID'))).size).toBe(ev.length);
      }
    }
  });
});

describe('JSON', () => {
  it('export → import round-trips (1000 random projects)', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const p = randomProject(seed, { staff: [1, 8], days: [1, 31], shifts: [0, 6] });
      const r = importProject(exportProject(p));
      if (!r.ok) throw new Error(`seed ${seed}: ${JSON.stringify(r.errors)}`);
      expect(r.value).toEqual(p);
    }
  });

  it.each([
    ['{"__proto__":{"x":1}}'],
    ['[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]'],
    ['not json'],
    ['{"schema":"shiftknit/project","version":99}'],
    [' '.repeat(1_000_001)],
  ])('rejects hostile input %#', (text) => {
    expect(importProject(text).ok).toBe(false);
  });
});

describe('rest-day table', () => {
  it('a night shift that ends in the morning uses up the next calendar day', () => {
    const p = project({
      days: 3,
      skills: [],
      shifts: [{ id: 'n', name: 'Night', start: '22:00', end: '07:00', demand: 0 }],
      staff: [
        { id: 'a', name: 'Ann' },
        { id: 'b', name: 'Ben' },
      ],
    });
    const t = restDayTable(p, { assignments: [{ staff: 'a', date: '2026-11-02', shift: 'n' }] });
    expect(t[0]!.restDates).toEqual(['2026-11-04']);
    expect(t[1]!.restDates).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
  });
});
