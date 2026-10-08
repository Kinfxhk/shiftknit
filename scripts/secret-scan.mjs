#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Secret scan (cross-platform). Preferred: gitleaks (https://github.com/gitleaks/gitleaks,
// MIT) over the git history and the working tree. When gitleaks is not installed we run
// a conservative pattern scan and say so loudly ("FALLBACK"); it never pretends to be
// gitleaks. On Linux CI (CI=true) gitleaks is mandatory and its absence is a failure.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
process.chdir(root);

const probe = spawnSync('gitleaks', ['version'], { encoding: 'utf8' });
const hasGitleaks = probe.status === 0;

if (hasGitleaks) {
  console.info(`Running gitleaks ${probe.stdout.trim()} on git history...`);
  const run = (args) => spawnSync('gitleaks', args, { stdio: 'inherit' }).status;
  if (run(['git', '--redact', '--no-banner', '--exit-code', '1', '.']) !== 0) process.exit(1);
  console.info('Running gitleaks on the working tree...');
  if (
    run([
      'dir',
      '--redact',
      '--no-banner',
      '--exit-code',
      '1',
      '--config',
      '.gitleaks.toml',
      '.',
    ]) !== 0
  )
    process.exit(1);
  console.info('Secret scan passed (gitleaks).');
  process.exit(0);
}

if (process.env.CI && process.platform === 'linux') {
  console.error('Secret scan FAILED: gitleaks is required on Linux CI but was not found.');
  process.exit(1);
}

console.warn('WARNING: gitleaks not found; running the FALLBACK pattern scan (less thorough).');
const PATTERNS = [
  /AKIA[0-9A-Z]{16}/, // AWS access key id
  /gh[pousr]_[A-Za-z0-9]{36,}/, // GitHub tokens
  /github_pat_[A-Za-z0-9_]{50,}/, // GitHub fine-grained PAT
  /sk-[A-Za-z0-9_-]{20,}/, // OpenAI/OpenRouter-style keys
  /xox[baprs]-[A-Za-z0-9-]{10,}/, // Slack tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // private keys
  /AIza[0-9A-Za-z_-]{35}/, // Google API key
];
const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
  encoding: 'utf8',
})
  .split('\0')
  .filter((f) => f && f !== 'scripts/secret-scan.mjs' && !f.endsWith('package-lock.json'));
let found = 0;
for (const f of files) {
  let text;
  try {
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\0')) continue; // binary
  text.split('\n').forEach((line, i) => {
    for (const p of PATTERNS)
      if (p.test(line)) {
        console.error(`${f}:${i + 1}: matches ${p}`);
        found++;
      }
  });
}
if (found) {
  console.error('Secret scan FAILED (fallback).');
  process.exit(1);
}
console.warn(`Secret scan passed (FALLBACK patterns only, ${files.length} files; not gitleaks).`);
