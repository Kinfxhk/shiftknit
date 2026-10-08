#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Dependency licence gate. ShiftKnit is AGPL-3.0-or-later, so every dependency must be
// compatible with (A)GPLv3. Uses `npm query` (no extra tooling). Fails closed on
// unknown, missing, malformed or non-allowlisted licence expressions.

import { satisfiesSpdx } from './lib/spdx.mjs';
import { runNpm } from './lib/proc.mjs';

/** Licences we may ship in runtime dependencies (all GPLv3/AGPLv3-compatible per FSF). */
export const RUNTIME_ALLOW = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'Unlicense',
  'Zlib',
]);

/** Extra licences acceptable for build/test-only tooling that is never shipped. */
const DEV_ONLY_ALLOW = new Set(['MPL-2.0', 'CC-BY-4.0', 'CC-BY-3.0', 'Python-2.0']);

/** Manually reviewed exceptions ("name@version" -> reason). Keep empty unless a human read the text. */
const REVIEWED_EXCEPTIONS = new Map([]);

function normalise(lic) {
  if (!lic) return undefined;
  if (typeof lic === 'object') return lic.type;
  return String(lic).trim();
}

const pkgs = JSON.parse(runNpm(['query', '*']));
const devAllowed = new Set([...RUNTIME_ALLOW, ...DEV_ONLY_ALLOW]);
const failures = [];
const counts = new Map();
let checked = 0;
for (const p of pkgs) {
  if (p.name?.startsWith('@shiftknit/') || p.location === '') continue; // our own code
  const id = `${p.name}@${p.version}`;
  const lic = normalise(p.license);
  checked++;
  counts.set(lic ?? '(none)', (counts.get(lic ?? '(none)') ?? 0) + 1);
  if (REVIEWED_EXCEPTIONS.has(id)) continue;
  if (!lic) {
    failures.push(`${id}: no licence field`);
    continue;
  }
  if (!satisfiesSpdx(lic, p.dev ? devAllowed : RUNTIME_ALLOW))
    failures.push(`${id}: ${lic} (${p.dev ? 'dev' : 'runtime'}) not allowlisted`);
}

console.info(`Checked ${checked} third-party packages.`);
for (const [lic, n] of [...counts].sort((a, b) => b[1] - a[1])) console.info(`  ${lic}: ${n}`);
if (failures.length) {
  console.error(`\nLicence check FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.info('Licence check passed: all dependencies are AGPL-3.0-compatible.');
