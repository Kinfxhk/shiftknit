// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'test/**/*.test.ts', 'test/**/*.test.mjs'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
