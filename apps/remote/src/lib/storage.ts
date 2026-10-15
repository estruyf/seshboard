import type { Paired } from './link.ts';

/**
 * The phone's pairing, in IndexedDB on this site only. The site serves nothing but this app, under a strict CSP, so no
 * other script can read it. One computer at a time.
 */
const DB = 'switchboard-remote';
const STORE = 'pairing';
const KEY = 'current';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = work(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function loadPaired(): Promise<Paired | null> {
  const value = (await run('readonly', (store) => store.get(KEY))) as Paired | undefined;
  return value && value.deviceSecret instanceof Uint8Array && value.enginePublicKey instanceof Uint8Array ? value : null;
}

export const savePaired = (paired: Paired) => run('readwrite', (store) => store.put(paired, KEY)).then(() => undefined);

export const forgetPaired = () => run('readwrite', (store) => store.delete(KEY)).then(() => undefined);

/** The project this device last started a session in, so New session can start there again. Not secret: localStorage. */
const LAST_PROJECT = 'switchboard-remote:last-project';

export function lastProject(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT);
  } catch {
    return null;
  }
}

export function rememberProject(projectId: string): void {
  try {
    localStorage.setItem(LAST_PROJECT, projectId);
  } catch {
    // Private browsing without storage: New session just suggests from the sessions.
  }
}
