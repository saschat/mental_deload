/**
 * Minimal IndexedDB key/value store shared by the page and the service worker
 * (the service worker cannot read localStorage).
 */
import type { FamilyEvent, Kid, Settings, Source, Task } from "../core/types";

const DB_NAME = "mental-deload";
const STORE = "kv";

export interface Snapshot {
  kids: Kid[];
  sources: Source[];
  events: FamilyEvent[];
  tasks: Task[];
  settings: Settings | null;
  savedAt: string;
}

export const SNAPSHOT_KEY = "snapshot";
export const SENT_KEY = "sentReminders";
export const LAST_CHECK_KEY = "lastReminderCheck";

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result as T);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export function idbGet<T>(key: string): Promise<T | undefined> {
  return run<T | undefined>("readonly", (s) => s.get(key));
}

export function idbSet(key: string, value: unknown): Promise<void> {
  return run<void>("readwrite", (s) => s.put(value, key)).then(() => undefined);
}

export function idbDel(key: string): Promise<void> {
  return run<void>("readwrite", (s) => s.delete(key)).then(() => undefined);
}

export async function idbClear(): Promise<void> {
  await run<void>("readwrite", (s) => s.clear());
}
