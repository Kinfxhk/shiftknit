// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Portable child-process helpers. On Windows `npm` is a `.cmd` shim, so
// `execFileSync('npm', …)` fails with ENOENT. We therefore start npm's JavaScript
// entry point with the current Node binary, and only fall back to a shell-resolved
// `npm` (with `shell: true` on Windows) when that entry point cannot be found.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Candidate locations of npm-cli.js, most specific first. */
export function npmCliCandidates(env = process.env, execPath = process.execPath) {
  return [
    env.npm_execpath, // set by `npm run`
    join(dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), // Windows layout
    join(dirname(execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), // Unix
  ].filter((p) => typeof p === 'string' && /npm-cli\.[cm]?js$/.test(p));
}

/**
 * Decide how to launch npm. Returns `{ file, args, shell }` for execFileSync.
 * Pure apart from the injected `exists` check, so it is unit-tested for both platforms.
 */
export function npmCommand(
  args,
  {
    env = process.env,
    execPath = process.execPath,
    platform = process.platform,
    exists = existsSync,
  } = {},
) {
  const cli = npmCliCandidates(env, execPath).find((p) => exists(p));
  if (cli) return { file: execPath, args: [cli, ...args], shell: false };
  return { file: platform === 'win32' ? 'npm.cmd' : 'npm', args, shell: platform === 'win32' };
}

/** Run npm with the given arguments and return stdout. */
export function runNpm(args, opts = {}) {
  const { file, args: argv, shell } = npmCommand(args);
  return execFileSync(file, argv, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell,
    ...opts,
  });
}
