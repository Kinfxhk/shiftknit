// SPDX-License-Identifier: AGPL-3.0-or-later
// Doc tests: every command in a ```sh block of the README and docs/ is checked.
// `npm run shiftknit -- …` commands are really executed (in a temporary folder);
// other npm commands must name scripts that exist (CI runs those scripts itself).
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { run } from '../packages/cli/src/main';

const root = fileURLToPath(new URL('../', import.meta.url));
const docs = [
  'README.md',
  ...readdirSync(join(root, 'docs'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `docs/${f}`),
];
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const work = mkdtempSync(join(tmpdir(), 'shiftknit-docs-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

function commands(file: string): string[] {
  const text = readFileSync(join(root, file), 'utf8').replace(/\r\n/g, '\n');
  const out: string[] = [];
  for (const m of text.matchAll(/```sh\n([\s\S]*?)```/g))
    for (const line of m[1]!.split('\n')) {
      const cmd = line.replace(/\s+#.*$/, '').trim();
      if (cmd) out.push(cmd);
    }
  return out;
}

/** Map a documented path to a real one: examples/ from the repo, outputs in a temp folder. */
function mapPath(arg: string): string {
  if (isAbsolute(arg)) return arg;
  if (arg.startsWith('examples/')) return join(root, arg);
  if (/\.(json|ics|csv)$/.test(arg)) return join(work, arg);
  return arg;
}

const all = docs.flatMap((f) => commands(f).map((cmd) => ({ file: f, cmd })));

describe('documented commands', () => {
  it('there are some', () => {
    expect(all.filter((c) => c.cmd.startsWith('npm run shiftknit')).length).toBeGreaterThanOrEqual(
      4,
    );
  });

  for (const { file, cmd } of all) {
    it(`${file}: ${cmd}`, () => {
      const words = cmd.split(/\s+/);
      if (cmd.startsWith('npm run shiftknit -- ')) {
        let err = '';
        const code = run(words.slice(4).map(mapPath), {
          out: () => undefined,
          err: (s) => (err += s),
          now: () => Date.now(),
        });
        expect(code, err).toBe(0);
      } else if (words[0] === 'npm') {
        const [, sub, name] = words;
        if (sub === 'run') expect(pkg.scripts, cmd).toHaveProperty(name!);
        else if (sub === 'start' || sub === 'test') expect(pkg.scripts).toHaveProperty(sub);
        else expect(['ci', 'install'], cmd).toContain(sub);
      } else if (words[0] === 'docker') {
        expect(readFileSync(join(root, 'Dockerfile'), 'utf8')).toMatch(/^FROM /m);
      } else if (words[0] === 'npx') {
        expect(['playwright', 'vitest', 'prettier', 'eslint', 'tsc'], cmd).toContain(words[1]);
      } else throw new Error(`unknown documented command: ${cmd}`);
    });
  }
});
