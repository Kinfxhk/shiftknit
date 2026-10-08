// SPDX-License-Identifier: AGPL-3.0-or-later
// Keeping local data safe: ask the browser not to clear our storage automatically, and
// remind people to download a backup now and then. No network; the reminder state lives in
// localStorage next to the display settings.

export type PersistState = 'persisted' | 'best-effort' | 'unsupported';

/** Ask for persistent storage once; never throws. */
export async function requestPersistence(
  storage: Pick<StorageManager, 'persist' | 'persisted'> | undefined = globalThis.navigator
    ?.storage,
): Promise<PersistState> {
  try {
    if (!storage || typeof storage.persist !== 'function') return 'unsupported';
    if (typeof storage.persisted === 'function' && (await storage.persisted())) return 'persisted';
    return (await storage.persist()) ? 'persisted' : 'best-effort';
  } catch {
    return 'best-effort';
  }
}

export interface BackupState {
  /** Epoch ms of the last backup download, if any. */
  lastBackup?: number | undefined;
  /** Epoch ms when the reminder was last dismissed. */
  dismissed?: number | undefined;
  /** Edits saved since the last backup. */
  changes?: number | undefined;
}

export const REMIND_AFTER_CHANGES = 20;
export const REMIND_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Show the reminder when there are enough unsaved-to-file edits, the last backup is old
 * (or never happened), and it was not dismissed in the last 7 days.
 */
export function shouldRemind(s: BackupState, now: number): boolean {
  const changes = s.changes ?? 0;
  if (!Number.isFinite(changes) || changes < REMIND_AFTER_CHANGES) return false;
  if (s.lastBackup !== undefined && now - s.lastBackup < REMIND_EVERY_MS) return false;
  if (s.dismissed !== undefined && now - s.dismissed < REMIND_EVERY_MS) return false;
  return true;
}

const KEY = 'shiftknit-backup';

export function loadBackupState(): BackupState {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const o = v as Record<string, unknown>;
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
    return { lastBackup: num(o.lastBackup), dismissed: num(o.dismissed), changes: num(o.changes) };
  } catch {
    return {};
  }
}

export function saveBackupState(s: BackupState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export const BACKUP_KEY = KEY;
