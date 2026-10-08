// SPDX-License-Identifier: AGPL-3.0-or-later
// Full backup (project + current rota + published versions) as one JSON file, and the
// published-version records themselves. Restoring validates everything like a project file.

import type { ModelError, Result } from '../model/errors';
import { safeParseJson } from '../model/json';
import type { Project, Roster } from '../model/types';
import { validateProject, validateRoster } from '../model/validate';

export const BACKUP_SCHEMA = 'shiftknit/backup';
export const MAX_PUBLISHED = 20;

export interface Published {
  /** 1, 2, 3 … in publishing order. */
  n: number;
  /** ISO 8601 instant (UTC) when it was published. */
  at: string;
  /** The project as it was when published (names, shifts, period). */
  project: Project;
  roster: Roster;
  /** Withdrawn versions stay listed (so numbers never repeat) but are no longer current. */
  withdrawn: boolean;
}

export interface Backup {
  project: Project;
  roster: Roster | null;
  published: Published[];
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;

export function exportBackup(b: Backup): string {
  return (
    JSON.stringify(
      {
        schema: BACKUP_SCHEMA,
        version: 1,
        project: b.project,
        roster: b.roster,
        published: b.published,
      },
      null,
      2,
    ) + '\n'
  );
}

/** Validate a list of published versions (from storage or a backup file). */
export function validatePublished(raw: unknown): Result<Published[]> {
  if (!Array.isArray(raw) || raw.length > MAX_PUBLISHED)
    return {
      ok: false,
      errors: [
        {
          code: 'limit.exceeded',
          path: '$.published',
          params: { what: 'published versions', max: MAX_PUBLISHED },
        },
      ],
    };
  const out: Published[] = [];
  const errors: ModelError[] = [];
  raw.forEach((x: unknown, i) => {
    const path = `$.published[${i}]`;
    if (x === null || typeof x !== 'object' || Array.isArray(x)) {
      errors.push({ code: 'field.type', path, params: { expected: 'object' } });
      return;
    }
    const o = x as Record<string, unknown>;
    for (const k of Object.keys(o))
      if (!['n', 'at', 'project', 'roster', 'withdrawn'].includes(k))
        errors.push({ code: 'field.unknown', path: `${path}.${k}` });
    if (typeof o.n !== 'number' || !Number.isInteger(o.n) || o.n < 1 || o.n > 1_000_000)
      errors.push({ code: 'field.range', path: `${path}.n`, params: { min: 1, max: 1_000_000 } });
    if (typeof o.at !== 'string' || !ISO.test(o.at) || Number.isNaN(Date.parse(o.at)))
      errors.push({ code: 'field.date', path: `${path}.at` });
    const p = validateProject(o.project);
    if (!p.ok) {
      errors.push(...p.errors.map((er) => ({ ...er, path: `${path}.project${er.path.slice(1)}` })));
      return;
    }
    const r = validateRoster(o.roster, p.value);
    if (!r.ok) {
      errors.push(...r.errors.map((er) => ({ ...er, path: `${path}.roster${er.path.slice(1)}` })));
      return;
    }
    out.push({
      n: o.n as number,
      at: o.at as string,
      project: p.value,
      roster: r.value,
      withdrawn: o.withdrawn === true,
    });
  });
  for (let i = 1; i < out.length; i++)
    if (out[i]!.n <= out[i - 1]!.n)
      errors.push({
        code: 'field.range',
        path: `$.published[${i}].n`,
        params: { min: out[i - 1]!.n + 1, max: 1_000_000 },
      });
  return errors.length ? { ok: false, errors: errors.slice(0, 20) } : { ok: true, value: out };
}

/** Parse a backup file. A plain project file is also accepted (no rota, no versions). */
export function importBackup(text: string): Result<Backup> {
  const parsed = safeParseJson(text);
  if (!parsed.ok) return parsed;
  const v = parsed.value as Record<string, unknown> | null;
  if (v && typeof v === 'object' && !Array.isArray(v) && v.schema === BACKUP_SCHEMA) {
    for (const k of Object.keys(v))
      if (!['schema', 'version', 'project', 'roster', 'published'].includes(k))
        return { ok: false, errors: [{ code: 'field.unknown', path: `$.${k}` }] };
    if (v.version !== 1)
      return {
        ok: false,
        errors: [
          { code: 'schema.unsupported', path: '$.version', params: { version: String(v.version) } },
        ],
      };
    const p = validateProject(v.project);
    if (!p.ok)
      return {
        ok: false,
        errors: p.errors.map((e) => ({ ...e, path: `$.project${e.path.slice(1)}` })),
      };
    let roster: Roster | null = null;
    if (v.roster !== null && v.roster !== undefined) {
      const r = validateRoster(v.roster, p.value);
      if (!r.ok)
        return {
          ok: false,
          errors: r.errors.map((e) => ({ ...e, path: `$.roster${e.path.slice(1)}` })),
        };
      roster = r.value;
    }
    const pub = validatePublished(v.published ?? []);
    if (!pub.ok) return pub;
    return { ok: true, value: { project: p.value, roster, published: pub.value } };
  }
  const p = validateProject(parsed.value);
  if (!p.ok) return p;
  return { ok: true, value: { project: p.value, roster: null, published: [] } };
}

/** The latest version that has not been withdrawn. */
export function currentPublished(list: Published[]): Published | undefined {
  for (let i = list.length - 1; i >= 0; i--) if (!list[i]!.withdrawn) return list[i];
  return undefined;
}
