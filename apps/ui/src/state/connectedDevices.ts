import { safeLocale, type RemoteStatus } from '@seshboard/protocol/client';
import { agoText } from '../lib/format.ts';
import { remoteAge } from '../components/remote/remoteText.ts';

/**
 * The sidebar's "Connected to this Mac" (docs/remote-access.md): the devices connected right now, from Remote's
 * status, with what each did last. Pure, so the joining and the wording are easy to check.
 */

export type DeviceKind = RemoteStatus['devices'][number]['kind'];

/** The last prompt or answer a device sent, from `remote.fromDevice`. Kept in memory only, until the app restarts. */
export interface LastAction {
  sessionId: string;
  /** A prompt (or a new session's first one), or an answer to a permission prompt, a question or a plan. */
  kind: 'prompt' | 'answer';
  /** For an answer: the tool it was about and whether it was allowed. */
  answer: { toolName: string; allowed: boolean } | null;
  at: number;
}

/** One row: a paired device with at least one open connection. */
export interface ConnectedDevice {
  id: string;
  name: string;
  kind: DeviceKind;
  /** Its earliest open connection (two tabs are one device). */
  since: number;
  /** When it was paired. */
  createdAt: number;
  lastAction: LastAction | null;
}

/** What `remote.fromDevice` carries, as far as the last action needs it. */
export interface FromDeviceEvent {
  sessionId: string;
  requestId: string | null;
  deviceId: string;
  /** The prompt's message, for a prompt; and the device's name. */
  messageUuid?: string | null;
  device?: string;
  answer?: { toolName: string; allowed: boolean } | null;
}

export const actionOf = (event: FromDeviceEvent, at: number): LastAction => ({
  sessionId: event.sessionId,
  kind: event.requestId ? 'answer' : 'prompt',
  answer: event.requestId ? (event.answer ?? null) : null,
  at,
});

/**
 * The connected devices: `connections` joined with `devices` for the kind and the pairing date, one row per device
 * with its earliest `since`, the first to connect first. A connection whose device isn't listed (revoked a moment
 * ago) is left out.
 */
export function connectedRows(status: Pick<RemoteStatus, 'devices' | 'connections'>, lastActions: ReadonlyMap<string, LastAction> = new Map()): ConnectedDevice[] {
  const since = new Map<string, number>();
  for (const connection of status.connections) {
    const before = since.get(connection.deviceId);
    if (before === undefined || connection.since < before) since.set(connection.deviceId, connection.since);
  }
  const rows: ConnectedDevice[] = [];
  for (const device of status.devices) {
    const at = since.get(device.id);
    if (at === undefined) continue;
    rows.push({ id: device.id, name: device.name, kind: device.kind, since: at, createdAt: device.createdAt, lastAction: lastActions.get(device.id) ?? null });
  }
  return rows.sort((a, b) => a.since - b.since || a.name.localeCompare(b.name));
}

/** What the bottom of the sidebar shows for Remote. */
export type RemoteFooter = 'hidden' | 'problem' | 'idle' | 'devices';

/**
 * Nothing while Remote is off; "Remote can't start" when it has a problem; the section while a device is connected;
 * otherwise the quiet "nobody connected" line, unless Settings › Remote hides it.
 */
export function remoteFooter(status: RemoteStatus | null, showIdle: boolean): RemoteFooter {
  if (!status?.available || !status.settings.enabled) return 'hidden';
  if (status.problem) return 'problem';
  if (status.connections.some((c) => status.devices.some((d) => d.id === c.deviceId))) return 'devices';
  return showIdle ? 'idle' : 'hidden';
}

/** "Connected to this Mac", or "this PC" on Windows. */
export const sectionTitle = (platform: string) => `Connected to this ${platform === 'darwin' ? 'Mac' : 'PC'}`;

/** The header's count, as screen readers hear it: "2 devices connected". */
export const countLabel = (count: number) => `${count} ${count === 1 ? 'device' : 'devices'} connected`;

const clock = (at: number, locale?: string) => new Date(at).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });

/** "since 14:02" today, "since yesterday 22:10", or "since 12 Oct" further back, in the user's time format. */
export function sinceText(since: number, now = Date.now(), locale?: string): string {
  locale = safeLocale(locale);
  const day = new Date(since).toDateString();
  if (day === new Date(now).toDateString()) return `since ${clock(since, locale)}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === yesterday.toDateString()) return `since yesterday ${clock(since, locale)}`;
  const sameYear = new Date(since).getFullYear() === new Date(now).getFullYear();
  return `since ${new Date(since).toLocaleDateString(locale, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

/** The popover's first line: "Connected since 14:02". */
export const connectedSinceText = (since: number, now = Date.now(), locale?: string) => `Connected ${sinceText(since, now, locale)}`;

/** The popover's Paired line: "3 days ago". */
export const pairedText = (createdAt: number, now = Date.now()) => remoteAge(createdAt, now);

/** What was answered: "Allow Bash", "a question", "a plan". */
function answerLabel(answer: LastAction['answer']): string {
  if (!answer) return 'a prompt';
  if (answer.toolName === 'AskUserQuestion') return 'a question';
  if (answer.toolName === 'ExitPlanMode') return 'a plan';
  return `${answer.allowed ? 'Allow' : 'Deny'} ${answer.toolName}`;
}

/**
 * The last action in parts, so the session's name can be a link: "Sent a prompt in" + "Needs review sort" + "4m ago",
 * or "Answered Allow Bash in" + "tideline" + "2m ago".
 */
export function lastActionParts(action: LastAction, now = Date.now()): { lead: string; age: string } {
  const lead = action.kind === 'prompt' ? 'Sent a prompt in' : `Answered ${answerLabel(action.answer)} in`;
  const age = agoText(action.at, now);
  return { lead, age: age === 'now' ? 'just now' : age };
}

/** The last action as one line: "Sent a prompt in Needs review sort · 4m ago", or "No actions yet". */
export function lastActionText(action: LastAction | null, sessionTitle: string, now = Date.now()): string {
  if (!action) return 'No actions yet';
  const { lead, age } = lastActionParts(action, now);
  return `${lead} ${sessionTitle} · ${age}`;
}

/** Which devices came and went between two lists (none on the first one, which is how things were at startup). */
export function connectionChanges(before: readonly ConnectedDevice[] | null, after: readonly ConnectedDevice[]): { joined: ConnectedDevice[]; left: ConnectedDevice[] } {
  if (!before) return { joined: [], left: [] };
  const was = new Set(before.map((d) => d.id));
  const is = new Set(after.map((d) => d.id));
  return { joined: after.filter((d) => !was.has(d.id)), left: before.filter((d) => !is.has(d.id)) };
}

/** For the sidebar's polite live region: "Elio's iPhone connected. Safari on MacBook Air disconnected." */
export function connectionAnnouncement(changes: { joined: readonly ConnectedDevice[]; left: readonly ConnectedDevice[] }): string {
  return [...changes.joined.map((d) => `${d.name} connected.`), ...changes.left.map((d) => `${d.name} disconnected.`)].join(' ');
}

/** A device paired this recently connects without a toast: you just allowed it. */
export const JUST_PAIRED_MS = 5 * 60_000;

/** The local day, as the toast rule keeps it: "2026-10-15". */
export function dayKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The "connected" toast: once per device per day (`lastDay` is when it last showed), and never right after pairing. */
export function connectToastDue(device: Pick<ConnectedDevice, 'createdAt'>, lastDay: string | null, now = Date.now()): boolean {
  if (now - device.createdAt < JUST_PAIRED_MS) return false;
  return lastDay !== dayKey(now);
}

/** The address a device connected through, without the scheme: "remote.example.com". */
export const throughText = (address: string) => address.replace(/^[a-z]+:\/\//i, '').replace(/\/$/, '');
