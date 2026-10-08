// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseSpdx, satisfiesSpdx } from '../../scripts/lib/spdx.mjs';

const ALLOW = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-3-Clause',
  'GPL-3.0-or-later WITH GCC-exception-3.1',
]);

describe('SPDX licence gate parser', () => {
  it.each([
    ['MIT', true],
    ['GPL-2.0-only', false],
    ['(MIT OR Apache-2.0)', true],
    ['(GPL-2.0-only OR MIT)', true],
    ['MIT AND GPL-2.0-only', false],
    ['MIT AND (ISC OR GPL-2.0-only)', true],
    ['(MIT AND ISC) OR GPL-2.0-only', true],
    ['((MIT))', true],
    ['mit', false],
    ['Apache-2.0 WITH LLVM-exception', false],
    ['GPL-3.0-or-later WITH GCC-exception-3.1', true],
    ['MIT OR', false],
    ['(MIT', false],
    ['MIT)', false],
    ['MIT ISC', false],
    ['WITH MIT', false],
    ['', false],
    ['   ', false],
    ['MIT OR (GPL-2.0-only AND Apache-2.0)', true],
    ['SEE LICENSE IN LICENSE.txt', false],
    ['UNLICENSED', false],
  ])('%s -> %s', (expr, ok) => {
    expect(satisfiesSpdx(expr, ALLOW)).toBe(ok);
  });

  it('fails closed on non-string input', () => {
    expect(satisfiesSpdx(undefined, ALLOW)).toBe(false);
    expect(satisfiesSpdx({ type: 'MIT' }, ALLOW)).toBe(false);
    expect(satisfiesSpdx(['MIT'], ALLOW)).toBe(false);
  });

  it('gives AND precedence over OR', () => {
    expect(parseSpdx('A OR B AND C')).toEqual({
      type: 'or',
      parts: [
        { type: 'id', id: 'A' },
        {
          type: 'and',
          parts: [
            { type: 'id', id: 'B' },
            { type: 'id', id: 'C' },
          ],
        },
      ],
    });
  });
});
