import { useEffect, useState } from 'react';
import type { Computer, Contract, RemoteOptions, RpcClient } from '@seshboard/protocol/client';
import { ChoiceMenu } from '../newSession/ChoiceMenu.tsx';
import { PROFILE_DOT } from '../profiles/ProfileBadge.tsx';
import { callComputer } from './callComputer.ts';
import { remoteProfiles } from './remoteNewSession.ts';

/**
 * What the message box needs from another computer for its chips (New session there, and an open session there): its
 * lists from `options.get`, shown with the local chip row (`ComposerChipRow`), and its profiles, which aren't this
 * computer's, in a chip of their own.
 */

/** That computer's choices, or null while it hasn't answered or when its Seshboard is too old to have `options.get`. */
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

/**
 * The profile (login) a new session runs with on that computer, as the local profile chip: a dot in its colour and its
 * name, its list marking the project's own (or the default) and the tool another provider's runs with. With one
 * profile there is nothing to pick, and like the local chip it doesn't show.
 */
export function RemoteProfileChip({ options, computerName, value, projectProfileId, ownProfile, onPick, disabled }: { options: RemoteOptions; computerName: string; value: string; projectProfileId: string; ownProfile: boolean; onPick(profileId: string): void; disabled?: boolean }) {
  const profiles = remoteProfiles(options);
  if (profiles.length < 2) return null;
  const current = profiles.find((p) => p.id === value);
  const name = current?.name ?? 'Profile';
  return (
    <ChoiceMenu
      name="remote-profile"
      value={value}
      onChange={onPick}
      disabled={disabled}
      label={`Profile on ${computerName}: ${name}`}
      title={`Profile on ${computerName}: ${name}${current?.provider ? `, runs with ${current.provider.name}` : ''}`}
      heading={`Profile on ${computerName}`}
      placement="auto"
      width={260}
      choices={profiles.map((p) => ({
        value: p.id,
        label: p.id === projectProfileId ? `${p.name} (${ownProfile ? 'project' : 'default'})` : p.name,
        ...(p.provider ? { description: p.provider.name } : {}),
        dot: PROFILE_DOT[p.color],
      }))}
    >
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${current ? PROFILE_DOT[current.color] : 'bg-faint'}`} />
      <span data-remote-profile={value}>{name}</span>
    </ChoiceMenu>
  );
}
