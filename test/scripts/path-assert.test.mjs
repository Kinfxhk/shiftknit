// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findHardcodedPathAssertions } from '../../scripts/lib/path-assert.mjs';

const fixture = (name) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

describe('hard-coded path assertion detector', () => {
  it('catches every deliberately wrong path separator in the fixture', () => {
    const hits = findHardcodedPathAssertions(fixture('bad-paths.txt'));
    expect(hits.map((h) => h.line)).toEqual([2, 3, 4, 5]);
  });

  it('accepts node:path, URLs, routes, dates and opted-out lines', () => {
    expect(findHardcodedPathAssertions(fixture('good-paths.txt'))).toEqual([]);
  });
});
