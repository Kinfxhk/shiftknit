// SPDX-License-Identifier: AGPL-3.0-or-later
// ShiftKnit command line. Same core as the web UI and the tests.
//
//   shiftknit solve <project.json> [--seed N] [--time-limit 10s] [--out result.json] [--text] [--lang en|zh-HK]
//   shiftknit check <project.json> <roster.json> [--text] [--lang en|zh-HK]
//   shiftknit export <project.json> <roster.json> --format csv-grid|csv-list|ics [--staff ID] [--out FILE]
//   shiftknit --version | --help
//
// Exit codes: 0 ok; 1 usage or input error; 2 rota has broken rules (check) or gaps
// (solve, shortfall); 3 no rota (solve); 4 internal check failed (solver rota rejected).

import { readFileSync, statSync, writeFileSync } from 'node:fs';
import type { Lang, Project, Roster } from '@shiftknit/core';
import {
  checkRoster,
  describeError,
  describeGap,
  describeUnit,
  describeViolation,
  ENGINE_VERSION,
  explain,
  gridCsv,
  importProject,
  listCsv,
  safeParseJson,
  solveAndCheck,
  staffCalendar,
  validateRoster,
} from '@shiftknit/core';

const MAX_FILE = 2_000_000;

export class UsageError extends Error {}

interface Opts {
  positional: string[];
  flags: Map<string, string | true>;
}

export function parseArgs(argv: string[]): Opts {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  const valued = new Set(['--seed', '--time-limit', '--out', '--lang', '--format', '--staff']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const [k, v] = a.includes('=')
        ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]
        : [a, undefined];
      if (valued.has(k)) {
        const val = v ?? argv[++i];
        if (val === undefined) throw new UsageError(`${k} needs a value`);
        flags.set(k, val);
      } else if (['--text', '--help', '--version'].includes(k)) flags.set(k, true);
      else throw new UsageError(`unknown option ${k}`);
    } else positional.push(a);
  }
  return { positional, flags };
}

/** "10s", "500ms", "2m" or a plain number of seconds → milliseconds. */
export function parseDuration(s: string): number {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(s.trim());
  if (!m) throw new UsageError(`bad time limit "${s}" (use e.g. 10s, 500ms, 2m)`);
  const n = Number(m[1]);
  const ms = m[2] === 'ms' ? n : m[2] === 'm' ? n * 60_000 : n * 1000;
  if (ms <= 0 || ms > 3_600_000) throw new UsageError('time limit must be between 1 ms and 1 hour');
  return ms;
}

function readText(path: string): string {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    throw new UsageError(`cannot read ${path}`);
  }
  if (size > MAX_FILE) throw new UsageError(`${path} is larger than ${MAX_FILE} bytes`);
  return readFileSync(path, 'utf8');
}

function loadProject(path: string, lang: Lang): Project {
  const r = importProject(readText(path));
  if (!r.ok)
    throw new UsageError(
      `${path}:\n  ${r.errors
        .slice(0, 10)
        .map((e) => describeError(lang, e))
        .join('\n  ')}`,
    );
  return r.value;
}

function loadRoster(path: string, p: Project, lang: Lang): Roster {
  const parsed = safeParseJson(readText(path));
  if (!parsed.ok)
    throw new UsageError(`${path}: ${parsed.errors.map((e) => describeError(lang, e)).join('; ')}`);
  const r = validateRoster(parsed.value, p);
  if (!r.ok)
    throw new UsageError(
      `${path}:\n  ${r.errors
        .slice(0, 10)
        .map((e) => describeError(lang, e))
        .join('\n  ')}`,
    );
  return r.value;
}

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
  now: () => number;
}

const HELP = `ShiftKnit ${ENGINE_VERSION} — staff rota builder with an independent rule checker

Usage:
  shiftknit solve <project.json> [--seed N] [--time-limit 10s] [--out result.json] [--text] [--lang en|zh-HK]
  shiftknit check <project.json> <roster.json> [--text] [--lang en|zh-HK]
  shiftknit export <project.json> <roster.json> --format csv-grid|csv-list|ics [--staff ID] [--out FILE]

A "passes the check" result only means the rota follows the rules in your project file.
It is not legal advice.`;

export function run(argv: string[], io: Io): number {
  try {
    const { positional, flags } = parseArgs(argv);
    if (flags.has('--version')) {
      io.out(ENGINE_VERSION);
      return 0;
    }
    const [cmd, ...files] = positional;
    if (flags.has('--help') || !cmd) {
      io.out(HELP);
      return cmd || flags.has('--help') ? 0 : 1;
    }
    const langFlag = flags.get('--lang') ?? 'en';
    if (langFlag !== 'en' && langFlag !== 'zh-HK')
      throw new UsageError('--lang must be en or zh-HK');
    const lang: Lang = langFlag;
    const text = flags.has('--text');
    const outFile = flags.get('--out');
    const emit = (s: string) =>
      typeof outFile === 'string' ? writeFileSync(outFile, s) : io.out(s.replace(/\n$/, ''));

    if (cmd === 'solve') {
      if (files.length !== 1) throw new UsageError('solve needs exactly one project file');
      const p = loadProject(files[0]!, lang);
      const seedRaw = flags.get('--seed') ?? '1';
      const seed = Number(seedRaw);
      if (!Number.isSafeInteger(seed) || seed < 0)
        throw new UsageError('--seed must be a whole number ≥ 0');
      const limit = parseDuration(String(flags.get('--time-limit') ?? '60s'));
      const t0 = io.now();
      const v = solveAndCheck(p, { seed, timeUp: () => io.now() - t0 > limit });
      const expl =
        v.result.roster === null || v.result.status === 'shortfall' ? explain(p, v.result) : null;
      if (text) {
        const lines = [
          `status: ${v.result.status}${v.result.proven ? ' (proven)' : ''}${v.rejected ? ' — REJECTED by the checker' : ''}`,
        ];
        if (v.result.objective)
          lines.push(
            `shortfall: ${v.result.objective.shortfall}, penalty: ${v.result.objective.penalty}`,
          );
        for (const g of v.report?.gaps ?? []) lines.push(`gap: ${describeGap(lang, g, p)}`);
        if (expl) {
          lines.push(
            `conflict (from ${expl.start}, ${expl.days} day${expl.days === 1 ? '' : 's'}${expl.minimal ? ', minimal' : ''}):`,
          );
          for (const u of expl.units) lines.push(`  - ${describeUnit(lang, u, p, expl.goal)}`);
        }
        io.err(lines.join('\n'));
      }
      emit(
        JSON.stringify(
          { ...v.result, report: v.report, rejected: v.rejected, explanation: expl },
          null,
          2,
        ) + '\n',
      );
      if (v.rejected) return 4;
      if (v.result.status === 'none') return 3;
      return v.result.status === 'shortfall' ? 2 : 0;
    }

    if (cmd === 'check') {
      if (files.length !== 2) throw new UsageError('check needs a project file and a roster file');
      const p = loadProject(files[0]!, lang);
      const r = loadRoster(files[1]!, p, lang);
      const report = checkRoster(p, r);
      if (text) {
        const lines = [
          report.valid
            ? 'valid: all hard rules are met'
            : `INVALID: ${report.violations.length} broken rules`,
        ];
        for (const v of report.violations) lines.push(`  - ${describeViolation(lang, v, p)}`);
        for (const g of report.gaps) lines.push(`gap: ${describeGap(lang, g, p)}`);
        lines.push(`penalty: ${report.penalty.total}`);
        io.err(lines.join('\n'));
      }
      emit(JSON.stringify(report, null, 2) + '\n');
      return report.valid ? 0 : 2;
    }

    if (cmd === 'export') {
      if (files.length !== 2) throw new UsageError('export needs a project file and a roster file');
      const p = loadProject(files[0]!, lang);
      const r = loadRoster(files[1]!, p, lang);
      const format = flags.get('--format');
      if (format === 'csv-grid') emit(gridCsv(p, r, lang));
      else if (format === 'csv-list') emit(listCsv(p, r, lang));
      else if (format === 'ics') {
        const staff = flags.get('--staff');
        if (typeof staff !== 'string' || !p.staff.some((s) => s.id === staff))
          throw new UsageError(`--staff must be one of: ${p.staff.map((s) => s.id).join(', ')}`);
        emit(staffCalendar(p, r, staff, { stamp: Math.floor(io.now() / 60_000) }));
      } else throw new UsageError('--format must be csv-grid, csv-list or ics');
      return 0;
    }
    throw new UsageError(`unknown command "${cmd}"`);
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`shiftknit: ${e.message}`);
      return 1;
    }
    throw e;
  }
}

const isMain = process.argv[1] !== undefined && /main\.[cm]?[jt]s$/.test(process.argv[1]);
if (isMain) {
  process.exitCode = run(process.argv.slice(2), {
    out: (s) => process.stdout.write(s + '\n'),
    err: (s) => process.stderr.write(s + '\n'),
    now: () => Date.now(),
  });
}
