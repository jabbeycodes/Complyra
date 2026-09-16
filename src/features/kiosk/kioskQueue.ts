/**
 * kioskQueue.ts — tiny offline punch queue backed by IndexedDB. No new deps.
 *
 * When the kiosk loses connectivity, punches are enqueued locally (marked
 * offline=true in the input) and flushed by useKioskSync on the `online`
 * event and on an interval. The queue is the single source of truth for
 * unsent punches; removal happens only after submitKioskPunch succeeds.
 */

import type { KioskPunchInput } from "./kioskClient";

const DB_NAME = "complyrer-kiosk";
const STORE_NAME = "punches";
const DB_VERSION = 1;

/** A punch waiting to be sent, plus capture metadata. */
export interface QueuedPunch {
  /** Client-generated id (used as the IndexedDB key). */
  id: string;
  /**
   * The raw kiosk token, captured alongside the punch: the flush-time
   * submitKioskPunch(token, input) call needs it, and the token may have
   * rotated since the page bootstrapped. Records queued before the token
   * field existed (DB version 1) have no token and will fail validation on
   * flush rather than submit against the wrong site.
   */
  token: string;
  /** The exact input submitKioskPunch will receive on flush. */
  input: KioskPunchInput;
  /** ISO timestamp the punch was captured on this device. */
  clientTimestamp: string;
  /** How many submit attempts have been made (for backoff display). */
  attempts: number;
}

function idb(): IDBFactory {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is not available in this environment.");
  }
  return indexedDB;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = idb().open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open kiosk queue."));
  });
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const request = fn(tx.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Kiosk queue operation failed."));
        tx.oncomplete = () => db.close();
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error("Kiosk queue transaction failed."));
        };
      }),
  );
}

function newQueueId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `q-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/**
 * Enqueue a punch for later delivery. The input is forced to offline=true
 * so the record is honest about how it was captured. The raw kiosk token
 * is stored with the record so the flush-time submitKioskPunch(token,
 * input) call authenticates against the same site. Returns the queue id.
 */
export async function enqueuePunch(
  input: KioskPunchInput,
  token: string,
): Promise<string> {
  const id = newQueueId();
  const record: QueuedPunch = {
    id,
    token,
    input: { ...input, offline: true },
    clientTimestamp: new Date().toISOString(),
    attempts: 0,
  };
  await run("readwrite", (store) => store.put(record));
  return id;
}

/** All queued punches, oldest first. */
export async function listQueued(): Promise<QueuedPunch[]> {
  const records = await run<QueuedPunch[]>("readonly", (store) => store.getAll());
  return records.sort((a, b) => (a.clientTimestamp < b.clientTimestamp ? -1 : 1));
}

/** Remove a punch from the queue after it was delivered successfully. */
export async function removeQueued(id: string): Promise<void> {
  await run("readwrite", (store) => store.delete(id));
}

/** Bump the attempt counter on a queued punch (sync diagnostics). */
export async function bumpQueuedAttempts(id: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const get = tx.objectStore(STORE_NAME).get(id);
      get.onsuccess = () => {
        const record = get.result as QueuedPunch | undefined;
        if (record) {
          record.attempts += 1;
          tx.objectStore(STORE_NAME).put(record);
        }
        resolve();
      };
      get.onerror = () => reject(get.error ?? new Error("Failed to read queued punch."));
      tx.onerror = () => reject(tx.error ?? new Error("Kiosk queue transaction failed."));
    });
  } finally {
    db.close();
  }
}
