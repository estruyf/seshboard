import { create } from 'zustand';
import type { RemoteStatus } from '@seshboard/protocol/client';
import { actionOf, type FromDeviceEvent, type LastAction } from './connectedDevices.ts';
import { toast } from './toastStore.ts';

/** The sidebar's Connected to this Mac is open or folded per window, like the archived section. */
const OPEN_KEY = 'switchboard.connectedDevices.open';
/** The day the "connected" toast last showed, per device; this one is kept across restarts. */
const TOAST_DAYS_KEY = 'switchboard.connectedDevices.toastDays';

function readOpen(): boolean {
  try {
    return sessionStorage.getItem(OPEN_KEY) !== 'closed';
  } catch {
    return true;
  }
}

function writeOpen(open: boolean): void {
  try {
    sessionStorage.setItem(OPEN_KEY, open ? 'open' : 'closed');
  } catch {
    // Without storage it is only forgotten on reload.
  }
}

/** The day the "connected" toast last showed for this device, or null. */
export function toastDay(deviceId: string): string | null {
  try {
    const days: unknown = JSON.parse(localStorage.getItem(TOAST_DAYS_KEY) ?? '{}');
    const day = days && typeof days === 'object' ? (days as Record<string, unknown>)[deviceId] : null;
    return typeof day === 'string' ? day : null;
  } catch {
    return null;
  }
}

export function setToastDay(deviceId: string, day: string): void {
  try {
    const days: unknown = JSON.parse(localStorage.getItem(TOAST_DAYS_KEY) ?? '{}');
    localStorage.setItem(TOAST_DAYS_KEY, JSON.stringify({ ...(days && typeof days === 'object' ? days : {}), [deviceId]: day }));
  } catch {
    // Remembering is a convenience: at worst the toast shows once more.
  }
}

interface RemoteState {
  /** Remote's status from the engine (Settings › Remote and the sidebar); null until the first answer. */
  status: RemoteStatus | null;
  /** Why the status couldn't be read. */
  error: string | null;
  /** The last thing each device did, by device id, since the app started. */
  lastActions: ReadonlyMap<string, LastAction>;
  /** The sidebar's section is open (per window). */
  open: boolean;
  /** A device connected or left, for the sidebar's polite live region; cleared after a while. */
  announcement: string;
  setStatus(status: RemoteStatus): void;
  setError(error: string | null): void;
  /** The paired device each prompt sent from one came from (its name), by message uuid, for the prompt's tooltip. In memory only. */
  sentFrom: Map<string, string>;
  recordAction(event: FromDeviceEvent, at?: number): void;
  setOpen(open: boolean): void;
  announce(text: string): void;
}

let clearAnnouncement: ReturnType<typeof setTimeout> | undefined;

/** Remote's status for the whole window, filled by `useRemoteSync`: Settings › Remote and the sidebar read it. */
export const useRemote = create<RemoteState>()((set) => ({
  status: null,
  error: null,
  lastActions: new Map(),
  open: readOpen(),
  announcement: '',
  setStatus: (status) => set({ status, error: null }),
  setError: (error) => set({ error }),
  sentFrom: new Map(),
  recordAction: (event, at = Date.now()) =>
    set((s) => ({
      lastActions: new Map(s.lastActions).set(event.deviceId, actionOf(event, at)),
      ...(event.messageUuid && !event.requestId && event.device ? { sentFrom: new Map(s.sentFrom).set(event.messageUuid, event.device) } : {}),
    })),
  setOpen: (open) => {
    writeOpen(open);
    set({ open });
  },
  announce: (text) => {
    clearTimeout(clearAnnouncement);
    set({ announcement: text });
    // Cleared, so the same device coming back is announced again.
    clearAnnouncement = setTimeout(() => set({ announcement: '' }), 5_000);
  },
}));

type RevokeClient = { call(method: 'remote.revoke', params: { deviceId: string }): Promise<unknown> };

/** Revokes a device: it disconnects at once and has to pair again. Says so in a toast. */
export function revokeDevice(client: RevokeClient | null, device: { id: string; name: string }): void {
  if (!client) return;
  void client.call('remote.revoke', { deviceId: device.id }).then(
    () => toast(`${device.name} was revoked.`),
    (error: Error) => toast(`Couldn't revoke ${device.name}: ${error.message}`),
  );
}
