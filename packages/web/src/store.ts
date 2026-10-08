// SPDX-License-Identifier: AGPL-3.0-or-later
// Local storage: the project and rota live in IndexedDB in this browser only. Small display
// settings live in localStorage. "Delete all data" removes both.

const DB = 'shiftknit';
const STORE = 'kv';
const KEY = 'current';
export const SETTINGS_KEY = 'shiftknit-settings';

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
        resolve();
      };
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    });
  } catch {
    // Storage is best effort; the page keeps working without it.
  }
}

export async function wipeAll(): Promise<void> {
  try {
    localStorage.removeItem(SETTINGS_KEY);
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
