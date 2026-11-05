import { useEffect } from 'react';
import { create } from 'zustand';
import type { OptionalProvider, ProviderUpdateState } from '@seshboard/protocol/client';
import type { EngineClient } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';

interface ProviderUpdateStore {
  /** One per provider with a profile (GitHub Copilot CLI); empty until the engine has answered. */
  updates: ProviderUpdateState[];
  /** Why each provider's last request was refused (busy, can't update this install); cleared by its next one. */
  refused: Partial<Record<OptionalProvider, string>>;
  client: EngineClient | null;
  check(provider: OptionalProvider): void;
  update(provider: OptionalProvider): void;
  dismiss(provider: OptionalProvider): void;
  setEnabled(provider: OptionalProvider, enabled: boolean): void;
}

export const useProviderUpdates = create<ProviderUpdateStore>()((set, get) => {
  const send = (provider: OptionalProvider, call: (client: EngineClient) => Promise<unknown>) => {
    const client = get().client;
    if (!client) return;
    set((s) => ({ refused: { ...s.refused, [provider]: undefined } }));
    call(client).catch((error: Error) => set((s) => ({ refused: { ...s.refused, [provider]: error.message } })));
  };
  return {
    updates: [],
    refused: {},
    client: null,
    check: (provider) => send(provider, (c) => c.call('providerUpdate.check', { provider })),
    update: (provider) => send(provider, (c) => c.call('providerUpdate.update', { provider })),
    dismiss: (provider) => send(provider, (c) => c.call('providerUpdate.dismiss', { provider })),
    setEnabled: (provider, enabled) => send(provider, (c) => c.call('providerUpdate.setEnabled', { provider, enabled })),
  };
});

const receive = ({ updates }: { updates: ProviderUpdateState[] }) => useProviderUpdates.setState({ updates });

/** Follows the engine's checks of the providers' CLIs (loaded once per connection). */
export function useProviderUpdatesSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    useProviderUpdates.setState({ client });
    if (!client) return;
    const off = client.on('providerUpdate.changed', receive);
    void client.call('providerUpdate.list', {}).then(receive);
    return off;
  }, [client]);
}
