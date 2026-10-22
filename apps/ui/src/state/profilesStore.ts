import { useEffect } from 'react';
import { create } from 'zustand';
import type { ClaudeProfile, ProfileColor, ProfilesSnapshot } from '@switchboard/protocol/client';
import { useEngineConnection } from '../engine/useEngine.ts';
import { remoteProfileColor, type RemoteRowInfo } from './remoteRows.ts';

interface ProfilesState {
  profiles: ClaudeProfile[];
  defaultId: string;
  loaded: boolean;
  set(snapshot: ProfilesSnapshot): void;
}

export const useProfiles = create<ProfilesState>()((set) => ({
  profiles: [],
  defaultId: 'default',
  loaded: false,
  set: ({ profiles, defaultId }) => set({ profiles, defaultId, loaded: true }),
}));

/** More than one profile: only then does the app show which one a session or project uses. */
export const useMultipleProfiles = () => useProfiles((s) => s.profiles.length > 1);

export const useProfile = (id: string | null | undefined) => useProfiles((s) => s.profiles.find((p) => p.id === (id ?? s.defaultId)));

/**
 * The profile a row's left line shows: this computer's profile for a local session (with more than one profile), the
 * remote session's own profile (matched by name to ours, see `remoteProfileColor`) for one on another computer.
 */
export function useRowProfile(row: { profileId: string; remote?: Pick<RemoteRowInfo, 'profile'> | null }): { id: string; name: string; color: ProfileColor } | null {
  const multiple = useMultipleProfiles();
  const local = useProfile(row.remote ? null : row.profileId);
  const profiles = useProfiles((s) => s.profiles);
  if (row.remote) return row.remote.profile ? { id: row.remote.profile.id, name: row.remote.profile.name, color: remoteProfileColor(row.remote.profile, profiles) } : null;
  return multiple && local ? { id: local.id, name: local.name, color: local.color } : null;
}

/** Loads the profiles once per connection and follows changes. */
export function useProfilesSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    const off = client.on('profiles.changed', (snapshot) => useProfiles.getState().set(snapshot));
    void client.call('profiles.list', {}).then((snapshot) => useProfiles.getState().set(snapshot));
    return off;
  }, [client]);
}
