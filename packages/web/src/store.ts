// SPDX-License-Identifier: AGPL-3.0-or-later
// Local storage: the project and rota live in IndexedDB in this browser only. Small display
// settings live in localStorage. "Delete all data" removes both.

const DB = 'shiftknit';
const STORE = 'kv';
const KEY = 'current';
export const SETTINGS_KEY = 'shiftknit-settings';
/** Synchronous safety copy written when the page is hidden or closed (IndexedDB is
 * asynchronous and a closing page may not finish the write). Removed after each completed
 * IndexedDB save, and preferred on the next load when present. */
export const PENDING_KEY = 'shiftknit-pending';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

export async function loadState(): Promise<unknown> {
  try {
    const pending = localStorage.getItem(PENDING_KEY);
    if (pending) return JSON.parse(pending) as unknown;
  } catch {
    /* fall back to IndexedDB */
  }
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => {
        resolve(req.result);
        db.close();
      };
      req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
    });
  } catch {
    return undefined; // private mode or storage disabled: start fresh
  }
}

export async function saveState(value: unknown): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, KEY);
      tx.oncomplete = () => {
        db.close();
        try {
          localStorage.removeItem(PENDING_KEY);
        } catch {
          /* ignore */
        }
        resolve();
      };
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    });
  } catch {
    // Storage is best effort; the page keeps working without it.
  }
}

export function hasPending(): boolean {
  try {
    return localStorage.getItem(PENDING_KEY) !== null;
  } catch {
    return false;
  }
}

/** Write the safety copy synchronously; false when it does not fit or storage is off. */
export function saveStateSync(value: unknown): boolean {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export async function wipeAll(): Promise<void> {
  try {
    localStorage.removeItem(PENDING_KEY);
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem('shiftknit-backup');
  } catch {
    /* ignore */
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

export interface Settings {
  lang?: string | undefined;
  theme?: string | undefined;
  large?: boolean | undefined;
  view?: string | undefined;
  timeLimit?: number | undefined;
}

export function loadSettings(): Settings {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Settings) : {};
  } catch {
    return {};
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
