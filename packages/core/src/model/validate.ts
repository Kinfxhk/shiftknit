// SPDX-License-Identifier: AGPL-3.0-or-later
// Strict schema validation of project files (version 1). Unknown fields are rejected,
// optional fields get documented defaults, every reference is checked, and every error
// carries a JSON path and a message code that exists in English and Chinese.

import { isValidTimeZone, parseDate, parseTime } from '../time/index';
import { DEFAULT_RULES, DEFAULT_STAFF_LIMITS, DEFAULT_WEIGHTS } from './defaults';
import type { ModelError, Result } from './errors';
import { inspectGraph } from './json';
import { LIMITS } from './limits';
import { migrateProject } from './migrate';
import type {
  AvailabilityWindow,
  CellValue,
  Preference,
  Project,
  Roster,
  Rules,
  Shift,
  SkillRequirement,
  Staff,
  Weights,
} from './types';
import { PROJECT_SCHEMA, PROJECT_VERSION } from './types';

const ID_RE = /^[A-Za-z0-9_-]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

type Obj = Record<string, unknown>;

class Ctx {
  errors: ModelError[] = [];
  err(code: string, path: string, params?: Record<string, string | number>): void {
    if (this.errors.length < 50) this.errors.push(params ? { code, path, params } : { code, path });
  }
  obj(v: unknown, path: string, keys: string[]): Obj | undefined {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      this.err('field.type', path, { expected: 'object' });
      return undefined;
    }
    for (const k of Object.keys(v))
      if (!keys.includes(k)) this.err('field.unknown', `${path}.${k}`);
    return v as Obj;
  }
  arr(v: unknown, path: string, max: number, what: string): unknown[] | undefined {
    if (!Array.isArray(v)) {
      this.err('field.type', path, { expected: 'array' });
      return undefined;
    }
    if (v.length > max) {
      this.err('limit.exceeded', path, { what, max });
      return undefined;
    }
    return v;
  }
  str(v: unknown, path: string, max: number = LIMITS.stringLength, allowEmpty = false): string {
    if (typeof v !== 'string') {
      this.err('field.type', path, { expected: 'text' });
      return '';
    }
    if (v.length > max) this.err('field.tooLong', path, { max });
    else if (!allowEmpty && v.trim().length === 0) this.err('field.required', path);
    else if (CONTROL_RE.test(v)) this.err('field.control', path);
    return v;
  }
  id(v: unknown, path: string): string {
    const s = this.str(v, path, LIMITS.idLength);
    if (s && !ID_RE.test(s)) this.err('field.pattern', path);
    return s;
  }
  int(v: unknown, path: string, min: number, max: number): number {
    if (typeof v !== 'number') {
      this.err('field.type', path, { expected: 'number' });
      return min;
    }
    if (!Number.isFinite(v)) {
      this.err('field.notFinite', path);
      return min;
    }
    if (!Number.isInteger(v)) {
      this.err('field.integer', path);
      return min;
    }
    if (v < min || v > max) {
      this.err('field.range', path, { min, max });
      return Math.min(Math.max(v, min), max);
    }
    return v;
  }
  bool(v: unknown, path: string): boolean {
    if (typeof v !== 'boolean') this.err('field.type', path, { expected: 'true/false' });
    return v === true;
  }
  date(v: unknown, path: string): string {
    const s = this.str(v, path, 10);
    if (s && parseDate(s) === undefined) this.err('field.date', path);
    return s;
  }
  time(v: unknown, path: string, allow24 = false): string {
    const s = this.str(v, path, 5);
    if (s && parseTime(s, allow24) === undefined) this.err('field.time', path);
    return s;
  }
  opt<T>(o: Obj, key: string, fallback: T, read: (v: unknown, path: string) => T, path: string): T {
    return o[key] === undefined ? fallback : read(o[key], `${path}.${key}`);
  }
}

function readSkillReq(c: Ctx, v: unknown, path: string): SkillRequirement {
  const o = c.obj(v, path, ['skills', 'min']) ?? {};
  const skills = (c.arr(o.skills, `${path}.skills`, LIMITS.skills, 'skills') ?? []).map((s, i) =>
    c.id(s, `${path}.skills[${i}]`),
  );
  if (skills.length === 0) c.err('field.required', `${path}.skills`);
  return { skills, min: c.int(o.min, `${path}.min`, 1, LIMITS.maxDemand) };
}

function readShift(c: Ctx, v: unknown, path: string): Shift {
  const o =
    c.obj(v, path, [
      'id',
      'name',
      'start',
      'end',
      'breakMinutes',
      'demand',
      'skillDemand',
      'night',
    ]) ?? {};
  const start = c.time(o.start, `${path}.start`);
  const end = c.time(o.end, `${path}.end`);
  const breakMinutes = c.opt(o, 'breakMinutes', 0, (x, p) => c.int(x, p, 0, 600), path);
  let demand: number[] = [0, 0, 0, 0, 0, 0, 0];
  if (typeof o.demand === 'number') {
    const n = c.int(o.demand, `${path}.demand`, 0, LIMITS.maxDemand);
    demand = [n, n, n, n, n, n, n];
  } else {
    const a = c.arr(o.demand, `${path}.demand`, 7, 'weekdays');
    if (a && a.length !== 7) c.err('field.length', `${path}.demand`, { n: 7 });
    else if (a) demand = a.map((x, i) => c.int(x, `${path}.demand[${i}]`, 0, LIMITS.maxDemand));
  }
  const skillDemand = (
    c.arr(o.skillDemand ?? [], `${path}.skillDemand`, LIMITS.skillDemandPerShift, 'skill needs') ??
    []
  ).map((x, i) => readSkillReq(c, x, `${path}.skillDemand[${i}]`));
  const s = parseTime(start);
  const e = parseTime(end);
  if (s !== undefined && e !== undefined) {
    if (s === e) c.err('shift.zeroLength', path);
    const len = e > s ? e - s : e + 1440 - s;
    if (breakMinutes >= len) c.err('shift.breakTooLong', `${path}.breakMinutes`);
  }
  const crosses = s !== undefined && e !== undefined && e <= s;
  return {
    id: c.id(o.id, `${path}.id`),
    name: c.str(o.name, `${path}.name`, LIMITS.nameLength),
    start,
    end,
    breakMinutes,
    demand,
    skillDemand,
    night: c.opt(o, 'night', crosses, (x, p) => c.bool(x, p), path),
  };
}

function readWindow(c: Ctx, v: unknown, path: string): AvailabilityWindow {
  const o = c.obj(v, path, ['days', 'from', 'to']) ?? {};
  const days = (c.arr(o.days, `${path}.days`, 7, 'weekdays') ?? []).map((x, i) =>
    c.int(x, `${path}.days[${i}]`, 0, 6),
  );
  if (days.length === 0) c.err('field.required', `${path}.days`);
  return { days, from: c.time(o.from, `${path}.from`), to: c.time(o.to, `${path}.to`, true) };
}

function readPreference(c: Ctx, v: unknown, path: string): Preference {
  const o = c.obj(v, path, ['kind', 'shift', 'date', 'weekday', 'weight']) ?? {};
  if (o.kind !== 'want' && o.kind !== 'avoid')
    c.err('field.enum', `${path}.kind`, { values: 'want, avoid' });
  const p: Preference = {
    kind: o.kind === 'want' ? 'want' : 'avoid',
    weight: c.opt(o, 'weight', 1, (x, q) => c.int(x, q, 1, 5), path),
  };
  if (o.shift !== undefined) p.shift = c.id(o.shift, `${path}.shift`);
  if (o.date !== undefined) p.date = c.date(o.date, `${path}.date`);
  if (o.weekday !== undefined) p.weekday = c.int(o.weekday, `${path}.weekday`, 0, 6);
  if (p.date !== undefined && p.weekday !== undefined) c.err('pref.dateAndWeekday', path);
  return p;
}

function readStaff(c: Ctx, v: unknown, path: string): Staff {
  const o =
    c.obj(v, path, [
      'id',
      'name',
      'skills',
      'maxWeeklyMinutes',
      'minWeeklyMinutes',
      'maxConsecutiveDays',
      'availability',
      'leave',
      'preferences',
    ]) ?? {};
  const s: Staff = {
    id: c.id(o.id, `${path}.id`),
    name: c.str(o.name, `${path}.name`, LIMITS.nameLength),
    skills: (c.arr(o.skills ?? [], `${path}.skills`, LIMITS.skills, 'skills') ?? []).map((x, i) =>
      c.id(x, `${path}.skills[${i}]`),
    ),
    maxWeeklyMinutes: c.opt(
      o,
      'maxWeeklyMinutes',
      DEFAULT_STAFF_LIMITS.maxWeeklyMinutes,
      (x, p) => c.int(x, p, 0, 10080),
      path,
    ),
    minWeeklyMinutes: c.opt(
      o,
      'minWeeklyMinutes',
      DEFAULT_STAFF_LIMITS.minWeeklyMinutes,
      (x, p) => c.int(x, p, 0, 10080),
      path,
    ),
    maxConsecutiveDays: c.opt(
      o,
      'maxConsecutiveDays',
      DEFAULT_STAFF_LIMITS.maxConsecutiveDays,
      (x, p) => c.int(x, p, 1, 31),
      path,
    ),
    availability: (
      c.arr(
        o.availability ?? [],
        `${path}.availability`,
        LIMITS.windowsPerStaff,
        'availability windows',
      ) ?? []
    ).map((x, i) => readWindow(c, x, `${path}.availability[${i}]`)),
    leave: (c.arr(o.leave ?? [], `${path}.leave`, LIMITS.leavePerStaff, 'leave days') ?? []).map(
      (x, i) => c.date(x, `${path}.leave[${i}]`),
    ),
    preferences: (
      c.arr(
        o.preferences ?? [],
        `${path}.preferences`,
        LIMITS.preferencesPerStaff,
        'preferences',
      ) ?? []
    ).map((x, i) => readPreference(c, x, `${path}.preferences[${i}]`)),
  };
  if (s.minWeeklyMinutes > s.maxWeeklyMinutes)
    c.err('staff.minAboveMax', `${path}.minWeeklyMinutes`);
  return s;
}

function readRules(c: Ctx, v: unknown, path: string): Rules {
  const o = c.obj(v, path, ['minRestMinutes', 'restDay', 'weekStart']) ?? {};
  let restDay = { ...DEFAULT_RULES.restDay };
  if (o.restDay !== undefined) {
    const p = `${path}.restDay`;
    const r = c.obj(o.restDay, p, ['enabled', 'count', 'minMinutes', 'mode']) ?? {};
    if (r.mode !== undefined && r.mode !== 'rolling' && r.mode !== 'fixed')
      c.err('field.enum', `${p}.mode`, { values: 'rolling, fixed' });
    restDay = {
      enabled: c.opt(r, 'enabled', restDay.enabled, (x, q) => c.bool(x, q), p),
      count: c.opt(r, 'count', restDay.count, (x, q) => c.int(x, q, 1, 7), p),
      minMinutes: c.opt(
        r,
        'minMinutes',
        restDay.minMinutes,
        (x, q) => c.int(x, q, 60, 7 * 1440),
        p,
      ),
      mode: r.mode === 'fixed' ? 'fixed' : 'rolling',
    };
  }
  return {
    minRestMinutes: c.opt(
      o,
      'minRestMinutes',
      DEFAULT_RULES.minRestMinutes,
      (x, p) => c.int(x, p, 0, 48 * 60),
      path,
    ),
    restDay,
    weekStart: c.opt(o, 'weekStart', DEFAULT_RULES.weekStart, (x, p) => c.int(x, p, 0, 6), path),
  };
}

function readWeights(c: Ctx, v: unknown, path: string): Weights {
  const keys = Object.keys(DEFAULT_WEIGHTS) as (keyof Weights)[];
  const o = c.obj(v, path, keys) ?? {};
  const w = { ...DEFAULT_WEIGHTS };
  for (const k of keys) w[k] = c.opt(o, k, DEFAULT_WEIGHTS[k], (x, p) => c.int(x, p, 0, 100), path);
  return w;
}

function readCell(c: Ctx, v: unknown, path: string, allowOff: boolean): CellValue {
  const o = c.obj(v, path, ['staff', 'date', 'shift']) ?? {};
  const shift: string | null = o.shift === null && allowOff ? null : c.id(o.shift, `${path}.shift`);
  return { staff: c.id(o.staff, `${path}.staff`), date: c.date(o.date, `${path}.date`), shift };
}

function checkUnique(c: Ctx, ids: string[], path: string): void {
  const seen = new Set<string>();
  ids.forEach((id, i) => {
    if (seen.has(id)) c.err('field.duplicateId', `${path}[${i}].id`, { id });
    seen.add(id);
  });
}

/** Validate an already-parsed project object. Returns a fully defaulted Project. */
export function validateProject(raw: unknown): Result<Project> {
  const graphErrors = inspectGraph(raw);
  if (graphErrors.length) return { ok: false, errors: graphErrors };
  const migrated = migrateProject(raw);
  if (!migrated.ok) return migrated;
  const c = new Ctx();
  const o =
    c.obj(migrated.value, '$', [
      'schema',
      'version',
      'name',
      'timeZone',
      'start',
      'days',
      'skills',
      'shifts',
      'staff',
      'rules',
      'weights',
      'locks',
      'previous',
    ]) ?? {};
  const timeZone = c.opt(o, 'timeZone', 'Asia/Hong_Kong', (x, p) => c.str(x, p, 64), '$');
  if (!isValidTimeZone(timeZone)) c.err('field.timeZone', '$.timeZone');
  const skills = (c.arr(o.skills ?? [], '$.skills', LIMITS.skills, 'skills') ?? []).map((x, i) =>
    c.id(x, `$.skills[${i}]`),
  );
  const shiftsRaw = c.arr(o.shifts, '$.shifts', LIMITS.shifts, 'shifts') ?? [];
  const staffRaw = c.arr(o.staff, '$.staff', LIMITS.staff, 'staff') ?? [];
  const p: Project = {
    schema: PROJECT_SCHEMA,
    version: PROJECT_VERSION,
    name: c.opt(o, 'name', 'Rota', (x, q) => c.str(x, q, LIMITS.nameLength), '$'),
    timeZone,
    start: c.date(o.start, '$.start'),
    days: c.int(o.days, '$.days', 1, LIMITS.days),
    skills,
    shifts: shiftsRaw.map((x, i) => readShift(c, x, `$.shifts[${i}]`)),
    staff: staffRaw.map((x, i) => readStaff(c, x, `$.staff[${i}]`)),
    rules: c.opt(o, 'rules', structuredRules(), (x, q) => readRules(c, x, q), '$'),
    weights: c.opt(o, 'weights', { ...DEFAULT_WEIGHTS }, (x, q) => readWeights(c, x, q), '$'),
    locks: (c.arr(o.locks ?? [], '$.locks', LIMITS.locks, 'locks') ?? []).map((x, i) =>
      readCell(c, x, `$.locks[${i}]`, true),
    ),
    previous: (c.arr(o.previous ?? [], '$.previous', LIMITS.previous, 'previous cells') ?? []).map(
      (x, i) => readCell(c, x, `$.previous[${i}]`, true),
    ),
  };
  if (c.errors.length) return { ok: false, errors: c.errors };
  crossCheck(c, p);
  return c.errors.length ? { ok: false, errors: c.errors } : { ok: true, value: p };
}

function structuredRules(): Rules {
  return { ...DEFAULT_RULES, restDay: { ...DEFAULT_RULES.restDay } };
}

/** Reference and consistency checks that need the whole project. */
function crossCheck(c: Ctx, p: Project): void {
  checkUnique(
    c,
    p.skills.map((s) => s),
    '$.skills',
  );
  checkUnique(
    c,
    p.shifts.map((s) => s.id),
    '$.shifts',
  );
  checkUnique(
    c,
    p.staff.map((s) => s.id),
    '$.staff',
  );
  const skills = new Set(p.skills);
  const shifts = new Set(p.shifts.map((s) => s.id));
  const staff = new Set(p.staff.map((s) => s.id));
  const first = parseDate(p.start) ?? 0;
  const inPeriod = (d: string) => {
    const n = parseDate(d);
    return n !== undefined && n >= first && n < first + p.days;
  };
  p.shifts.forEach((s, i) =>
    s.skillDemand.forEach((r, j) =>
      r.skills.forEach((k, m) => {
        if (!skills.has(k))
          c.err('field.unknownRef', `$.shifts[${i}].skillDemand[${j}].skills[${m}]`, { id: k });
      }),
    ),
  );
  p.staff.forEach((s, i) => {
    s.skills.forEach((k, m) => {
      if (!skills.has(k)) c.err('field.unknownRef', `$.staff[${i}].skills[${m}]`, { id: k });
    });
    s.preferences.forEach((pr, m) => {
      if (pr.shift !== undefined && !shifts.has(pr.shift))
        c.err('field.unknownRef', `$.staff[${i}].preferences[${m}].shift`, { id: pr.shift });
    });
  });
  const cells = (list: { staff: string; date: string; shift: string | null }[], name: string) => {
    const seen = new Set<string>();
    list.forEach((l, i) => {
      if (!staff.has(l.staff)) c.err('field.unknownRef', `$.${name}[${i}].staff`, { id: l.staff });
      if (l.shift !== null && !shifts.has(l.shift))
        c.err('field.unknownRef', `$.${name}[${i}].shift`, { id: l.shift });
      if (!inPeriod(l.date)) c.err('date.outsidePeriod', `$.${name}[${i}].date`);
      const key = `${l.staff}\u0000${l.date}`;
      if (seen.has(key)) c.err('cell.duplicate', `$.${name}[${i}]`);
      seen.add(key);
    });
  };
  cells(p.locks, 'locks');
  cells(p.previous, 'previous');
}

/** Validate a roster object against a (valid) project's ids and period. Structural only:
 * rule checks are the checker's job. */
export function validateRoster(raw: unknown, project: Project): Result<Roster> {
  const graphErrors = inspectGraph(raw);
  if (graphErrors.length) return { ok: false, errors: graphErrors };
  const c = new Ctx();
  let o = c.obj(raw, '$', ['schema', 'version', 'assignments', 'roster', 'status', 'result']);
  // Accept a bare roster or a solver result that embeds one.
  if (o && o.roster !== undefined) o = c.obj(o.roster, '$.roster', ['assignments']);
  const list = c.arr(o?.assignments, '$.assignments', LIMITS.assignments, 'assignments') ?? [];
  const shifts = new Set(project.shifts.map((s) => s.id));
  const staff = new Set(project.staff.map((s) => s.id));
  const assignments = list.map((x, i) => {
    const path = `$.assignments[${i}]`;
    const a = c.obj(x, path, ['staff', 'date', 'shift']) ?? {};
    const r = {
      staff: c.id(a.staff, `${path}.staff`),
      date: c.date(a.date, `${path}.date`),
      shift: c.id(a.shift, `${path}.shift`),
    };
    if (r.staff && !staff.has(r.staff)) c.err('field.unknownRef', `${path}.staff`, { id: r.staff });
    if (r.shift && !shifts.has(r.shift))
      c.err('field.unknownRef', `${path}.shift`, { id: r.shift });
    return r;
  });
  return c.errors.length ? { ok: false, errors: c.errors } : { ok: true, value: { assignments } };
}
