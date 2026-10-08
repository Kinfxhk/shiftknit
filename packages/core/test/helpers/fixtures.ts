// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Project } from '../../src/index';
import { validateProject } from '../../src/index';

/** A small valid project (raw JSON form) for tests. */
export function rawProject(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'shiftknit/project',
    version: 1,
    name: 'Test shop',
    timeZone: 'Asia/Hong_Kong',
    start: '2026-11-02', // a Monday
    days: 7,
    skills: ['firstaid'],
    shifts: [
      { id: 'early', name: 'Early', start: '07:00', end: '15:00', breakMinutes: 30, demand: 1 },
      { id: 'late', name: 'Late', start: '15:00', end: '23:00', breakMinutes: 30, demand: 1 },
    ],
    staff: [
      { id: 'a', name: 'Ann', skills: ['firstaid'] },
      { id: 'b', name: 'Ben' },
      { id: 'c', name: 'Cat' },
    ],
    ...over,
  };
}

export function project(over: Record<string, unknown> = {}): Project {
  const r = validateProject(rawProject(over));
  if (!r.ok) throw new Error(`fixture invalid: ${JSON.stringify(r.errors)}`);
  return r.value;
}
