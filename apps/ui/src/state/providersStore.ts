import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { ModelOption, OptionalProvider, ProviderInfo, ProvidersSnapshot, ProviderStatus, SlashCommand } from '@seshboard/protocol/client';
import { useEngineConnection } from '../engine/useEngine.ts';

interface ProvidersState {
  /** The providers besides Claude Code that a profile can use: what each is (its modes, its resume command, its folder). */
  providers: ProviderInfo[];
  set(snapshot: ProvidersSnapshot): void;
}

export const useProviders = create<ProvidersState>()((set) => ({
  providers: [],
  set: ({ providers }) => set({ providers }),
}));

export const useProvider = (id: OptionalProvider | null) => useProviders((s) => (id ? s.providers.find((p) => p.id === id) : undefined));

/** The command that continues a session in its provider's CLI, from the provider's template. */
export const resumeCommandFor = (provider: Pick<ProviderInfo, 'resumeCommand'>, sessionId: string) => provider.resumeCommand.replaceAll('{sessionId}', sessionId);

/** Loads the providers once per connection: what they are doesn't change while the app runs. */
export function useProvidersSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    void client.call('providers.list', {}).then((snapshot) => useProviders.getState().set(snapshot), () => {});
  }, [client]);
}

export interface ProviderReadiness {
  /** Null while it is being asked (it starts the profile's runtime the first time). */
  status: ProviderStatus | null;
  models: ModelOption[];
  /** Its slash commands, for the message box's `/` list. */
  commands: SlashCommand[];
  /** Asking failed (not the provider saying it can't run: that is `status.problem`). */
  error: string | null;
}

/**
 * Whether a provider profile can run a session here (installed, signed in with its own CLI) and its models and
 * commands, asked when it is picked. Null profile: Claude Code's, nothing to ask.
 */
export function useProviderReadiness(profileId: string | null): ProviderReadiness | null {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [state, setState] = useState<{ profileId: string; readiness: ProviderReadiness } | null>(null);
  useEffect(() => {
    if (!client || !profileId) return;
    let current = true;
    setState({ profileId, readiness: { status: null, models: [], commands: [], error: null } });
    void client.call('providers.status', { profileId }).then(
      async (status) => {
        const [models, commands] = status.problem
          ? [[], []]
          : await Promise.all([client.call('providers.models', { profileId }).then((r) => r.models, () => []), client.call('providers.commands', { profileId }).then((r) => r.commands, () => [])]);
        if (current) setState({ profileId, readiness: { status, models, commands, error: null } });
      },
      (error: Error) => current && setState({ profileId, readiness: { status: null, models: [], commands: [], error: error.message } }),
    );
    return () => {
      current = false;
    };
  }, [client, profileId]);
  return profileId && state?.profileId === profileId ? state.readiness : profileId ? { status: null, models: [], commands: [], error: null } : null;
}
