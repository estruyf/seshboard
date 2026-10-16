import { ChevronRight, Globe, Monitor, Settings, Smartphone, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { currentPlatform } from '../../lib/platform.ts';
import {
  connectedRows,
  connectedSinceText,
  countLabel,
  lastActionParts,
  pairedText,
  remoteFooter,
  sectionTitle,
  sinceText,
  throughText,
  type ConnectedDevice,
  type DeviceKind,
  type RemoteFooter,
} from '../../state/connectedDevices.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { revokeDevice, useRemote } from '../../state/remoteStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { Button } from '../ui/Button.tsx';
import { Popover } from '../ui/Popover.tsx';
import { ConfirmStrip } from './RemoteRows.tsx';

/**
 * The sidebar's "Connected to this Mac" (docs/remote-access.md): while Remote is on, the phones, browsers and
 * computers connected right now, what each did last, and Revoke. Right above the Computers strip: this one is who
 * reaches into this computer, that one is where you reach out.
 */

const KIND_ICON: Record<DeviceKind, typeof Smartphone> = { phone: Smartphone, browser: Globe, computer: Monitor };
const POPOVER_WIDTH = 330;

const openRemoteSettings = () => useSessions.getState().openSettings('remote');
const revokeQuestion = (name: string) => `Revoke ${name}? It disconnects now and has to pair again.`;

function useClient() {
  const connection = useEngineConnection();
  return connection.status === 'connected' ? connection.client : null;
}

/** The section's state and its rows; the rows are recomputed only when the status or the actions change. */
function useConnectedDevices(): { footer: RemoteFooter; devices: ConnectedDevice[]; address: string | null } {
  const status = useRemote((s) => s.status);
  const lastActions = useRemote((s) => s.lastActions);
  const showIdle = usePreferences((s) => s.prefs.remoteIdleLine);
  const footer = remoteFooter(status, showIdle);
  const devices = useMemo(() => (status && footer === 'devices' ? connectedRows(status, lastActions) : []), [status, lastActions, footer]);
  return { footer, devices, address: status?.address ?? null };
}

/** Whether the sidebar shows anything for Remote, so the Computers strip under it can join it as one block. */
export function useRemoteFooterShown(): boolean {
  const status = useRemote((s) => s.status);
  const showIdle = usePreferences((s) => s.prefs.remoteIdleLine);
  return remoteFooter(status, showIdle) !== 'hidden';
}

/** A device's icon by its kind, with the green connected dot on its corner, ringed in the surface's colour. */
function DeviceIcon({ kind, size = 14, ring = 'ring-sidebar' }: { kind: DeviceKind; size?: number; ring?: string }) {
  const Icon = KIND_ICON[kind];
  return (
    <span className="relative flex shrink-0 text-muted" aria-hidden>
      <Icon size={size} />
      <span className={`absolute -right-0.5 -bottom-0.5 size-[7px] rounded-full bg-ok ring-2 ${ring}`} />
    </span>
  );
}

/** The gear that opens Settings › Remote. */
function SettingsGear() {
  return <Button variant="quiet" size="sm" iconOnly icon={<Settings size={13} aria-hidden />} aria-label="Remote settings" onClick={openRemoteSettings} className="ml-auto" data-connected-devices-settings />;
}

export function ConnectedDevices() {
  const client = useClient();
  const { footer, devices, address } = useConnectedDevices();
  const open = useRemote((s) => s.open);
  const [details, setDetails] = useState<{ id: string; x: number; y: number } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement | null>());
  const revokeButtons = useRef(new Map<string, HTMLButtonElement | null>());
  const title = sectionTitle(currentPlatform());

  if (footer === 'hidden') return null;
  const frame = 'shrink-0 border-t border-border px-3 pt-1.5 pb-1';

  if (footer === 'problem') {
    return (
      <section role="region" aria-label={title} className={`${frame} flex items-center gap-1`} data-connected-devices="problem">
        <button type="button" onClick={openRemoteSettings} className="flex h-6 min-w-0 items-center gap-1.5 rounded-md px-0.5 text-meta font-medium text-caution hover:underline" data-remote-problem>
          <TriangleAlert size={13} aria-hidden className="shrink-0" />
          <span className="truncate">Remote can't start</span>
        </button>
        <SettingsGear />
      </section>
    );
  }

  if (footer === 'idle') {
    return (
      <section role="region" aria-label={title} className={`${frame} flex items-center gap-1.5 text-meta text-faint`} data-connected-devices="idle">
        <Globe size={13} aria-hidden className="ml-0.5 shrink-0" />
        <span className="min-w-0 truncate">Remote on · nobody connected</span>
        <SettingsGear />
      </section>
    );
  }

  const shown = details ? devices.find((d) => d.id === details.id) : undefined;
  const toggle = () => useRemote.getState().setOpen(!open);
  const openDetails = (device: ConnectedDevice) => {
    const row = rowButtons.current.get(device.id);
    // To the right of the sidebar, level with the row (the button ends where the time starts).
    const right = row?.closest('[data-connected-devices]')?.getBoundingClientRect().right;
    const top = row?.getBoundingClientRect().top;
    if (right === undefined || top === undefined) return;
    setDetails((current) => (current?.id === device.id ? null : { id: device.id, x: right + 8, y: top - 8 }));
  };
  const closeDetails = () => {
    const id = details?.id;
    setDetails(null);
    if (id) rowButtons.current.get(id)?.focus();
  };
  // ↑ and ↓ move between the rows.
  const onRowKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const next = devices[index + (event.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    rowButtons.current.get(next.id)?.focus();
  };

  return (
    <section role="region" aria-label={title} className={frame} data-connected-devices="devices">
      <div className="flex h-6 items-center gap-1">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={`${title}, ${countLabel(devices.length)}`}
          className="flex h-6 min-w-0 items-center gap-1.5 rounded-md pr-1 text-meta font-medium text-faint hover:text-muted"
          data-connected-devices-toggle
        >
          <ChevronRight size={12} aria-hidden className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
          <span className="truncate">{title}</span>
          <span aria-hidden className="flex shrink-0 items-center gap-1 font-semibold text-ok tabular-nums">
            <span className="size-1.5 rounded-full bg-ok" />
            {devices.length}
          </span>
        </button>
        <SettingsGear />
      </div>
      {open && (
        <ul className="grid pb-0.5" aria-label={countLabel(devices.length)}>
          {devices.map((device, index) => {
            const confirmOpen = confirming === device.id;
            return (
              <li key={device.id} className="group/device grid" data-connected-device={device.id}>
                <div className="relative flex h-7.5 items-center rounded-md group-hover/device:bg-border/45 has-focus-visible:bg-border/45">
                  <button
                    ref={(el) => void rowButtons.current.set(device.id, el)}
                    type="button"
                    onClick={() => openDetails(device)}
                    onKeyDown={(event) => onRowKey(event, index)}
                    aria-haspopup="dialog"
                    aria-expanded={details?.id === device.id}
                    aria-label={`${device.name}, ${connectedSinceText(device.since)}`}
                    className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pl-1.5 text-left text-ui text-text outline-offset-[-2px]"
                    data-device-row
                  >
                    <DeviceIcon kind={device.kind} />
                    <span className="min-w-0 truncate">{device.name}</span>
                  </button>
                  {/* The time, swapped for Revoke on hover or keyboard focus; Revoke stays focusable, so Tab reaches it. */}
                  <span aria-hidden className={`shrink-0 pr-1.5 pl-2 text-meta text-faint group-hover/device:invisible group-focus-within/device:invisible ${confirmOpen ? 'invisible' : ''}`}>
                    {sinceText(device.since)}
                  </span>
                  <Button
                    ref={(el) => void revokeButtons.current.set(device.id, el)}
                    size="sm"
                    variant="danger"
                    aria-label={`Revoke ${device.name}`}
                    aria-expanded={confirmOpen}
                    onClick={() => setConfirming(confirmOpen ? null : device.id)}
                    className={`absolute right-0.5 opacity-0 group-hover/device:opacity-100 group-focus-within/device:opacity-100 focus-visible:opacity-100 ${confirmOpen ? 'opacity-100' : ''}`}
                    data-device-revoke
                  >
                    Revoke
                  </Button>
                </div>
                {confirmOpen && (
                  <ConfirmStrip
                    boxed
                    question={revokeQuestion(device.name)}
                    action="Revoke"
                    returnTo={{ current: revokeButtons.current.get(device.id) ?? null }}
                    onCancel={() => setConfirming(null)}
                    onConfirm={() => {
                      setConfirming(null);
                      revokeDevice(client, device);
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {details && shown && (
        <DevicesPopover
          devices={[shown]}
          address={address}
          at={details}
          anchor={{ current: rowButtons.current.get(shown.id) ?? null }}
          onClose={closeDetails}
          onRevoke={(device) => {
            setDetails(null);
            setConfirming(device.id);
          }}
        />
      )}
    </section>
  );
}

/** A session's title for the last action, as the sidebar shows it. */
function useSessionTitle(sessionId: string | null): string | null {
  return useSessions((s) => {
    if (!sessionId) return null;
    const summary = s.sessions.get(sessionId);
    const live = s.live.get(sessionId);
    return (live?.name && !summary?.customTitle ? live.name : summary?.title) ?? live?.name ?? null;
  });
}

function LastAction({ device, onOpen }: { device: ConnectedDevice; onOpen(): void }) {
  const action = device.lastAction;
  const title = useSessionTitle(action?.sessionId ?? null);
  if (!action) return <span className="text-muted">No actions yet</span>;
  const { lead, age } = lastActionParts(action);
  return (
    <span data-device-last-action>
      {lead}{' '}
      <button
        type="button"
        onClick={() => {
          useSessions.getState().select(action.sessionId);
          onOpen();
        }}
        className="rounded text-left font-semibold text-text hover:underline"
        data-device-session
      >
        {title ?? 'a session'}
      </button>
      <span className="text-muted"> · {age}</span>
    </span>
  );
}

/** One device's details: icon, name, connected since, last action, paired, and the address it came through. */
function DeviceDetails({ device, address, onOpenSession, revoke }: { device: ConnectedDevice; address: string | null; onOpenSession(): void; revoke?: ReactNode }) {
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-edge bg-bg">
          <DeviceIcon kind={device.kind} size={16} ring="ring-bg" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui font-semibold">{device.name}</span>
          <span className="flex items-center gap-1.5 text-meta text-ok">
            <span aria-hidden className="size-1.5 rounded-full bg-ok" />
            {connectedSinceText(device.since)}
          </span>
        </span>
        {revoke}
      </div>
      <dl className="grid grid-cols-[80px_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-edge pt-3 text-ui">
        <dt className="text-muted">Last action</dt>
        <dd>
          <LastAction device={device} onOpen={onOpenSession} />
        </dd>
        <dt className="text-muted">Paired</dt>
        <dd>{pairedText(device.createdAt)}</dd>
        {address && (
          <>
            <dt className="text-muted">Through</dt>
            <dd className="truncate font-mono text-meta leading-5" data-tooltip={address}>
              {throughText(address)}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

/**
 * The details popover, to the right of a row (or of the rail's icon, for the whole list). Esc and a click outside
 * close it. With one device its footer has Remote settings and Revoke…; with more, each has its own Revoke….
 * `onRevoke` asks first somewhere else (the row's confirm); without it, the confirm opens here.
 */
function DevicesPopover({
  devices,
  address,
  at,
  anchor,
  onClose,
  onRevoke,
}: {
  devices: ConnectedDevice[];
  address: string | null;
  at: { x: number; y: number };
  anchor: RefObject<HTMLElement | null>;
  onClose(): void;
  onRevoke?: (device: ConnectedDevice) => void;
}) {
  const client = useClient();
  const body = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const revokeButtons = useRef(new Map<string, HTMLButtonElement | null>());
  useEffect(() => body.current?.focus(), []);
  const single = devices.length === 1;

  const revokeButton = (device: ConnectedDevice) => (
    <Button
      ref={(el) => void revokeButtons.current.set(device.id, el)}
      size="sm"
      variant="danger"
      aria-label={`Revoke ${device.name}`}
      aria-expanded={confirming === device.id}
      onClick={() => (onRevoke ? onRevoke(device) : setConfirming(device.id))}
      data-device-details-revoke
    >
      Revoke…
    </Button>
  );

  return (
    <Popover
      x={at.x}
      y={at.y}
      width={POPOVER_WIDTH}
      onClose={onClose}
      anchor={anchor}
      role="dialog"
      aria-label={single ? devices[0]!.name : sectionTitle(currentPlatform())}
      className="py-0"
      data-device-details
    >
      <div ref={body} tabIndex={-1} className="grid gap-3 p-3.5 outline-none">
        {devices.map((device, index) => (
          <div key={device.id} className={`grid gap-2 ${index > 0 ? 'border-t border-edge pt-3' : ''}`} data-device-details-item={device.id}>
            <DeviceDetails device={device} address={address} onOpenSession={onClose} revoke={single ? undefined : revokeButton(device)} />
            {confirming === device.id && (
              <ConfirmStrip
                boxed
                question={revokeQuestion(device.name)}
                action="Revoke"
                returnTo={{ current: revokeButtons.current.get(device.id) ?? null }}
                onCancel={() => setConfirming(null)}
                onConfirm={() => {
                  setConfirming(null);
                  revokeDevice(client, device);
                }}
              />
            )}
          </div>
        ))}
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="quiet"
            size="sm"
            onClick={() => {
              onClose();
              openRemoteSettings();
            }}
            data-device-settings
          >
            Remote settings
          </Button>
          {single && revokeButton(devices[0]!)}
        </div>
      </div>
    </Popover>
  );
}

/**
 * The rail's device icon, above its other buttons: shows while devices are connected, with the count in a green
 * badge. Hover lists their names; a click opens the details of each, with Revoke per device.
 */
export function RailDevices() {
  const { footer, devices, address } = useConnectedDevices();
  const button = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  // Everyone left while it was open.
  useEffect(() => {
    if (!devices.length) setAt(null);
  }, [devices.length]);
  if (footer !== 'devices' || !devices.length) return null;
  const title = sectionTitle(currentPlatform());
  const names = devices.map((d) => d.name).join(', ');
  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => {
          const rect = button.current?.getBoundingClientRect();
          if (rect) setAt((open) => (open ? null : { x: rect.right + 8, y: rect.top - 8 }));
        }}
        aria-haspopup="dialog"
        aria-expanded={at !== null}
        aria-label={`${title}, ${countLabel(devices.length)}: ${names}`}
        data-tooltip={names}
        data-tooltip-placement="right"
        data-tooltip-title={title}
        data-tooltip-meta={names}
        data-tooltip-status={countLabel(devices.length)}
        data-tooltip-tone="ok"
        data-tooltip-hint="Click to see what they did"
        className="relative flex size-8 items-center justify-center rounded-lg text-muted hover:bg-border/50 hover:text-text"
        data-rail-devices={devices.length}
      >
        <Smartphone size={16} aria-hidden />
        <span aria-hidden className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-ok px-1 text-[10px] leading-none font-semibold text-bg tabular-nums ring-2 ring-sidebar">
          {devices.length}
        </span>
      </button>
      {at && <DevicesPopover devices={devices} address={address} at={at} anchor={button} onClose={() => (setAt(null), button.current?.focus())} />}
    </>
  );
}

/** The sidebar's polite live region: a device connecting or leaving. */
export function useDeviceAnnouncement(): string {
  return useRemote((s) => s.announcement);
}
