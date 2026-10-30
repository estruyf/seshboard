import type { RemoteStatus, RemoteTunnel } from '@seshboard/protocol/client';
import { remoteAge, TUNNELS } from './remoteText.ts';

/**
 * The status card at the top of Settings › Remote: what Remote is doing, in one title and one line, and the fix for
 * each problem as its buttons. Pure, so every state is easy to check (remoteStatusView.test.ts).
 */

export type StatusTone = 'ok' | 'accent' | 'error' | 'caution';

export type StatusAction =
  | { kind: 'pair' }
  | { kind: 'install'; tunnel: RemoteTunnel; url: string }
  | { kind: 'use-cloudflare' }
  | { kind: 'use-port'; port: number }
  | { kind: 'change-port' }
  | { kind: 'change-connection' }
  | { kind: 'retry' }
  | { kind: 'details' }
  | { kind: 'reconnect' }
  | { kind: 'unblock' }
  | { kind: 'show-log' };

export interface StatusView {
  tone: StatusTone;
  title: string;
  detail: string;
  /** The address in a mono field with Copy, while it runs. */
  address: string | null;
  actions: Array<{ action: StatusAction; label: string; primary?: boolean }>;
  /** The full message Show details opens, when there is more than its first line. */
  details: string | null;
}

const tunnelName = (tunnel: RemoteTunnel) => TUNNELS.find((t) => t.id === tunnel)?.label ?? 'tunnel';
/** The tunnel in a sentence: "Starting the Cloudflare tunnel…", "Tailscale isn't running". */
const RUNNING_NAME: Record<RemoteTunnel, string> = { cloudflare: 'the Cloudflare tunnel', tailscale: 'Tailscale', ngrok: 'the ngrok tunnel', custom: 'your tunnel' };
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const firstLine = (text: string) => text.split('\n').find((line) => line.trim())?.trim() ?? text;

/** "Elio's iPhone", "A and B", "A, B and 2 more". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** The card for Remote while it is on; null while it is off (the page shows the steps or the "Remote is off" card). */
export function remoteStatusView(status: RemoteStatus, now = Date.now()): StatusView | null {
  if (!status.settings.enabled) return null;
  const { problem, tunnel, settings } = status;
  const base = { address: null, details: null };

  if (problem?.kind === 'tool-missing') {
    const info = TUNNELS.find((t) => t.id === problem.tunnel);
    const actions: StatusView['actions'] = [];
    if (info?.install) actions.push({ action: { kind: 'install', tunnel: problem.tunnel, url: info.install }, label: `Install ${info.tool}`, primary: true });
    if (problem.tunnel !== 'cloudflare') actions.push({ action: { kind: 'use-cloudflare' }, label: 'Use Cloudflare instead' });
    return { ...base, tone: 'caution', title: "Remote can't start", detail: `${info?.tool ?? 'The tunnel tool'} isn't installed on this computer.`, actions };
  }
  if (problem?.kind === 'port-in-use') {
    const actions: StatusView['actions'] = [];
    if (problem.suggestedPort) actions.push({ action: { kind: 'use-port', port: problem.suggestedPort }, label: `Use port ${problem.suggestedPort}`, primary: true });
    actions.push({ action: { kind: 'change-port' }, label: 'Change port…' });
    return { ...base, tone: 'error', title: `Port ${problem.port} is in use`, detail: 'Another app listens on it. Pick another port, or quit that app.', actions };
  }
  if (problem?.kind === 'failed') {
    const more = problem.message.trim() !== firstLine(problem.message);
    return {
      ...base,
      tone: 'error',
      title: "Remote can't start",
      detail: firstLine(problem.message),
      details: more ? problem.message : null,
      actions: [{ action: { kind: 'retry' }, label: 'Try again', primary: true }, ...(more ? [{ action: { kind: 'details' } as const, label: 'Show details' }] : [])],
    };
  }

  if (tunnel.state === 'starting' || tunnel.state === 'off') {
    return { ...base, tone: 'accent', title: `Starting ${RUNNING_NAME[settings.tunnel]}…`, detail: 'This takes a few seconds.', actions: [] };
  }
  if (tunnel.state === 'failed' || !status.address) {
    if (settings.tunnel === 'custom' && !settings.customUrl) {
      return { ...base, tone: 'caution', title: 'Add your address', detail: 'Add the https:// address your tunnel or proxy forwards to Remote.', actions: [{ action: { kind: 'change-connection' }, label: 'Change…', primary: true }] };
    }
    const message = tunnel.message ?? '';
    const more = message.trim() !== '' && message.trim() !== firstLine(message);
    return {
      ...base,
      tone: 'error',
      title: `${capitalize(RUNNING_NAME[settings.tunnel])} isn't running`,
      detail: message ? firstLine(message) : 'Seshboard tries again shortly.',
      details: more ? message : null,
      actions: [{ action: { kind: 'retry' }, label: 'Try again', primary: true }, ...(more ? [{ action: { kind: 'details' } as const, label: 'Show details' }] : [])],
    };
  }

  if (status.addressChanged) {
    return {
      tone: 'caution',
      title: 'Address changed',
      detail: "The quick tunnel restarted with a new address. Paired devices can't find it yet.",
      address: status.address,
      details: null,
      actions: [{ action: { kind: 'reconnect' }, label: 'Reconnect a paired device', primary: true }],
    };
  }

  if (status.blocked.length) {
    // Before the devices: a paired phone behind the same network waits too, and Unblock is the fix.
    const minutes = Math.max(1, Math.ceil((Math.max(...status.blocked.map((b) => b.until)) - now) / 60_000));
    const wait = `${minutes} more ${minutes === 1 ? 'minute' : 'minutes'}`;
    const [first] = status.blocked;
    const detail =
      status.blocked.length === 1 && first
        ? `${first.address} had ${first.attempts} refused attempts in a row and waits ${wait}. Devices on that network wait too.`
        : `${status.blocked.length} addresses had refused attempts in a row and wait up to ${wait}. Devices on those networks wait too.`;
    return {
      tone: 'caution',
      title: 'Turning connections away',
      detail,
      address: status.address,
      details: null,
      actions: [
        { action: { kind: 'unblock' }, label: 'Unblock', primary: true },
        { action: { kind: 'show-log' }, label: 'Show log' },
      ],
    };
  }

  const pair = { action: { kind: 'pair' } as const, label: 'Pair a device' };
  const connected = [...new Map(status.connections.map((c) => [c.deviceId, c.name])).values()];
  if (connected.length) {
    const count = `${connected.length} ${connected.length === 1 ? 'device' : 'devices'} connected`;
    const names = joinNames(connected);
    return { tone: 'ok', title: `Running · ${count}`, detail: `${names} ${connected.length === 1 ? 'is' : 'are'} connected now.`, address: status.address, details: null, actions: [pair] };
  }
  const last = Math.max(0, ...status.devices.map((d) => d.lastSeenAt ?? 0));
  const detail = !status.devices.length ? 'No device paired yet.' : last ? `No device connected. Last one ${remoteAge(last, now)}.` : 'No device connected yet.';
  return { tone: 'ok', title: 'Running', detail, address: status.address, details: null, actions: [{ ...pair, primary: !status.devices.length }] };
}

/** The connection row, folded: the tunnel's name and where it goes. */
export function connectionLine(status: RemoteStatus): { name: string; address: string } {
  const { settings } = status;
  const name = tunnelName(settings.tunnel);
  if (settings.tunnel === 'custom') return { name, address: settings.customUrl ? `${settings.customUrl} → 127.0.0.1:${settings.port}` : 'No address yet' };
  if (settings.tunnel === 'cloudflare' || (settings.tunnel === 'ngrok' && !settings.ngrokDomain)) return { name, address: 'Address changes each time it starts' };
  if (settings.tunnel === 'ngrok') return { name, address: `https://${settings.ngrokDomain}` };
  return { name, address: status.address ?? 'Your tailnet address' };
}

/** Whether the tunnel's address can change, so Reconnect a paired device can be needed. */
export const addressCanChange = (settings: RemoteStatus['settings']) => settings.tunnel === 'cloudflare' || (settings.tunnel === 'ngrok' && !settings.ngrokDomain);
