import { isRunRowId } from './runSelection.ts';

/**
 * Which session the main area shows: one of this computer's, or one on another computer (docs/remote-access.md, Other
 * computers). A remote session is always its computer and its id together, so its id never reaches code that expects
 * a local one (the panes, the hosts, the engine's session requests). Pure, so it can be tested.
 */

/** A session on another computer. */
export interface RemoteRef {
  computerId: string;
  sessionId: string;
}

export type SessionSelection = { kind: 'local'; sessionId: string } | ({ kind: 'remote' } & RemoteRef);

const PREFIX = 'remote:';

/**
 * The key of a remote session in lists that also hold local ones (the sidebar's rows, the palette's items). Local
 * session ids are UUIDs, so the prefix never collides with one.
 */
export const remoteRowId = (ref: RemoteRef): string => `${PREFIX}${ref.computerId}:${ref.sessionId}`;

export const isRemoteRowId = (id: string): boolean => id.startsWith(PREFIX);

/**
 * A pane's session as code for this computer's sessions takes it (the engine, the hosts, the terminal): its id, or null
 * for a session on another computer, which can be in a pane too.
 */
export const localSessionId = (id: string | null): string | null => (id !== null && !isRemoteRowId(id) && !isRunRowId(id) ? id : null);

/** The computer and session a remote row's key stands for; null for a local id or a key that isn't one. */
export function parseRemoteRowId(id: string): RemoteRef | null {
  if (!isRemoteRowId(id)) return null;
  const rest = id.slice(PREFIX.length);
  // Session ids never hold a colon; a computer id could, so the session is what follows the last one.
  const cut = rest.lastIndexOf(':');
  if (cut <= 0 || cut === rest.length - 1) return null;
  return { computerId: rest.slice(0, cut), sessionId: rest.slice(cut + 1) };
}

/** What a row of the sidebar opens: a local session by its id, a remote one by its computer and id. */
export function selectionOf(id: string): SessionSelection {
  const remote = parseRemoteRowId(id);
  return remote ? { kind: 'remote', ...remote } : { kind: 'local', sessionId: id };
}

export const sameRemote = (a: RemoteRef | null | undefined, b: RemoteRef | null | undefined): boolean =>
  !!a && !!b && a.computerId === b.computerId && a.sessionId === b.sessionId;
