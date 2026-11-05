import type { RemoteAppUpdate } from './remote.ts';

/**
 * Updating Seshboard on another paired computer from here (`REMOTE_FEATURE_UPDATE`, docs/remote-access.md): which
 * version it can update to, from what it found itself or what this Mac knows, and how an update asked from here went.
 * Plain TypeScript, for the engine and the windows.
 */

/** `X.Y.Z` with an optional `-pre.N` part, which sorts before the release; null when it isn't one. */
function parse(version: string): { parts: [number, number, number]; pre: string[] | null } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/.exec(version.trim());
  return match ? { parts: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ? match[4].split('.') : null } : null;
}

/** Whether `version` reads as one (`1.3.0`, `1.3.0-beta.19`); a development build's `demo` or `dev` doesn't. */
export const isVersion = (version: string): boolean => parse(version) !== null;

/**
 * Negative when `a` is older than `b`, positive when newer, 0 when equal or either can't be read. Pre-release parts
 * compare as numbers where both are (`beta.9` before `beta.19`).
 */
export function compareVersions(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.parts[i] !== y.parts[i]) return x.parts[i]! - y.parts[i]!;
  if (!x.pre || !y.pre) return x.pre ? -1 : y.pre ? 1 : 0;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const [p, q] = [x.pre[i], y.pre[i]];
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    if (p === q) continue;
    const [m, n] = [Number(p), Number(q)];
    if (Number.isInteger(m) && Number.isInteger(n)) return m - n;
    return p < q ? -1 : 1;
  }
  return 0;
}

/** `1.2.3-beta.1` is on the beta channel; anything else is stable. */
export function channelOf(version: string): 'stable' | 'beta' {
  return /-beta\./.test(version) ? 'beta' : 'stable';
}

/** What a computer's row says about its version. */
export type RemoteUpdate =
  | { kind: 'none' }
  /** It can update to `version`: found by its own updater (`there`), or known only here (`here`). */
  | { kind: 'behind'; version: string; source: 'there' | 'here' }
  /** It runs a newer version than this one, on a channel this one gets. */
  | { kind: 'ahead'; version: string };

/**
 * The newest version either side knows that a computer can update to. `computer` is the other one (its version from
 * `hello`, its updater); `here` is this one's own updater (`UpdateState`). A beta known here counts only for a
 * computer on the Beta channel; "ahead" only when this one would get that version too.
 */
export function remoteUpdateFor(
  computer: { version: string | null; update: Pick<RemoteAppUpdate, 'availableVersion' | 'downloadedVersion' | 'channel'> | null },
  here: { version: string; availableVersion: string | null; channel: 'stable' | 'beta' },
): RemoteUpdate {
  const current = computer.version;
  if (!current || !isVersion(current)) return { kind: 'none' };
  const theirChannel = computer.update?.channel ?? channelOf(current);
  const newer = (version: string | null | undefined): version is string => !!version && isVersion(version) && compareVersions(version, current) > 0;
  const newest = (versions: string[]) => versions.sort((a, b) => compareVersions(b, a))[0];
  const there = newest([computer.update?.downloadedVersion, computer.update?.availableVersion].filter(newer));
  const known = newest([here.availableVersion, here.version].filter(newer).filter((v) => theirChannel === 'beta' || channelOf(v) === 'stable'));
  if (there && (!known || compareVersions(there, known) >= 0)) return { kind: 'behind', version: there, source: 'there' };
  if (known) return { kind: 'behind', version: known, source: 'here' };
  if (isVersion(here.version) && compareVersions(current, here.version) > 0 && (here.channel === 'beta' || channelOf(current) === 'stable')) return { kind: 'ahead', version: current };
  return { kind: 'none' };
}

/** A check or an update this computer asked another one for, until it knows how it went. */
export interface UpdateAsk {
  kind: 'check' | 'install';
  /** The version that was running there when it asked. */
  from: string;
  /** The version the row offered (Update to …), for "didn't find it"; null for a check. */
  version: string | null;
  at: number;
}

/** An ask older than this is forgotten: an update that takes longer has failed in a way nobody is waiting on. */
export const UPDATE_ASK_MAX_AGE_MS = 30 * 60_000;
