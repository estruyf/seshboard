/**
 * Guards against starting the same engine call twice (a double click, a second shortcut while the first
 * one still runs). Claim the keys before the call and release them when it settles; a claim that finds
 * one of its keys taken gets nothing, and the click is ignored.
 */

/** Takes every key, or none when one of them is already in flight. Returns whether it took them. */
export function claim<K>(pending: Set<K>, keys: readonly K[]): boolean {
  if (keys.some((key) => pending.has(key))) return false;
  for (const key of keys) pending.add(key);
  return true;
}

/** Gives the keys back once the call has settled. */
export function release<K>(pending: Set<K>, keys: readonly K[]): void {
  for (const key of keys) pending.delete(key);
}

/**
 * Runs `work` unless `key` is already in flight, holding the key until it settles. Returns undefined, without
 * running it, when the key was taken.
 */
export async function runOnce<K, T>(pending: Set<K>, key: K, work: () => Promise<T>): Promise<T | undefined> {
  if (!claim(pending, [key])) return undefined;
  try {
    return await work();
  } finally {
    release(pending, [key]);
  }
}
