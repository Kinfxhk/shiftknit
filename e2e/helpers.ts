// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Page } from '@playwright/test';

/** Collect requests to other origins, console errors and page errors (incl. CSP). */
export function watch(page: Page, baseURL: string): { external: string[]; errors: string[] } {
  const external: string[] = [];
  const errors: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith(baseURL) && !url.startsWith('data:') && !url.startsWith('blob:'))
      external.push(url);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return { external, errors };
}

export async function open(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await page.locator('body[data-ready="true"]').waitFor();
}

/** A project at the size limits (30 people × 31 days × 6 shifts). */
export function bigProjectJson(): string {
  const shifts = [
    ['e', 'Early', '06:00', '14:00'],
    ['m', 'Middle', '10:00', '18:00'],
    ['l', 'Late', '14:00', '22:00'],
    ['n', 'Night', '22:00', '06:00'],
    ['s', 'Short', '09:00', '13:00'],
    ['t', 'Twilight', '17:00', '21:00'],
  ].map(([id, name, start, end]) => ({ id, name, start, end, breakMinutes: 30, demand: 2 }));
  const staff = Array.from({ length: 30 }, (_, i) => ({
    id: `p${i}`,
    name: `Person ${i + 1}`,
    maxWeeklyMinutes: 2880,
  }));
  return JSON.stringify({
    schema: 'shiftknit/project',
    version: 1,
    name: 'Big',
    timeZone: 'Asia/Hong_Kong',
    start: '2026-12-01',
    days: 31,
    skills: [],
    shifts,
    staff,
  });
}
