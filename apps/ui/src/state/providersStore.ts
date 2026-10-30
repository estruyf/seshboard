import { useEffect } from 'react';
import { create } from 'zustand';
import type { OptionalProvider, ProviderInfo, ProvidersSnapshot } from '@seshboard/protocol/client';
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
