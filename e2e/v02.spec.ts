// SPDX-License-Identifier: AGPL-3.0-or-later
// v0.2: saving at once, storage safety, backup, share file, availability form round trip,
// publishing with change lists, weekly hours, in-page availability editing, next period.
import { expect, test, type Page } from '@playwright/test';
import { copyFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { open, watch } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-init')) {
      sessionStorage.setItem('e2e-init', '1');
      localStorage.clear();
      indexedDB.deleteDatabase('shiftknit');
    }
  });
});

async function solved(page: Page): Promise<void> {
  await open(page);
  await page.locator('#solve-btn').click();
  await expect(page.locator('#status')).toHaveAttribute('data-status', /proven|feasible|shortfall/);
}

async function downloadText(
  page: Page,
  selector: string,
): Promise<{ name: string; text: string; path: string }> {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator(selector).click()]);
  // Keep the real file name (extension) so the browser opens .html files as pages.
  const path = test.info().outputPath(dl.suggestedFilename());
  copyFileSync((await dl.path())!, path);
  return { name: dl.suggestedFilename(), text: readFileSync(path, 'utf8'), path };
}

test('the rota is saved at once: reloading straight after solving or editing keeps it', async ({
  page,
}) => {
  await solved(page);
  const first = await page.locator('#cell-0-0').inputValue();
  await page.reload(); // no wait: v0.1 lost the rota here (200 ms save delay)
  await page.locator('body[data-ready="true"]').waitFor();
  await expect(page.locator('#cell-0-0')).toHaveValue(first);
  const other = first === '' ? 'open' : '';
  await page.locator('#cell-0-0').selectOption(other);
  await page.reload(); // an edit is saved when the page is hidden
  await page.locator('body[data-ready="true"]').waitFor();
  await expect(page.locator('#cell-0-0')).toHaveValue(other);
  await expect(page.locator('#status')).toHaveAttribute('data-status', 'edited');
});

test('storage status is shown, and a failing persistence request is handled', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'storage', {
      value: {
        persisted: () => Promise.resolve(false),
        persist: () => Promise.reject(new Error('blocked')),
      },
    });
  });
  const w = watch(page, 'http://127.0.0.1');
  await open(page);
  await expect(page.locator('#storage-status')).toHaveAttribute('data-state', 'best-effort');
  await page.locator('#p-name').fill('Edited');
  await page.locator('#p-name').blur();
  await expect(page.locator('#storage-status')).toHaveAttribute('data-state', 'best-effort');
  await expect(page.locator('#storage-status')).toContainText('may clear');
  expect(w.errors).toEqual([]);
});

test('backup reminder; full backup restores project, rota and published versions', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-backup')) {
      sessionStorage.setItem('e2e-backup', '1');
      localStorage.setItem('shiftknit-backup', JSON.stringify({ changes: 30 }));
    }
  });
  await solved(page);
  await expect(page.locator('#backup-reminder')).toBeVisible();
  await page.locator('#remind-dismiss').click();
  await expect(page.locator('#backup-reminder')).toBeHidden();
  await page.reload();
  await page.locator('body[data-ready="true"]').waitFor();
  await expect(page.locator('#backup-reminder')).toBeHidden();

  await page.locator('#publish-btn').click();
  await expect(page.locator('#versions li')).toHaveCount(1);
  const cell = await page.locator('#cell-1-1').inputValue();
  const backup = await downloadText(page, '#backup-btn');
  expect(JSON.parse(backup.text)).toMatchObject({ schema: 'shiftknit/backup', version: 1 });

  page.once('dialog', (d) => void d.accept());
  await page.locator('#delete-btn').click();
  await page.locator('body[data-ready="true"]').waitFor();
  await expect(page.locator('#status')).toHaveAttribute('data-status', 'empty');
  await page.locator('#import-file').setInputFiles(backup.path);
  await expect(page.locator('#import-msg')).toContainText('Backup restored');
  await expect(page.locator('#cell-1-1')).toHaveValue(cell);
  await expect(page.locator('#versions li')).toHaveCount(1);
});

test('share file: one offline page with the whole team and each person', async ({
  page,
  context,
}) => {
  await solved(page);
  await page.locator('#st-name-0').fill('<img src=x onerror="window.pwned=1">');
  await page.locator('#st-name-0').blur();
  const share = await downloadText(page, '#share-btn');
  expect(share.name).toMatch(/\.html$/);
  expect(share.text).not.toMatch(/<script/i);
  const viewer = await context.newPage();
  const requests: string[] = [];
  viewer.on('request', (r) => requests.push(r.url()));
  await viewer.goto(pathToFileURL(share.path).href);
  await expect(viewer.locator('h1')).toContainText('Rota (read-only copy)');
  await expect(viewer.locator('table').first().locator('tbody tr')).toHaveCount(
    await page.locator('#grid-table tbody tr').count(),
  );
  await expect(viewer.locator('details').first()).toContainText('<img src=x');
  expect(await viewer.evaluate(() => (window as { pwned?: number }).pwned)).toBeUndefined();
  expect(requests).toEqual([pathToFileURL(share.path).href]);
});

test('availability form: a person fills it in offline; the manager sees the changes and applies them', async ({
  page,
  context,
}) => {
  const w = watch(page, 'http://127.0.0.1');
  await open(page);
  const form = await downloadText(page, '#form-btn');
  const staffPage = await context.newPage();
  const requests: string[] = [];
  staffPage.on('request', (r) => requests.push(r.url()));
  const errors: string[] = [];
  staffPage.on('pageerror', (e) => errors.push(e.message));
  await staffPage.goto(pathToFileURL(form.path).href);
  await staffPage.locator('#make').click();
  await expect(staffPage.locator('#msg')).toContainText('choose your name');
  await staffPage.locator('#who').selectOption({ label: 'Ben' });
  await staffPage.locator('#d0-off').check();
  await staffPage.locator('#d1-between').check();
  await staffPage.locator('#d1-from').fill('06:00');
  await staffPage.locator('#d1-to').fill('16:00');
  await staffPage.locator('#d6-avoid').check();
  await staffPage.locator('#leave').fill('2030-01-01');
  await staffPage.locator('#make').click();
  await expect(staffPage.locator('#msg')).toContainText('2030-01-01');
  await staffPage.locator('#leave').fill('2026-11-05');
  await staffPage.locator('#note').fill('exam on Thursday');
  await staffPage.locator('#make').click();
  const reply = await staffPage.locator('#reply').inputValue();
  expect(JSON.parse(reply)).toMatchObject({ schema: 'shiftknit/availability', staff: 'ben' });
  expect(requests).toEqual([pathToFileURL(form.path).href]);
  expect(errors).toEqual([]);

  await page.locator('#reply-text').fill(`[09:12] Ben: ${reply}`);
  await page.locator('#reply-read').click();
  const card = page.locator('.reply[data-staff="ben"]');
  await expect(card).toContainText('Mon: any time → not available');
  await expect(card).toContainText('Tue: any time → 06:00–16:00');
  await expect(card).toContainText('Leave: none → 2026-11-05');
  await expect(card).toContainText('exam on Thursday');
  await card.locator('button').click();
  await expect(page.locator('#reply-msg')).toContainText('Applied to Ben');

  await page.locator('#av-person').selectOption({ label: 'Ben' });
  await expect(page.locator('#av-mode-0')).toHaveValue('off');
  await expect(page.locator('#av-mode-1')).toHaveValue('between');
  await expect(page.locator('#av-from-1')).toHaveValue('06:00');
  await page.locator('#solve-btn').click();
  await expect(page.locator('#status')).toHaveAttribute('data-status', /proven|feasible|shortfall/);
  const ben = await page
    .locator('#grid-table tbody tr', { hasText: 'Ben' })
    .locator('select')
    .evaluateAll((els) => els.map((e) => (e as HTMLSelectElement).value));
  // Sample period starts on Monday 2026-11-02: Mondays (0, 7) off, Thursday 2026-11-05 on leave.
  expect(ben[0]).toBe('');
  expect(ben[7]).toBe('');
  expect(ben[3]).toBe('');
  expect(w.external).toEqual([]);
  expect(w.errors).toEqual([]);
});

test('hostile replies are refused with a clear message', async ({ page }) => {
  await open(page);
  for (const text of [
    '{"schema":"shiftknit/availability","version":1,"period":"2026-11-02","staff":"zz","name":"x","days":["any","any","any","any","any","any","any"],"leave":[],"avoid":[]}',
    '{"__proto__":{"x":1},"schema":"shiftknit/availability"}',
    'hello',
  ]) {
    await page.locator('#reply-text').fill(text);
    await page.locator('#reply-read').click();
    await expect(page.locator('#reply-msg')).toContainText('Could not read');
    await expect(page.locator('.reply')).toHaveCount(0);
  }
});

test('publish, edit, publish again: change list, share file with changes, withdraw', async ({
  page,
}) => {
  page.on('dialog', (d) => void d.accept()); // confirmations (the edit may break a rule)
  await solved(page);
  await expect(page.locator('#pending')).toContainText('Not published yet');
  await page.locator('#publish-btn').click();
  await expect(page.locator('#publish-status')).toContainText('Published version 1');
  await expect(page.locator('#pending-summary')).toContainText('No changes since version 1');
  const v = await page.locator('#cell-0-0').inputValue();
  await page.locator('#cell-0-0').selectOption(v === '' ? 'open' : '');
  await expect(page.locator('#pending-summary')).toContainText('Changes since version 1: 1');
  await expect(page.locator('#pending-list li')).toHaveCount(1);
  const csv = await downloadText(page, '#changes-csv');
  expect(csv.text.split('\r\n')[0]).toBe('\ufeffDate,Person,Before,After');
  await page.locator('#publish-btn').click();
  await expect(page.locator('#versions li')).toHaveCount(2);
  const share = await downloadText(page, '#share-v2');
  expect(share.text).toContain('Changes since version 1');
  expect(share.text).toContain('Published version 2');
  await page.locator('#withdraw-btn').click();
  await expect(page.locator('#versions li[data-version="2"]')).toContainText('(withdrawn)');
  await expect(page.locator('#versions li[data-version="1"]')).toContainText('(current)');
  await expect(page.locator('#pending-summary')).toContainText('Changes since version 1: 1');
  await page.reload();
  await page.locator('body[data-ready="true"]').waitFor();
  await expect(page.locator('#versions li[data-version="2"]')).toContainText('(withdrawn)');
});

test('weekly hours per person, with a CSV', async ({ page }) => {
  await solved(page);
  const rows = page.locator('#hours-table tbody tr');
  await expect(rows).toHaveCount(await page.locator('#grid-table tbody tr').count());
  await expect(page.locator('#hours-table thead th')).toHaveCount(1 + 2 + 2); // 14 days = 2 weeks
  const csv = await downloadText(page, '#csv-hours');
  expect(csv.text.split('\r\n')[0]).toBe(
    '\ufeffPerson,Week from 2026-11-02,Week from 2026-11-09,Total hours,Shifts',
  );
});

test('availability and preferences can be edited in the page', async ({ page }) => {
  await open(page);
  await page.locator('#av-person').selectOption({ label: 'Ada' });
  await page.locator('#av-mode-2').selectOption('off');
  await expect(page.locator('#av-mode-2')).toHaveValue('off');
  await page.locator('#av-mode-3').selectOption('between');
  await page.locator('#av-from-3').fill('12:00');
  await page.locator('#av-from-3').blur();
  await expect(page.locator('#av-from-3')).toHaveValue('12:00');
  await page.locator('#add-pref').click();
  await page.locator('#pf-when-0').selectOption('w4');
  await page.locator('#pf-shift-0').selectOption('close');
  await expect(page.locator('#pref-table tbody tr')).toHaveCount(1);
  await page.locator('#solve-btn').click();
  await expect(page.locator('#status')).toHaveAttribute('data-status', /proven|feasible|shortfall/);
  const ada = await page
    .locator('#grid-table tbody tr', { hasText: 'Ada' })
    .locator('select')
    .evaluateAll((els) => els.map((e) => (e as HTMLSelectElement).value));
  expect(ada[2]).toBe(''); // Wednesday off
  expect(ada[9]).toBe('');
  expect(ada[3]).not.toBe('open'); // Thursday only from 12:00: the 07:00 opening shift is out
  await page.reload();
  await page.locator('body[data-ready="true"]').waitFor();
  await page.locator('#av-person').selectOption({ label: 'Ada' });
  await expect(page.locator('#av-mode-2')).toHaveValue('off');
});

test('copy to the next period', async ({ page }) => {
  await solved(page);
  const before = await page.locator('#cell-1-0').inputValue();
  await page.locator('#next-btn').click();
  await expect(page.locator('#p-start')).toHaveValue('2026-11-16');
  await expect(page.locator('#status')).toHaveAttribute('data-status', 'edited');
  await expect(page.locator('#status')).toContainText('next period');
  await expect(page.locator('#cell-1-0')).toHaveValue(before);
});
