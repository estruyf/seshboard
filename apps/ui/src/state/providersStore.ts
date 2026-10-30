import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import type { ModelOption, OptionalProvider, ProviderInfo, ProvidersSnapshot, ProviderStatus, SlashCommand } from '@seshboard/protocol/client';
import { useEngineConnection } from '../engine/useEngine.ts';

interface ProvidersState {
  /** The providers besides Claude Code, as the engine's registry lists them (Settings › Providers). */
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

/** Loads the providers once per connection and follows changes. */
export function useProvidersSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    const off = client.on('providers.changed', (snapshot) => useProviders.getState().set(snapshot));
    void client.call('providers.list', {}).then((snapshot) => useProviders.getState().set(snapshot), () => {});
    return off;
  }, [client]);
}

/** The providers besides Claude Code that can start sessions here: allowed, with a driver. */
export function useStartableProviders(): ProviderInfo[] {
  // The list, not a filtered copy, from the store: a new array on every read would re-render without end.
  const providers = useProviders((s) => s.providers);
  return useMemo(() => providers.filter((p) => p.allowed && p.canStart), [providers]);
}

export interface ProviderReadiness {
  /** Null while it is being asked (it starts the provider's runtime the first time). */
  status: ProviderStatus | null;
  models: ModelOption[];
  /** Its slash commands, for the message box's `/` list. */
  commands: SlashCommand[];
  /** Asking failed (not the provider saying it can't run: that is `status.problem`). */
  error: string | null;
}

/**
 * Whether a provider can run a session here (installed, signed in with its own CLI) and its models, asked when it is
 * picked. Null provider: Claude Code, nothing to ask.
 */
export function useProviderReadiness(id: OptionalProvider | null): ProviderReadiness | null {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [state, setState] = useState<{ id: OptionalProvider; readiness: ProviderReadiness } | null>(null);
  useEffect(() => {
    if (!client || !id) return;
    let current = true;
    setState({ id, readiness: { status: null, models: [], commands: [], error: null } });
    void client.call('providers.status', { id }).then(
      async (status) => {
        const [models, commands] = status.problem
          ? [[], []]
          : await Promise.all([client.call('providers.models', { id }).then((r) => r.models, () => []), client.call('providers.commands', { id }).then((r) => r.commands, () => [])]);
        if (current) setState({ id, readiness: { status, models, commands, error: null } });
      },
      (error: Error) => current && setState({ id, readiness: { status: null, models: [], commands: [], error: error.message } }),
    );
    return () => {
      current = false;
    };
  }, [client, id]);
  return id && state?.id === id ? state.readiness : id ? { status: null, models: [], commands: [], error: null } : null;
}
