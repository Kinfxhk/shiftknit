// SPDX-License-Identifier: AGPL-3.0-or-later
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { npmCommand, runNpm } from '../../scripts/lib/proc.mjs';

describe('portable npm launch', () => {
  it('prefers npm-cli.js run by the current node binary', () => {
    const cli = join('x', 'npm', 'bin', 'npm-cli.js');
    const cmd = npmCommand(['query', '*'], {
      env: { npm_execpath: cli },
      execPath: 'node-bin',
      platform: 'win32',
      exists: (p) => p === cli,
    });
    expect(cmd).toEqual({ file: 'node-bin', args: [cli, 'query', '*'], shell: false });
  });

  it('falls back to the npm.cmd shim through a shell on Windows', () => {
    const cmd = npmCommand(['-v'], {
      env: {},
      execPath: 'node',
      platform: 'win32',
      exists: () => false,
    });
    expect(cmd).toEqual({ file: 'npm.cmd', args: ['-v'], shell: true });
  });

  it('falls back to plain npm without a shell elsewhere', () => {
    const cmd = npmCommand(['-v'], {
      env: {},
      execPath: 'node',
      platform: 'linux',
      exists: () => false,
    });
    expect(cmd).toEqual({ file: 'npm', args: ['-v'], shell: false });
  });

  it('really runs npm on this machine (no ENOENT)', () => {
    expect(runNpm(['--version']).trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
