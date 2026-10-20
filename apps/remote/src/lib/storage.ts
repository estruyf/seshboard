import { computerId, type Paired } from './link.ts';

/**
 * The phone's pairings, one per computer, and its own push key, in IndexedDB on this site only. The site serves
 * nothing but this app, under a strict CSP, so no other script can read them.
 */
const DB = 'switchboard-remote';
const STORE = 'pairing';
/** Where the one pairing was kept before the phone could pair with more than one computer. */
const LEGACY = 'current';
const COMPUTER = 'computer:';
const PUSH_KEY = 'push-key';

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

const isPaired = (value: unknown): value is Paired => {
  const paired = value as Partial<Paired> | undefined;
  return paired?.deviceSecret instanceof Uint8Array && paired.enginePublicKey instanceof Uint8Array && typeof paired.address === 'string';
};

const computerKey = (paired: Paired) => `${COMPUTER}${computerId(paired)}`;

/** Every computer this phone is paired with. The pairing of an older version (one computer) moves over the first time. */
export async function loadComputers(): Promise<Paired[]> {
  const legacy = await run('readonly', (store) => store.get(LEGACY));
  if (isPaired(legacy)) {
    await saveComputer(legacy);
    await run('readwrite', (store) => store.delete(LEGACY));
  }
  const all = await run('readonly', (store) => store.getAll(IDBKeyRange.bound(COMPUTER, `${COMPUTER}￿`)));
  return all.filter(isPaired);
}

/** Adds a computer, or replaces what the phone had for it (a new pairing, its new address, its name). */
export const saveComputer = (paired: Paired) => run('readwrite', (store) => store.put(paired, computerKey(paired))).then(() => undefined);

export const forgetComputer = (paired: Paired) => run('readwrite', (store) => store.delete(computerKey(paired))).then(() => undefined);

/** This phone's own VAPID key pair (base64url), which every computer it is paired with signs its pushes with. */
export interface PushKey {
  publicKey: string;
  privateKey: string;
}

export async function loadPushKey(): Promise<PushKey | null> {
  const value = (await run('readonly', (store) => store.get(PUSH_KEY))) as Partial<PushKey> | undefined;
  return typeof value?.publicKey === 'string' && typeof value.privateKey === 'string' ? { publicKey: value.publicKey, privateKey: value.privateKey } : null;
}

/** Keeps the key; `null` throws it away, so the next subscription is made with a new one. */
export const savePushKey = (key: PushKey | null) => (key ? run('readwrite', (store) => store.put(key, PUSH_KEY)) : run('readwrite', (store) => store.delete(PUSH_KEY))).then(() => undefined);

/** The computer the phone showed last, so it opens there again. Not secret: localStorage. */
const CURRENT = 'switchboard-remote:computer';

export function lastComputer(): string | null {
  try {
    return localStorage.getItem(CURRENT);
  } catch {
    return null;
  }
}

export function rememberComputer(id: string): void {
  try {
    localStorage.setItem(CURRENT, id);
  } catch {
    // Private browsing without storage: it opens the computer paired last.
  }
}

/** The project this device last started a session in on a computer, so New session can start there again. Not secret: localStorage. */
const LAST_PROJECT = 'switchboard-remote:last-project';

export function lastProject(computer: string): string | null {
  try {
    return localStorage.getItem(`${LAST_PROJECT}:${computer}`) ?? localStorage.getItem(LAST_PROJECT);
  } catch {
    return null;
  }
}

export function rememberProject(computer: string, projectId: string): void {
  try {
    localStorage.setItem(`${LAST_PROJECT}:${computer}`, projectId);
  } catch {
    // Private browsing without storage: New session just suggests from the sessions.
  }
}

/** The computer New session last started on, with more than one paired, so it starts there again. Not secret: localStorage. */
const RUN_ON = 'switchboard-remote:run-on';

export function lastRunOn(): string | null {
  try {
    return localStorage.getItem(RUN_ON);
  } catch {
    return null;
  }
}

export function rememberRunOn(computer: string): void {
  try {
    localStorage.setItem(RUN_ON, computer);
  } catch {
    // Private browsing without storage: New session starts on the first connected computer.
  }
}
