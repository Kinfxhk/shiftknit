#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Regenerate docs/screenshot.png (the synthetic sample café) against a running server.
// Usage: npm start (in another terminal), then
//   PW_CHROMIUM_PATH=/usr/bin/google-chrome npm run screenshot [-- http://127.0.0.1:4883]
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://127.0.0.1:4883';
const executablePath = process.env.PW_CHROMIUM_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
  locale: 'en-US',
});
await page.addInitScript(() =>
  localStorage.setItem(
    'shiftknit-settings',
    JSON.stringify({ lang: 'en', theme: 'light', large: false, view: 'grid', timeLimit: 15 }),
  ),
);
await page.goto(`${base}/`);
await page.locator('body[data-ready="true"]').waitFor();
await page.locator('#sample-btn').click();
await page.locator('#solve-btn').click();
await page.locator('#status[data-status="proven"], #status[data-status="feasible"]').waitFor();
await page.locator('#check-ok').waitFor();
// Header plus the rota section (the set-up forms are above it).
const top = await page.locator('header.top').boundingBox();
const rota = await page.locator('#rota').boundingBox();
await page.setViewportSize({ width: 1440, height: Math.ceil(rota.y + rota.height + 24) });
await page.screenshot({
  path: 'docs/screenshot.png',
  clip: { x: 0, y: rota.y - 16, width: 1440, height: rota.height + 32 },
});
void top;
await browser.close();
console.info('wrote docs/screenshot.png');
