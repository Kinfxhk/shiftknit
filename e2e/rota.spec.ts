// SPDX-License-Identifier: AGPL-3.0-or-later
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { bigProjectJson, open, watch } from './helpers';

test.beforeEach(async ({ page }) => {
  // Start every test with empty storage (but keep it across reloads inside a test).
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-init')) {
      sessionStorage.setItem('e2e-init', '1');
      localStorage.clear();
      indexedDB.deleteDatabase('shiftknit');
    }
  });
});

test('create → make rota → hand edit breaks a rule → live warning → lock → re-solve → ICS', async ({
  page,
  baseURL,
}) => {
  const w = watch(page, baseURL!);
  await open(page);
  await page.locator('#new-btn').click();
  await page.locator('#p-name').fill('Test team');
  await page.locator('#p-name').blur();
  await page.locator('#p-start').fill('2026-11-02');
  await page.locator('#p-start').blur();
  await page.locator('#add-staff').click();
  await page.locator('#st-name-3').fill('Dana');
  await page.locator('#st-name-3').blur();
  await expect(page.locator('#staff-table tbody tr')).toHaveCount(4);

  await page.locator('#solve-btn').click();
  await expect(page.locator('#status')).toHaveAttribute('data-status', /proven|feasible/);
  await expect(page.locator('#check-ok')).toBeVisible();
  await expect(page.locator('#grid-table tbody tr')).toHaveCount(4);

  // Put a second person on Monday's shift: overstaffed (demand 1).
  const mon = ['#cell-0-0', '#cell-1-0', '#cell-2-0', '#cell-3-0'];
  const values = await Promise.all(mon.map((s) => page.locator(s).inputValue()));
  const idle = values.findIndex((v) => v === '');
  await page.locator(mon[idle]!).selectOption('day');
  await expect(page.locator('#status')).toHaveAttribute('data-status', 'edited');
  await expect(page.locator('#violations li[data-rule="overstaffed"]')).toHaveCount(1);
  await expect(page.locator(mon[idle]!)).toHaveAttribute('aria-invalid', 'true');

  // Lock Dana on Wednesday, then re-solve: the lock is kept and the rota is clean again.
  await page.locator('#cell-3-2').selectOption('day');
  await page.locator('#lock-3-2').click();
  await expect(page.locator('#lock-3-2')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#solve-btn').click();
  await expect(page.locator('#status')).toHaveAttribute('data-status', /proven|feasible/);
  await expect(page.locator('#check-ok')).toBeVisible();
  await expect(page.locator('#cell-3-2')).toHaveValue('day');

  // Calendar file for Dana.
  await page.locator('#ics-staff').selectOption({ label: 'Dana' });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#ics-btn').click()]);
  expect(dl.suggestedFilename()).toBe('Test-team-Dana.ics');
  const ics = readFileSync((await dl.path())!, 'utf8');
  expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
  expect(ics).toContain('DTSTART:20261104T010000Z'); // Wed 09:00 in Hong Kong
  expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);

  expect(w.external).toEqual([]);
  expect(w.errors).toEqual([]);
});

test('works offline after the first visit', async ({ page, context, baseURL }) => {
  const w = watch(page, baseURL!);
  await open(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.locator('body[data-ready="true"]').waitFor();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.locator('body[data-ready="true"]').waitFor();
  await page.locator('#solve-btn').click();
  await expect(page.locator('#status')).toHaveAttribute('data-status', /proven|feasible/);
  await context.setOffline(false);
  expect(w.external).toEqual([]);
  expect(w.errors).toEqual([]);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`no serious accessibility problems (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page);
    await page.locator('#solve-btn').click();
    await expect(page.locator('#status')).toHaveAttribute('data-status', /proven|feasible/);
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    for (const view of ['#view-grid', '#view-week']) {
      await page.locator(view).click();
      const r = await new AxeBuilder({ page }).analyze();
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(
        bad.map((v) => `${v.id}: ${v.nodes.length} × ${v.nodes[0]?.target.join(' ')}`),
      ).toEqual([]);
    }
  });
}

test('the page stays responsive while the solver runs (30 × 31 × 6)', async ({ page }) => {
  await open(page);
  await page.locator('#import-file').setInputFiles({
    name: 'big.json',
    mimeType: 'application/json',
    buffer: Buffer.from(bigProjectJson()),
  });
  await expect(page.locator('#staff-table tbody tr')).toHaveCount(30);
  await page.locator('#solve-btn').click();
  await expect(page.locator('#status')).toHaveAttribute('data-status', 'solving');
  // The main thread answers quickly and controls still work during the solve.
  const t0 = Date.now();
  await page.evaluate(() => 1);
  expect(Date.now() - t0).toBeLessThan(500);
  await page.locator('#theme').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#status')).toHaveAttribute('data-status', /proven|feasible/, {
    timeout: 60_000,
  });
  await expect(page.locator('#check-ok')).toBeVisible();
  await expect(page.locator('#grid-table tbody tr')).toHaveCount(30);
});

test('stop button cancels a solve', async ({ page }) => {
  await open(page);
  await page.locator('#import-file').setInputFiles({
    name: 'big.json',
    mimeType: 'application/json',
    buffer: Buffer.from(bigProjectJson()),
  });
  await page.locator('#solve-btn').click();
  await page.locator('#stop-btn').click();
  await expect(page.locator('#status')).not.toHaveAttribute('data-status', 'solving');
  await expect(page.locator('#solve-btn')).toBeEnabled();
});

test('a proven conflict is explained (Traditional Chinese)', async ({ page }) => {
  await open(page);
  await page.locator('#lang').selectOption('zh-HK');
  await page.locator('#new-btn').click();
  await page.locator('#p-start').fill('2026-11-02');
  await page.locator('#p-start').blur();
  await page.locator('#p-skills').fill('急救');
  await page.locator('#p-skills').blur();
  await page.locator('#sh-skill-0').selectOption('急救');
  await page.locator('#solve-btn').click();
  await expect(page.locator('#status')).toHaveAttribute('data-status', 'shortfall');
  await expect(page.locator('#status')).toContainText('已證明');
  await expect(page.locator('#explain-list li').first()).toContainText('急救');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant-HK');
});

test('the rota survives a reload; "delete all data" removes it', async ({ page }) => {
  await open(page);
  await page.locator('#solve-btn').click();
  await expect(page.locator('#status')).toHaveAttribute('data-status', /proven|feasible/);
  const first = await page.locator('#cell-0-0').inputValue();
  await page.waitForTimeout(400); // saving is debounced
  await page.reload();
  await page.locator('body[data-ready="true"]').waitFor();
  await expect(page.locator('#status')).toHaveAttribute('data-status', /proven|feasible/);
  await expect(page.locator('#cell-0-0')).toHaveValue(first);
  page.once('dialog', (d) => void d.accept());
  await page.locator('#delete-btn').click();
  await page.locator('body[data-ready="true"]').waitFor();
  await expect(page.locator('#status')).toHaveAttribute('data-status', 'empty');
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});

test('hostile project files are refused and leave the project unchanged', async ({ page }) => {
  await open(page);
  const before = await page.locator('#p-name').inputValue();
  for (const body of [
    '{"__proto__":{"polluted":1}}',
    'x'.repeat(100),
    '{"schema":"shiftknit/project","version":1,"name":"<img src=x onerror=alert(1)>"}',
  ]) {
    await page
      .locator('#import-file')
      .setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(body) });
    await expect(page.locator('#import-msg')).toContainText('Could not open');
    await expect(page.locator('#p-name')).toHaveValue(before);
  }
  expect(await page.evaluate(() => ({}) as Record<string, unknown>)).not.toHaveProperty('polluted');
});

test('names are shown as text, never as markup', async ({ page }) => {
  await open(page);
  await page.locator('#st-name-0').fill('<img src=x onerror="window.pwned=1">');
  await page.locator('#st-name-0').blur();
  await page.locator('#solve-btn').click();
  await expect(page.locator('#status')).toHaveAttribute('data-status', /proven|feasible/);
  await expect(page.locator('#grid-table tbody th').first()).toHaveText(
    '<img src=x onerror="window.pwned=1">',
  );
  expect(
    await page.evaluate(() => (window as unknown as { pwned?: number }).pwned),
  ).toBeUndefined();
});

test('print views: team, per person, rest-day roster', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => void (window as unknown as { printed: number }).printed++;
  });
  await open(page);
  await page.locator('#solve-btn').click();
  await expect(page.locator('#status')).toHaveAttribute('data-status', /proven|feasible/);
  await page.locator('#print-rest').click();
  await expect(page.locator('#rest-table tbody tr')).toHaveCount(7);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#print-area')).toBeVisible();
  await expect(page.locator('#setup')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await page.locator('#print-staff').click();
  await expect(page.locator('#print-area .print-page')).toHaveCount(7);
  await page.locator('#print-team').click();
  await expect(page.locator('#print-area .print-grid tbody tr')).toHaveCount(7);
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(3);
});

test('CSV export neutralises formula-like names', async ({ page }) => {
  await open(page);
  await page.locator('#st-name-0').fill('=HYPERLINK("http://x","y")');
  await page.locator('#st-name-0').blur();
  await page.locator('#solve-btn').click();
  await expect(page.locator('#status')).toHaveAttribute('data-status', /proven|feasible/);
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#csv-grid').click(),
  ]);
  const csv = readFileSync((await dl.path())!, 'utf8');
  expect(csv).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
  expect(csv).not.toMatch(/(^|,)=/m);
});
