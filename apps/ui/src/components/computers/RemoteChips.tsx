import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { AUTO_MODEL, type Computer, type Contract, type Effort, type PermissionMode, type RemoteOptions, type RemotePermissionMode, type RpcClient } from '@switchboard/protocol/client';
import { autoDescription } from '../../lib/autoModel.ts';
import { MODE_DOT, MODE_LABEL } from '../../lib/modes.ts';
import { AutoWand } from '../composer/ComposerChips.tsx';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { EFFORT_LABEL, MODE_DESCRIPTION } from '../newSession/route.ts';
import { PROFILE_DOT } from '../profiles/ProfileBadge.tsx';
import { callComputer } from './callComputer.ts';
import { remoteModelLabel, remoteProfiles } from './remoteNewSession.ts';

/**
 * The message box's chips for a session on another computer (New session there, and an open session there): profile,
 * model, effort and mode, with that computer's lists from `options.get`. Worded as the local chips and the remote app.
 */

/** That computer's choices, or null while it hasn't answered or when its Switchboard is too old to have `options.get`. */
export function useRemoteOptions(client: RpcClient<Contract> | null, computer: Computer): RemoteOptions | null {
  const [options, setOptions] = useState<RemoteOptions | null>(null);
  const connected = computer.state === 'connected';
  useEffect(() => {
    if (!client || !connected) return;
    let current = true;
    void callComputer(client, computer.id, 'options.get', {}).then(
      (result) => current && setOptions(result),
      () => current && setOptions(null),
    );
    return () => {
      current = false;
    };
  }, [client, computer.id, connected]);
  return options;
}

/** A quiet chip that opens a menu of choices, like the message box's chips: it shows the value, its label says what it is. */
export function ChipMenu({ label, value, entries, icon, disabled, ...rest }: { label: string; value: ReactNode; entries: MenuEntry[]; icon?: ReactNode; disabled?: boolean; [data: `data-${string}`]: unknown }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-haspopup="menu"
        aria-expanded={at !== null}
        aria-label={label}
        data-tooltip={label}
        disabled={disabled}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setAt(at ? null : { x: rect.left, y: rect.top - 4 });
        }}
        className="flex h-7 min-w-0 shrink items-center gap-1.5 rounded-md px-1.5 text-ui text-muted hover:bg-border/50 hover:text-text disabled:pointer-events-none disabled:opacity-60"
        {...rest}
      >
        {icon}
        <span className="truncate">{value}</span>
        <ChevronDown size={12} className="shrink-0 text-faint" aria-hidden />
      </button>
      {at && <Menu x={at.x} y={at.y} above entries={entries} anchor={ref} label={label} onClose={() => setAt(null)} />}
    </>
  );
}

const Dot = ({ className }: { className: string }) => <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${className}`} />;

/**
 * The Claude profile (login) a new session runs with on that computer. With one profile there is nothing to pick: it
 * says whose profile it is. `projectProfileId` is marked in the list as the project's own, or the default.
 */
export function RemoteProfileChip({ options, computerName, value, projectProfileId, ownProfile, onPick }: { options: RemoteOptions; computerName: string; value: string; projectProfileId: string; ownProfile: boolean; onPick(profileId: string): void }) {
  const profiles = remoteProfiles(options);
  if (profiles.length < 2) {
    return (
      <span className="flex items-center gap-1.5 px-1.5 text-ui text-muted" data-tooltip={`Claude runs with ${computerName}’s Claude profile`}>
        <Dot className="bg-ok" />
        {computerName}’s profile
      </span>
    );
  }
  const current = profiles.find((p) => p.id === value);
  return (
    <ChipMenu
      label={`Claude profile on ${computerName}: ${current?.name ?? 'Profile'}`}
      value={current?.name ?? 'Profile'}
      icon={<Dot className={current ? PROFILE_DOT[current.color] : 'bg-faint'} />}
      entries={profiles.map((p) => ({
        label: p.id === projectProfileId ? `${p.name} (${ownProfile ? 'project' : 'default'})` : p.name,
        icon: <Dot className={PROFILE_DOT[p.color]} />,
        checked: p.id === value,
        data: { 'data-remote-profile-option': p.id },
        onSelect: () => onPick(p.id),
      }))}
      data-remote-profile={value}
    />
  );
}

/**
 * The model. New session offers Auto first while it is on there (`offerAuto`). A running session's chip says what Auto
 * picked (`autoFace`) until you pick a model yourself; Auto isn't in its list, because it only picks when a session starts.
 */
export function RemoteModelChip({ options, value, onPick, offerAuto = false, autoFace = null, disabled }: { options: RemoteOptions; value: string | null; onPick(model: string | null): void; offerAuto?: boolean; autoFace?: string | null; disabled?: boolean }) {
  // The list's own "default" stands for no model chosen.
  const listDefault = options.models.some((m) => m.value === 'default');
  const known = value === null || options.models.some((m) => m.value === value) || (offerAuto && value === AUTO_MODEL);
  const isDefault = (m: string) => m === 'default';
  const face = autoFace ?? remoteModelLabel(options.models, value);
  const entries: MenuEntry[] = [
    ...(offerAuto ? [{ label: 'Auto', detail: autoDescription(options.auto?.allowed ?? []), icon: <AutoWand />, checked: value === AUTO_MODEL, onSelect: () => onPick(AUTO_MODEL) }, 'separator' as const] : []),
    ...(listDefault ? [] : [{ label: 'Default model', detail: 'What Switchboard starts sessions with', checked: value === null, onSelect: () => onPick(null) }]),
    ...(known ? [] : [{ label: remoteModelLabel(options.models, value), checked: true, onSelect: () => onPick(value) }]),
    ...options.models.map((m) => ({
      label: m.displayName,
      detail: m.description || undefined,
      checked: isDefault(m.value) ? value === null : value === m.value,
      onSelect: () => onPick(isDefault(m.value) ? null : m.value),
    })),
  ];
  return <ChipMenu label={`Model: ${face}`} value={face} icon={autoFace || value === AUTO_MODEL ? <AutoWand /> : undefined} entries={entries} disabled={disabled} data-remote-model />;
}

export function RemoteEffortChip({ options, value, onPick, disabled }: { options: RemoteOptions; value: Effort | null; onPick(effort: Effort | null): void; disabled?: boolean }) {
  const face = value ? EFFORT_LABEL[value] : 'Default';
  return (
    <ChipMenu
      label={`Effort: ${face}`}
      value={value ? face : 'Default effort'}
      entries={[{ label: 'Default', detail: "The model's own", checked: value === null, onSelect: () => onPick(null) }, ...options.efforts.map((e) => ({ label: EFFORT_LABEL[e], checked: value === e, onSelect: () => onPick(e) }))]}
      disabled={disabled}
      data-remote-effort
    />
  );
}

/** The permission mode: only the ones a remote device may pick, plus the current one when that computer set another (bypass). */
export function RemoteModeChip({ options, value, onPick, disabled }: { options: RemoteOptions; value: PermissionMode; onPick(mode: RemotePermissionMode): void; disabled?: boolean }) {
  const modes: PermissionMode[] = [...new Set<PermissionMode>([...options.modes, value])];
  return (
    <ChipMenu
      label={`Mode: ${MODE_LABEL[value]}`}
      value={MODE_LABEL[value]}
      icon={<Dot className={MODE_DOT[value] ?? 'bg-faint'} />}
      entries={modes.map((m) => ({
        label: MODE_LABEL[m],
        detail: MODE_DESCRIPTION[m],
        icon: <Dot className={MODE_DOT[m] ?? 'bg-faint'} />,
        checked: m === value,
        disabled: !(options.modes as PermissionMode[]).includes(m),
        onSelect: () => onPick(m as RemotePermissionMode),
      }))}
      disabled={disabled}
      data-remote-mode
    />
  );
}
