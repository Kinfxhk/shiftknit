// SPDX-License-Identifier: AGPL-3.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  REMIND_AFTER_CHANGES,
  REMIND_EVERY_MS,
  requestPersistence,
  shouldRemind,
} from '../src/safety';

const DAY = 86_400_000;

describe('persistent storage request', () => {
  it('reports each outcome and never throws', async () => {
    expect(await requestPersistence(undefined)).toBe('unsupported');
    expect(await requestPersistence({} as never)).toBe('unsupported');
    const mk = (persisted: boolean, grant: boolean | 'throw') => ({
      persisted: async () => persisted,
      persist: async () => {
        if (grant === 'throw') throw new Error('denied');
        return grant;
      },
    });
    expect(await requestPersistence(mk(true, false))).toBe('persisted');
    expect(await requestPersistence(mk(false, true))).toBe('persisted');
    expect(await requestPersistence(mk(false, false))).toBe('best-effort');
    expect(await requestPersistence(mk(false, 'throw'))).toBe('best-effort');
  });
});

describe('backup reminder', () => {
  const now = 1_800_000_000_000;
  it('stays quiet with few edits, a recent backup or a recent dismissal', () => {
    expect(shouldRemind({}, now)).toBe(false);
    expect(shouldRemind({ changes: REMIND_AFTER_CHANGES - 1 }, now)).toBe(false);
    expect(shouldRemind({ changes: 999, lastBackup: now - DAY }, now)).toBe(false);
    expect(shouldRemind({ changes: 999, dismissed: now - 6 * DAY }, now)).toBe(false);
    expect(shouldRemind({ changes: Number.NaN }, now)).toBe(false);
  });

  it('reminds when there are many edits and no backup, or the backup is old', () => {
    expect(shouldRemind({ changes: REMIND_AFTER_CHANGES }, now)).toBe(true);
    expect(shouldRemind({ changes: 50, lastBackup: now - 8 * DAY }, now)).toBe(true);
    expect(
      shouldRemind({ changes: 50, lastBackup: now - 8 * DAY, dismissed: now - 8 * DAY }, now),
    ).toBe(true);
  });

  it('never reminds within 7 days of a backup or dismissal, whatever else (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: REMIND_EVERY_MS - 1 }),
        fc.boolean(),
        (changes, age, viaBackup) => {
          const s = viaBackup
            ? { changes, lastBackup: now - age }
            : { changes, dismissed: now - age };
          expect(shouldRemind(s, now)).toBe(false);
        },
      ),
    );
  });
});
