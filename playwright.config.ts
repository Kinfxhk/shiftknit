// SPDX-License-Identifier: AGPL-3.0-or-later
// Headless browser tests. Run with `npm run test:e2e` (builds the web UI first).
// Uses Playwright's bundled Chromium (`npx playwright install chromium`), or any local
// Chrome/Chromium via PW_CHROMIUM_PATH=/usr/bin/google-chrome.
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4893);
const executablePath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  ...(process.env.CI ? { workers: 2 } : {}),
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    locale: 'en-US',
    colorScheme: 'light',
    viewport: { width: 1366, height: 900 },
    serviceWorkers: 'allow',
    acceptDownloads: true,
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    // `node --import tsx` works the same on Linux, macOS and Windows.
    command: 'node --import tsx packages/cli/src/serve.ts',
    url: `http://127.0.0.1:${PORT}/healthz`,
    env: { SHIFTKNIT_PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
