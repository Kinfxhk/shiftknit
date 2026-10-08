// SPDX-License-Identifier: AGPL-3.0-or-later
// v0.2 sharing features: share file, availability replies, change lists, weekly hours,
// backups. Adversarial cases first; property tests compare against independent code
// (the checker's weekly-hours rule, a direct cell map).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AvailabilityReply, Project, Roster } from '../src/index';
import {
  SHARE_TEXT,
  applyChanges,
  applyReply,
  availabilityFormHtml,
  changesCsv,
  checkRoster,
  diffAvailability,
  diffRosters,
  escapeHtml,
  exportBackup,
  hoursCsv,
  importBackup,
  jsonForScript,
  normalizeReply,
  parseAvailabilityReplies,
  replyText,
  shareHtml,
  staffToReply,
  validatePublished,
  weeklyHours,
} from '../src/index';
import { randomProject, TestRng } from '../../../test/oracle/random-project';
import { project } from './helpers/fixtures';

const HOSTILE = [
  '<script>alert(1)</script>',
  '"><img src=x onerror=alert(1)>',
  "'; background:url(https://evil.example/x)",
  '</style><script src="https://evil.example/a.js"></script>',
  '<!-- </script> -->',
  '&lt;b&gt;',
];

function randomRoster(p: Project, seed: number, density = 40): Roster {
  const r = new TestRng(seed);
  const first = Date.parse(`${p.start}T00:00:00Z`) / 86_400_000;
  const assignments: Roster['assignments'] = [];
  for (const s of p.staff)
    for (let d = 0; d < p.days; d++)
      if (r.chance(density)) {
        const date = new Date((first + d) * 86_400_000).toISOString().slice(0, 10);
        assignments.push({ staff: s.id, date, shift: r.pick(p.shifts).id });
      }
  return { assignments };
}

const cellsOf = (r: Roster) =>
  [...new Set(r.assignments.map((a) => `${a.staff}|${a.date}|${a.shift}`))].sort();

const SIZE = {
  staff: [1, 6] as [number, number],
  days: [1, 15] as [number, number],
  shifts: [1, 3] as [number, number],
};

describe('HTML escaping', () => {
  it('escapes the five special characters and nothing else (property)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (s) => {
        const out = escapeHtml(s);
        expect(out).not.toMatch(/[<>"']/);
        const back = out
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&amp;/g, '&');
        expect(back).toBe(s);
      }),
      { numRuns: 1000 },
    );
  });

  it('JSON inside a script block can never close the block (property)', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        const text = jsonForScript(v);
        expect(text.toLowerCase()).not.toContain('</');
        expect(text).not.toContain('<!--');
        expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(v)));
      }),
      { numRuns: 500 },
    );
  });
});

describe('share file', () => {
  const p = project();
  const roster: Roster = {
    assignments: [
      { staff: 'a', date: '2026-11-02', shift: 'early' },
      { staff: 'b', date: '2026-11-02', shift: 'late' },
      { staff: 'a', date: '2026-11-03', shift: 'late' },
    ],
  };

  it('contains the whole team, each shift and each person, with hours', () => {
    const html = shareHtml(p, roster, {
      lang: 'en',
      version: 'v0.2.0',
      at: '2026-10-08 12:00',
      published: 3,
    });
    expect(html).toContain('Published version 3, 2026-10-08 12:00');
    for (const n of ['Ann', 'Ben', 'Cat', 'Early', 'Late']) expect(html).toContain(n);
    expect(html).toContain('Mon 2026-11-02: Early 07:00–15:00');
    expect(html).toContain('Ann · 15 h'); // 2 × (8 h − 30 min)
    expect(html).toContain('Cat · 0 h');
  });

  it('has no scripts, no external resources and a strict CSP, whatever the names are', () => {
    for (const name of HOSTILE) {
      const q = project({
        name,
        shifts: [{ id: 'early', name, start: '07:00', end: '15:00', breakMinutes: 0, demand: 1 }],
        staff: [{ id: 'a', name: name.slice(0, 80) }],
      });
      const r: Roster = { assignments: [{ staff: 'a', date: '2026-11-02', shift: 'early' }] };
      for (const lang of ['en', 'zh-HK'] as const) {
        const html = shareHtml(q, r, {
          lang,
          version: 'v0.2.0',
          at: name,
          published: 2,
          changes: { since: 1, list: diffRosters({ assignments: [] }, r) },
        });
        // Names are escaped, so every "<" left in the file starts one of our own tags.
        const tags = html.match(/<[^>]*>/g) ?? [];
        for (const tag of tags) {
          expect(tag).not.toMatch(
            /^<(script|img|iframe|object|embed|link|base|form|meta http-equiv="refresh")/i,
          );
          expect(tag).not.toMatch(/\son\w+=|src=|href="(?!#)/i);
        }
        const css = /<style>([^<]*)<\/style>/.exec(html)![1]!;
        expect(css).not.toMatch(/url\(|@import/i);
        expect(html).toContain("content=\"default-src 'none'; style-src 'unsafe-inline'");
        expect(html).toContain(escapeHtml(name));
      }
    }
  });

  it('lists the changes since the earlier version', () => {
    const before: Roster = { assignments: [{ staff: 'a', date: '2026-11-02', shift: 'late' }] };
    const html = shareHtml(p, roster, {
      lang: 'zh-HK',
      version: 'v',
      at: 'x',
      published: 2,
      changes: { since: 1, list: diffRosters(before, roster) },
    });
    expect(html).toContain('與第 1 版比較的改動');
    expect(html).toContain('Ann，2026-11-02：Late → Early');
    expect(html).toContain('Ben，2026-11-02：休 → Late');
  });

  it('both languages have the same text keys and placeholders', () => {
    expect(Object.keys(SHARE_TEXT['zh-HK']).sort()).toEqual(Object.keys(SHARE_TEXT.en).sort());
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(SHARE_TEXT.en) as (keyof typeof SHARE_TEXT.en)[])
      expect(ph(SHARE_TEXT['zh-HK'][k]), k).toEqual(ph(SHARE_TEXT.en[k]));
  });
});

describe('change list', () => {
  it('diff then apply gives back the other rota; no diff against itself (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1e9 }), fc.integer({ min: 1, max: 1e9 }), (s1, s2) => {
        const p = randomProject(s1, SIZE);
        const a = randomRoster(p, s1);
        const b = randomRoster(p, s2);
        const d = diffRosters(a, b);
        expect(cellsOf(applyChanges(a, d))).toEqual(cellsOf(b));
        expect(diffRosters(a, a)).toEqual([]);
        expect(diffRosters(b, a).length).toBe(d.length);
        for (const c of d) expect(c.before.join()).not.toBe(c.after.join());
      }),
      { numRuns: 300 },
    );
  });

  it('ignores order and duplicates, and treats several shifts on one day as one cell', () => {
    const a: Roster = {
      assignments: [
        { staff: 'a', date: '2026-11-02', shift: 'late' },
        { staff: 'a', date: '2026-11-02', shift: 'early' },
      ],
    };
    const b: Roster = { assignments: [...a.assignments].reverse().concat(a.assignments[0]!) };
    expect(diffRosters(a, b)).toEqual([]);
    expect(diffRosters(a, { assignments: [a.assignments[0]!] })).toEqual([
      { staff: 'a', date: '2026-11-02', before: ['early', 'late'], after: ['late'] },
    ]);
  });

  it('change CSV neutralises formula-like names', () => {
    const p = project({ staff: [{ id: 'a', name: '=HYPERLINK("x")' }] });
    const csv = changesCsv(
      'en',
      p,
      [{ staff: 'a', date: '2026-11-02', before: [], after: ['early'] }],
      false,
    );
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('weekly hours', () => {
  it('match the independent checker’s weekly-hours rule on random rotas (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1e9 }), (seed) => {
        const base = randomProject(seed, { staff: [1, 5], days: [1, 22], shifts: [1, 3] });
        // Max 0 h makes the checker report every week with work, with its minutes.
        const p: Project = {
          ...base,
          staff: base.staff.map((s) => ({ ...s, maxWeeklyMinutes: 0, minWeeklyMinutes: 0 })),
        };
        const r = randomRoster(p, seed + 1);
        const table = weeklyHours(p, r);
        const fromChecker = new Map<string, number>();
        for (const v of checkRoster(p, r).violations)
          if (v.rule === 'weeklyMax') fromChecker.set(`${v.staff}|${v.date}`, v.value!);
        for (const row of table.rows)
          table.weeks.forEach((w, i) => {
            expect(row.minutes[i], `${row.staff} ${w}`).toBe(
              fromChecker.get(`${row.staff}|${w}`) ?? 0,
            );
          });
        for (const row of table.rows)
          expect(row.total).toBe(row.minutes.reduce((a, b) => a + b, 0));
      }),
      { numRuns: 200 },
    );
  });

  it('writes a CSV with one column per week', () => {
    const p = project({ days: 10 });
    const csv = hoursCsv(
      'en',
      p,
      { assignments: [{ staff: 'a', date: '2026-11-09', shift: 'early' }] },
      false,
    );
    expect(csv.split('\r\n')[0]).toBe(
      'Person,Week from 2026-11-02,Week from 2026-11-09,Total hours,Shifts',
    );
    expect(csv).toContain('Ann,0,7.5,7.5,1');
  });
});

// ---------- availability replies ----------
const dayArb: fc.Arbitrary<AvailabilityReply['days'][number]> = fc.oneof(
  fc.constant('any' as const),
  fc.constant('off' as const),
  fc
    .uniqueArray(
      fc
        .tuple(fc.integer({ min: 0, max: 1439 }), fc.integer({ min: 1, max: 1440 }))
        .filter(([a, b]) => a !== b % 1440 && a !== b)
        .map(([a, b]): [string, string] => [hhmm(a), b === 1440 ? '24:00' : hhmm(b)]),
      { minLength: 1, maxLength: 3, selector: (w) => w.join('-') },
    )
    .map((ws) => ws.sort((x, y) => (x.join('-') < y.join('-') ? -1 : 1))),
);

function hhmm(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function replyArb(p: Project): fc.Arbitrary<AvailabilityReply> {
  const dates = Array.from({ length: p.days }, (_, d) =>
    new Date(Date.parse(`${p.start}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10),
  );
  return fc.record({
    schema: fc.constant('shiftknit/availability' as const),
    version: fc.constant(1 as const),
    period: fc.constant(p.start),
    staff: fc.constantFrom(...p.staff.map((s) => s.id)),
    name: fc.constant('x'),
    days: fc.array(dayArb, { minLength: 7, maxLength: 7 }),
    leave: fc.uniqueArray(fc.constantFrom(...dates), { maxLength: 5 }).map((x) => x.sort()),
    avoid: fc
      .uniqueArray(fc.integer({ min: 0, max: 6 }), { maxLength: 7 })
      .map((x) => x.sort((a, b) => a - b)),
    note: fc.constant(''),
  });
}

describe('availability replies', () => {
  const p = project({
    staff: [
      {
        id: 'a',
        name: 'Ann',
        availability: [{ days: [0, 1, 2], from: '09:00', to: '18:00' }],
        leave: ['2026-10-01', '2026-11-04'],
        preferences: [
          { kind: 'avoid', weekday: 5, weight: 5 },
          { kind: 'want', shift: 'early', weight: 2 },
        ],
      },
      { id: 'b', name: 'Ben' },
    ],
  });

  it('reads the current settings back as a reply', () => {
    const r = staffToReply(p, 'a');
    expect(r.days).toEqual([
      [['09:00', '18:00']],
      [['09:00', '18:00']],
      [['09:00', '18:00']],
      'off',
      'off',
      'off',
      'off',
    ]);
    expect(r.leave).toEqual(['2026-11-04']); // outside-period leave is not shown
    expect(r.avoid).toEqual([5]);
    expect(staffToReply(p, 'b').days).toEqual(Array(7).fill('any'));
  });

  it('apply keeps other preferences, weights and leave outside the period', () => {
    const r = { ...staffToReply(p, 'a'), leave: ['2026-11-05'], avoid: [5, 6] };
    const q = applyReply(p, r);
    const a = q.staff.find((s) => s.id === 'a')!;
    expect(a.leave).toEqual(['2026-10-01', '2026-11-05']);
    expect(a.preferences).toEqual([
      { kind: 'want', shift: 'early', weight: 2 },
      { kind: 'avoid', weekday: 5, weight: 5 },
      { kind: 'avoid', weekday: 6, weight: 3 },
    ]);
    expect(p.staff[0]!.leave).toEqual(['2026-10-01', '2026-11-04']); // input not mutated
  });

  it('round trip: parse(text(r)) = r, apply then diff is empty, and the result validates (property)', () => {
    fc.assert(
      fc.property(replyArb(p), (r) => {
        const parsed = parseAvailabilityReplies(replyText(r), p);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.value).toEqual([r]);
        const q = applyReply(p, r);
        expect(diffAvailability('en', q, r)).toEqual([]);
        expect(staffToReply(q, r.staff)).toEqual({
          ...normalizeReply(p, r),
          name: q.staff.find((s) => s.id === r.staff)!.name,
        });
        const again = importBackup(JSON.stringify(q));
        expect(again.ok).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('"not available on any day" becomes leave on every date (an empty list would mean "always")', () => {
    const r: AvailabilityReply = { ...staffToReply(p, 'b'), days: Array(7).fill('off') };
    const q = applyReply(p, r);
    const ben = q.staff.find((s) => s.id === 'b')!;
    expect(ben.availability).toEqual([]);
    expect(ben.leave).toHaveLength(7);
    expect(diffAvailability('en', q, r)).toEqual([]);
    expect(
      checkRoster(q, {
        assignments: [{ staff: 'b', date: '2026-11-06', shift: 'early' }],
      }).violations.map((v) => v.rule),
    ).toContain('leave');
  });

  it('applied availability is what the checker enforces', () => {
    const r: AvailabilityReply = {
      ...staffToReply(p, 'b'),
      days: ['off', [['06:00', '16:00']], 'any', 'any', 'any', 'any', 'any'],
    };
    const q = applyReply(p, r);
    const rule = (date: string, shift: string) =>
      checkRoster(q, { assignments: [{ staff: 'b', date, shift }] }).violations.map((v) => v.rule);
    expect(rule('2026-11-02', 'early')).toContain('availability'); // Monday off
    expect(rule('2026-11-03', 'early')).not.toContain('availability'); // 07:00–15:00 inside
    expect(rule('2026-11-03', 'late')).toContain('availability');
    expect(rule('2026-11-04', 'late')).not.toContain('availability');
  });

  it('describes each difference for the manager', () => {
    const r = {
      ...staffToReply(p, 'a'),
      days: ['any', ...staffToReply(p, 'a').days.slice(1)] as AvailabilityReply['days'],
      note: 'exam week',
    };
    expect(diffAvailability('en', p, r)).toEqual([
      { field: 'day', weekday: 0, before: '09:00–18:00', after: 'any time' },
      { field: 'note', before: '', after: 'exam week' },
    ]);
  });

  it('accepts replies pasted from a chat with text around them, several at once', () => {
    const a = replyText(staffToReply(p, 'a'));
    const b = replyText({ ...staffToReply(p, 'b'), avoid: [6] });
    const r = parseAvailabilityReplies(
      `[10:01] Ann: ${a}\n[10:05] Ben: here you go ${b} thanks!`,
      p,
    );
    expect(r.ok && r.value.map((x) => x.staff)).toEqual(['a', 'b']);
  });

  const bad: [string, (r: Record<string, unknown>) => unknown, string][] = [
    ['wrong schema', (r) => ({ ...r, schema: 'shiftknit/project' }), 'reply.schema'],
    ['unknown field', (r) => ({ ...r, admin: true }), 'field.unknown'],
    ['other period', (r) => ({ ...r, period: '2026-12-01' }), 'reply.period'],
    ['unknown person', (r) => ({ ...r, staff: 'zz' }), 'field.unknownRef'],
    ['six days', (r) => ({ ...r, days: (r.days as unknown[]).slice(1) }), 'field.length'],
    [
      'bad time',
      (r) => ({ ...r, days: [[['09:00', '24:30']], 'any', 'any', 'any', 'any', 'any', 'any'] }),
      'field.time',
    ],
    [
      '24:00 start',
      (r) => ({ ...r, days: [[['24:00', '10:00']], 'any', 'any', 'any', 'any', 'any', 'any'] }),
      'field.time',
    ],
    [
      'zero-length window',
      (r) => ({ ...r, days: [[['09:00', '09:00']], 'any', 'any', 'any', 'any', 'any', 'any'] }),
      'reply.zeroLength',
    ],
    [
      'four windows',
      (r) => ({
        ...r,
        days: [
          [
            ['01:00', '02:00'],
            ['03:00', '04:00'],
            ['05:00', '06:00'],
            ['07:00', '08:00'],
          ],
          'any',
          'any',
          'any',
          'any',
          'any',
          'any',
        ],
      }),
      'field.enum',
    ],
    ['leave outside period', (r) => ({ ...r, leave: ['2026-12-25'] }), 'date.outsidePeriod'],
    ['impossible date', (r) => ({ ...r, leave: ['2026-02-30'] }), 'field.date'],
    ['weekday 7', (r) => ({ ...r, avoid: [7] }), 'field.range'],
    ['weekday 1.5', (r) => ({ ...r, avoid: [1.5] }), 'field.range'],
    ['control chars in note', (r) => ({ ...r, note: 'a\u0007b' }), 'field.control'],
    ['long note', (r) => ({ ...r, note: 'x'.repeat(201) }), 'field.tooLong'],
    ['version 2', (r) => ({ ...r, version: 2 }), 'schema.unsupported'],
  ];
  it.each(bad)('refuses a reply with %s', (_, mutate, code) => {
    const r = mutate(staffToReply(p, 'a') as unknown as Record<string, unknown>);
    const out = parseAvailabilityReplies(JSON.stringify(r), p);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors.map((e) => e.code)).toContain(code);
  });

  it('finds a reply inside a bracketed piece of chat text that is not JSON itself', () => {
    const a = replyText(staffToReply(p, 'a'));
    const r = parseAvailabilityReplies(`[forwarded: ${a} ]`, p);
    expect(r.ok && r.value.map((x) => x.staff)).toEqual(['a']);
  });

  it('refuses prototype tricks, junk and huge input', () => {
    const r = replyText(staffToReply(p, 'a'));
    for (const text of [
      r.replace('{', '{"__proto__":{"x":1},'),
      'no json here',
      '{"schema":',
      '[' + Array(20).fill(r).join(',') + ']',
      'x'.repeat(300_000),
      '['.repeat(100),
    ])
      expect(parseAvailabilityReplies(text, p).ok, text.slice(0, 40)).toBe(false);
  });
});

describe('availability form', () => {
  it('embeds names safely: the data block cannot be closed early, whatever the names', () => {
    for (const name of HOSTILE) {
      const p = project({
        name,
        staff: [
          { id: 'a', name: name.slice(0, 80) },
          { id: 'b', name: 'Ben' },
        ],
      });
      const html = availabilityFormHtml('en', p, 'v0.2.0');
      expect(html.match(/<\/script>/gi)?.length).toBe(2);
      expect(html.match(/<script/gi)?.length).toBe(2);
      const data = /<script type="application\/json" id="data">([^<]*)<\/script>/.exec(html);
      expect(data).not.toBeNull();
      const parsed = JSON.parse(data![1]!) as { staff: { name: string }[] };
      expect(parsed.staff[0]!.name).toBe(name.slice(0, 80));
      expect(html).toContain("default-src 'none'");
      const rest = html.replace(/<script type="application\/json" id="data">[^<]*<\/script>/, '');
      for (const tag of rest.match(/<[^>]*>/g) ?? [])
        expect(tag).not.toMatch(/\son\w+=|src=|href=|^<(img|iframe|link|base|form)/i);
      const js = /<script>([\s\S]*?)<\/script>/.exec(rest)![1]!;
      expect(js).not.toMatch(
        /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|Function\(|fetch|XMLHttpRequest|WebSocket|sendBeacon|https?:/,
      );
      expect(/<style>([^<]*)<\/style>/.exec(rest)![1]).not.toMatch(/url\(|@import/i);
    }
  });
});

describe('published versions and backup', () => {
  const p = project();
  const roster: Roster = { assignments: [{ staff: 'a', date: '2026-11-02', shift: 'early' }] };
  const published = [
    { n: 1, at: '2026-10-08T03:00:00Z', project: p, roster: { assignments: [] }, withdrawn: false },
    { n: 2, at: '2026-10-08T04:00:00.000Z', project: p, roster, withdrawn: true },
  ];

  it('round-trips a full backup', () => {
    const r = importBackup(exportBackup({ project: p, roster, published }));
    expect(r.ok && r.value).toEqual({ project: p, roster, published });
  });

  it('accepts a plain project file as a backup without rota', () => {
    const r = importBackup(JSON.stringify(p));
    expect(r.ok && r.value.roster).toBeNull();
  });

  it.each([
    ['numbers out of order', [published[1], published[0]]],
    ['bad time', [{ ...published[0], at: 'yesterday' }]],
    ['extra field', [{ ...published[0], url: 'x' }]],
    [
      'roster refers to a missing person',
      [
        {
          ...published[0],
          roster: { assignments: [{ staff: 'zz', date: '2026-11-02', shift: 'early' }] },
        },
      ],
    ],
    ['too many', Array.from({ length: 21 }, (_, i) => ({ ...published[0], n: i + 1 }))],
  ])('refuses published versions with %s', (_, list) => {
    expect(validatePublished(list).ok).toBe(false);
    expect(importBackup(exportBackup({ project: p, roster, published: list as never })).ok).toBe(
      false,
    );
  });
});
