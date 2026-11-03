/**
 * Which trigger started a session or a pipeline run (#180), as another device sees it (`RemoteSession.trigger`,
 * `RemoteRun.trigger`): the bolt on its row and the "Started by …" line under its header. Without zod, for the app's
 * windows and the remote app.
 */
export interface RemoteTriggerOrigin {
  /** The trigger's name when it started ("CI fails on main"). */
  name: string;
  kind: 'ci' | 'issue';
  /** "CI #4512" or "#212". */
  ref: string;
  /** The CI run or the issue on GitHub. */
  url: string;
  at: number;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A trigger origin another computer sent, when it can be read; null otherwise, so a session with one this version
 * can't read still shows, without its bolt. A link is kept only when it goes to an `https://` page.
 */
export function triggerOriginOf(value: unknown): RemoteTriggerOrigin | null {
  if (!isObject(value)) return null;
  const { name, kind, ref, url, at } = value;
  if (typeof name !== 'string' || typeof ref !== 'string' || typeof url !== 'string' || typeof at !== 'number') return null;
  if (kind !== 'ci' && kind !== 'issue') return null;
  return { name: name.trim() || 'a trigger', kind, ref, url: /^https:\/\//i.test(url) ? url : '', at };
}
