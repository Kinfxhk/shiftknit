// SPDX-License-Identifier: AGPL-3.0-or-later
// Project file versioning. Each migration upgrades version n to n+1. Version 1 is the
// first public format, so the registry is empty; the mechanism is tested with synthetic
// migrations so that future format changes have a tested path.

import type { ModelError, Result } from './errors';
import { PROJECT_SCHEMA, PROJECT_VERSION } from './types';

export type Migration = (o: Record<string, unknown>) => Record<string, unknown>;

/** Registry: key = from-version. */
export const MIGRATIONS: Record<number, Migration> = {};

export function applyMigrations(
  raw: unknown,
  migrations: Record<number, Migration>,
  current: number,
  schema: string = PROJECT_SCHEMA,
): Result<Record<string, unknown>> {
  const fail = (e: ModelError): Result<Record<string, unknown>> => ({ ok: false, errors: [e] });
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    return fail({ code: 'field.type', path: '$', params: { expected: 'object' } });
  const o = raw as Record<string, unknown>;
  if (o.schema !== schema) return fail({ code: 'schema.wrong', path: '$.schema' });
  const v = o.version;
  if (typeof v !== 'number' || !Number.isInteger(v))
    return fail({ code: 'field.integer', path: '$.version' });
  if (v > current) return fail({ code: 'schema.newer', path: '$.version', params: { version: v } });
  let out: Record<string, unknown> = { ...o };
  for (let n = v; n < current; n++) {
    const m = migrations[n];
    if (!m) return fail({ code: 'schema.unsupported', path: '$.version', params: { version: v } });
    out = { ...m(out), schema, version: n + 1 };
  }
  return { ok: true, value: out };
}

export function migrateProject(raw: unknown): Result<Record<string, unknown>> {
  return applyMigrations(raw, MIGRATIONS, PROJECT_VERSION);
}
